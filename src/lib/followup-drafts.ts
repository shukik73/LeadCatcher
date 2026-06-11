import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const TAG = '[FollowUpDrafts]';

/** Don't chase a call until it's had a few hours to convert on its own. */
const MIN_AGE_HOURS = 3;
/** Past this, the lead is cold — chasing reads as spam. */
const MAX_AGE_HOURS = 72;
/** Per business per run; the digest is a short review list, not a backlog dump. */
const MAX_DRAFTS_PER_RUN = 10;

const DRAFT_SYSTEM_PROMPT = `You write ONE follow-up SMS from a repair shop to a customer who called about something but never came in.

Rules:
- Under 300 characters. Warm, casual-professional, like a local shop that remembers you.
- Reference the SPECIFIC device or request from the call summary (e.g. "your iPhone 15 screen", "the Apple monitor you wanted to sell").
- Invite them to come in today or tomorrow. No pressure language.
- Never invent prices, never promise outcomes, no URLs, no emojis.
- If the summary shows the matter is already resolved, spam, or a vendor/telemarketer, set should_send to false.

Return JSON only:
{"sms": "...", "should_send": true/false, "reason": "one short line: why this lead is worth chasing (shown to the owner)"}`;

export interface FollowUpCandidate {
    id: string;
    customer_name: string | null;
    customer_phone: string;
    summary: string | null;
    category: string | null;
    created_at: string;
}

export interface DraftResult {
    sms: string;
    reason: string;
    aiGenerated: boolean;
    shouldSend: boolean;
}

/**
 * Calls that showed intent (quote, follow-up needed) but produced no ticket
 * and no store visit, old enough to chase and young enough to still be warm,
 * with no draft created before (unique index on call_analysis_id backstops this).
 */
export async function findFollowUpCandidates(businessId: string): Promise<FollowUpCandidate[]> {
    const now = Date.now();
    const newest = new Date(now - MIN_AGE_HOURS * 3600_000).toISOString();
    const oldest = new Date(now - MAX_AGE_HOURS * 3600_000).toISOString();

    const { data, error } = await supabaseAdmin
        .from('call_analyses')
        .select('id, customer_name, customer_phone, summary, category, created_at')
        .eq('business_id', businessId)
        .eq('follow_up_needed', true)
        .in('callback_status', ['pending', 'no_answer'])
        .is('ticket_created_at', null)
        .is('store_visit_at', null)
        .not('customer_phone', 'is', null)
        .gte('created_at', oldest)
        .lte('created_at', newest)
        .order('created_at', { ascending: false })
        .limit(MAX_DRAFTS_PER_RUN * 3); // headroom; dedupe below cuts it down

    if (error) {
        logger.error(`${TAG} Candidate query failed`, error, { businessId });
        return [];
    }
    const candidates = (data || []).filter(
        (c) => c.customer_phone && c.category !== 'spam' && c.category !== 'wrong_number',
    ) as FollowUpCandidate[];

    if (candidates.length === 0) return [];

    // Drop calls that already have a draft (any status)
    const { data: existing } = await supabaseAdmin
        .from('pending_followups')
        .select('call_analysis_id')
        .in('call_analysis_id', candidates.map((c) => c.id));
    const drafted = new Set((existing || []).map((r) => r.call_analysis_id));

    return candidates.filter((c) => !drafted.has(c.id)).slice(0, MAX_DRAFTS_PER_RUN);
}

/**
 * Draft the follow-up SMS for one candidate. Uses the LLM when available;
 * falls back to a safe template so the feature degrades, not disappears.
 */
export async function draftFollowUpSms(
    candidate: FollowUpCandidate,
    businessName: string,
): Promise<DraftResult> {
    const firstName = (candidate.customer_name || '').trim().split(/\s+/)[0] || null;
    // Skip obviously non-name "names" (raw phone numbers from the feed)
    const greetName = firstName && !/^\+?\d/.test(firstName) ? capitalize(firstName) : null;

    if (openai && candidate.summary) {
        try {
            const response = await openai.chat.completions.create({
                model: process.env.OPENAI_MODEL || 'gpt-4o',
                messages: [
                    { role: 'system', content: DRAFT_SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: [
                            `Shop: ${businessName}`,
                            `Customer: ${candidate.customer_name || 'unknown'}`,
                            `Call summary: ${candidate.summary}`,
                        ].join('\n'),
                    },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.4,
            });
            const parsed = JSON.parse(response.choices[0].message.content || '{}');
            if (typeof parsed.sms === 'string' && parsed.sms.trim()) {
                return {
                    sms: parsed.sms.replace(/https?:\/\/\S+/gi, '').trim().slice(0, 320),
                    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : 'Showed intent, never came in',
                    aiGenerated: true,
                    shouldSend: parsed.should_send !== false,
                };
            }
        } catch (error) {
            logger.error(`${TAG} LLM draft failed, falling back to template`, error, {
                callAnalysisId: candidate.id,
            });
        }
    }

    // Template fallback — generic but safe
    const greeting = greetName ? `Hi ${greetName}, ` : 'Hi, ';
    return {
        sms: `${greeting}it's ${businessName} — following up on your call with us. We're ready when you are; come by today or tomorrow and we'll take care of you!`,
        reason: 'Showed intent on a call, no ticket or visit since',
        aiGenerated: false,
        shouldSend: true,
    };
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
