import { supabaseAdmin } from '@/lib/supabase-server';
import { findFollowUpCandidates, draftFollowUpSms } from '@/lib/followup-drafts';
import { sendFollowUpSms, alreadyTextedToday } from '@/lib/followup-send';
import { isBusinessHours, type BusinessHours } from '@/lib/business-logic';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { checkBillingStatus } from '@/lib/billing-guard';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = '[FollowUp Engine]';

// 15-min cool-off: give the owner a chance to handle the lead first, but text
// while it's still warm. (Runs every 10 min via Vercel cron.)
const MIN_AGE_HOURS = 0.25;
// Auto-send only chases genuinely fresh leads, so flipping the switch on can't
// blast days of backlog. Older-but-still-warm leads go to the approval queue.
const AUTO_SEND_MAX_AGE_HOURS = 24;
// Hard ceiling on automatic texts per business per day — backstop against a
// reprocess or a bad day generating a flood.
const AUTO_SEND_DAILY_CAP = 12;
// Owner gets the "drafts waiting" nudge at these business-local hours only,
// so the 10-min engine cadence doesn't turn into 144 pings/day.
const PING_HOURS = [9, 13, 18];

function verifyCronSecret(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || !header) return false;
    const expected = `Bearer ${secret}`;
    if (header.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

function localHour(timezone: string): number {
    try {
        return parseInt(
            new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(new Date()),
            10,
        ) % 24;
    } catch {
        return new Date().getUTCHours();
    }
}

async function autoSentTodayCount(businessId: string): Promise<number> {
    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);
    const { count } = await supabaseAdmin
        .from('pending_followups')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('status', 'sent')
        .eq('sent_via', 'auto')
        .gte('sent_at', startOfDayUtc.toISOString());
    return count || 0;
}

/**
 * GET /api/cron/followup-drafts  (Vercel Cron, every 10 min)
 *
 * The follow-up engine. For each business, find calls that showed buying intent
 * but never converted, AI-draft a personalized SMS, then route it:
 *   - should_send=false        -> suppressed (recorded, never re-drafted)
 *   - auto-send ON + high conf -> SENT automatically (guards + caps + hours)
 *   - otherwise                -> pending (owner approval queue)
 * Owner is pinged about the pending queue at 9am/1pm/6pm local only.
 */
export async function GET(request: Request) {
    if (!verifyCronSecret(request.headers.get('authorization'))) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data: businesses, error } = await supabaseAdmin
            .from('businesses')
            .select('id, name, timezone, owner_phone, forwarding_number, business_hours, followup_auto_send')
            .not('repairdesk_api_key', 'is', null);

        if (error) {
            logger.error(`${TAG} Failed to fetch businesses`, error);
            return Response.json({ error: 'Database error' }, { status: 500 });
        }

        const results = [];
        for (const business of businesses || []) {
            try {
                results.push({ businessId: business.id, ...(await processBusiness(business)) });
            } catch (bizError) {
                logger.error(`${TAG} Business failed`, bizError, { businessId: business.id });
                results.push({ businessId: business.id, error: 'failed' });
            }
        }
        return Response.json({ success: true, results });
    } catch (error) {
        logger.error(`${TAG} Fatal error`, error);
        return Response.json({ error: 'Cron failed' }, { status: 500 });
    }
}

interface BusinessRow {
    id: string;
    name: string | null;
    timezone: string | null;
    owner_phone: string | null;
    forwarding_number: string | null;
    business_hours: BusinessHours | null;
    followup_auto_send: boolean;
}

async function processBusiness(business: BusinessRow) {
    const tz = business.timezone || 'America/New_York';

    // Expire stale pending drafts so the review queue never fills with cold leads.
    await supabaseAdmin
        .from('pending_followups')
        .update({ status: 'expired' })
        .eq('business_id', business.id)
        .eq('status', 'pending')
        .lt('created_at', new Date(Date.now() - 48 * 3600_000).toISOString());

    const candidates = await findFollowUpCandidates(business.id, MIN_AGE_HOURS);

    const autoOn = business.followup_auto_send && isBusinessHours(business.business_hours, tz);
    let autoBudget = autoOn ? Math.max(0, AUTO_SEND_DAILY_CAP - (await autoSentTodayCount(business.id))) : 0;
    const now = Date.now();

    let created = 0, autoSent = 0, suppressed = 0;

    for (const candidate of candidates) {
        const draft = await draftFollowUpSms(candidate, business.name || 'our store');

        // AI declined (resolved / spam / vendor) — record so we never re-draft it.
        if (!draft.shouldSend) {
            await insertDraft(business.id, candidate, draft, 'suppressed');
            suppressed++;
            continue;
        }

        const ageHours = (now - new Date(candidate.created_at).getTime()) / 3600_000;
        const autoEligible =
            autoOn &&
            autoBudget > 0 &&
            draft.confidence === 'high' &&
            ageHours <= AUTO_SEND_MAX_AGE_HOURS &&
            !(await alreadyTextedToday(business.id, candidate.customer_phone));

        if (autoEligible) {
            const res = await sendFollowUpSms({
                businessId: business.id,
                forwardingNumber: business.forwarding_number,
                customerPhone: candidate.customer_phone,
                body: draft.sms,
            });
            if (res.sent) {
                await insertDraft(business.id, candidate, draft, 'sent', 'auto');
                autoSent++;
                autoBudget--;
                continue;
            }
            if (res.optedOut) {
                await insertDraft(business.id, candidate, draft, 'skipped');
                continue;
            }
            // transient failure (rate limit / billing / twilio) — fall back to
            // the approval queue so the lead isn't lost.
        }

        await insertDraft(business.id, candidate, draft, 'pending');
        created++;
    }

    // Nudge the owner about the review queue, only at the digest hours.
    let pinged = false;
    if (PING_HOURS.includes(localHour(tz)) && business.owner_phone && business.forwarding_number) {
        const { count: pendingCount } = await supabaseAdmin
            .from('pending_followups')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', business.id)
            .eq('status', 'pending');
        if ((pendingCount || 0) > 0) pinged = await pingOwner(business, pendingCount || 0);
    }

    return { candidates: candidates.length, autoSent, created, suppressed, pinged };
}

async function insertDraft(
    businessId: string,
    candidate: { id: string; customer_name: string | null; customer_phone: string },
    draft: { sms: string; reason: string; aiGenerated: boolean },
    status: 'pending' | 'sent' | 'skipped' | 'suppressed',
    sentVia?: 'auto' | 'manual',
) {
    const row: Record<string, unknown> = {
        business_id: businessId,
        call_analysis_id: candidate.id,
        customer_name: candidate.customer_name,
        customer_phone: candidate.customer_phone,
        reason: draft.reason,
        draft_sms: draft.sms,
        ai_generated: draft.aiGenerated,
        status,
    };
    if (status === 'sent') {
        row.sent_at = new Date().toISOString();
        row.sent_via = sentVia || 'auto';
    }
    const { error } = await supabaseAdmin.from('pending_followups').insert(row);
    if (error && error.code !== '23505') {
        logger.error(`${TAG} Insert failed`, error, { callAnalysisId: candidate.id });
    }
}

async function pingOwner(
    business: { id: string; owner_phone: string | null; forwarding_number: string | null },
    pendingCount: number,
): Promise<boolean> {
    const billing = await checkBillingStatus(business.id);
    if (!billing.allowed) return false;
    const rateLimit = await checkSmsRateLimit(business.id, business.owner_phone!);
    if (!rateLimit.allowed) return false;
    try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || '';
        const link = baseUrl ? `\nReview: ${baseUrl}/dashboard/followups` : '';
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
            to: business.owner_phone!,
            from: business.forwarding_number!,
            body: `[FOLLOW-UPS] ${pendingCount} draft message${pendingCount === 1 ? '' : 's'} waiting for your approval.${link}`,
        });
        return true;
    } catch (error) {
        logger.error(`${TAG} Owner ping failed`, error, { businessId: business.id });
        return false;
    }
}
