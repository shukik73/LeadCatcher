import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

/**
 * Spam gate for the missed-call path.
 *
 * Runs at the Twilio voice webhook BEFORE any text-back SMS or LLM call, so
 * robocalls never cost an SMS, never create a junk lead, and never get a text
 * sent to a non-consenting number (A2P/10DLC trust).
 *
 * Design principle: FAIL OPEN. Any error here must treat the call as legitimate —
 * dropping a real customer is the one thing this product must never do. The only
 * hard blocks in 'standard' mode are callers we couldn't have texted anyway
 * (anonymous / invalid caller ID) or that are on the blocklist.
 */

const TAG = '[SpamGate]';

export type SpamMode = 'off' | 'standard' | 'aggressive';

export interface SpamSignals {
    caller: string;                // raw caller ID as received from Twilio
    callerName?: string | null;    // CNAM, if available
    fromCountry?: string | null;   // Twilio FromCountry / CallerCountry
    businessCountry?: string;      // defaults to 'US'
    lineType?: string | null;      // Twilio Lookup line_type_intelligence.type
}

export interface SpamVerdict {
    isSpam: boolean;
    reason: string | null;
    score: number;
    signals: string[];
}

const CLEAN: SpamVerdict = { isSpam: false, reason: null, score: 0, signals: [] };

// Withheld / machine caller IDs seen on the voice webhook.
const ANON_CALLER = /^(anonymous|unknown|private|restricted|unavailable|blocked|no ?caller ?id)$/i;

/**
 * Pure heuristics — no I/O. Evaluates the caller signals for the given mode.
 * Blocklist and Twilio Lookup are layered on by evaluateSpam(); this function is
 * deterministic and unit-tested in isolation.
 */
export function evaluateCallerHeuristics(signals: SpamSignals, mode: SpamMode): SpamVerdict {
    if (mode === 'off') return CLEAN;

    const reasons: string[] = [];
    let score = 0;
    let hardBlock = false;

    const raw = (signals.caller ?? '').trim();
    const digits = raw.replace(/[^\d+]/g, '');

    // Anonymous / withheld caller ID — a classic robocall/spoof signal, and one we
    // literally cannot text back, so blocking costs nothing.
    if (!raw || ANON_CALLER.test(raw)) {
        hardBlock = true;
        reasons.push('anonymous_caller');
    } else if (!/^\+?\d{7,15}$/.test(digits)) {
        // Not a plausible phone number (short code, garbage, premium-rate).
        hardBlock = true;
        reasons.push('invalid_number');
    }

    // Soft signals — only bite in 'aggressive' mode, where the owner has opted in
    // and accepts some false-positive risk.
    if (signals.lineType === 'nonFixedVoip') {
        score += 2;
        reasons.push('nonfixed_voip');
    }
    const bizCountry = (signals.businessCountry || 'US').toUpperCase();
    if (signals.fromCountry && signals.fromCountry.toUpperCase() !== bizCountry) {
        score += 2;
        reasons.push('foreign_country');
    }
    if (!signals.callerName) {
        score += 1;
        reasons.push('no_cnam');
    }

    let isSpam = false;
    if (hardBlock) isSpam = true;
    else if (mode === 'aggressive' && score >= 3) isSpam = true;

    return {
        isSpam,
        reason: isSpam ? reasons[0] : null,
        score,
        signals: reasons,
    };
}

/**
 * Is this caller on the business's blocklist? Fails open (returns false) on error.
 */
export async function isBlocklisted(businessId: string, caller: string): Promise<boolean> {
    if (!caller) return false;
    const { data, error } = await supabaseAdmin
        .from('spam_numbers')
        .select('id')
        .eq('business_id', businessId)
        .eq('phone_number', caller)
        .maybeSingle();
    if (error) {
        logger.error(`${TAG} Blocklist lookup failed (fail open)`, error, { businessId });
        return false;
    }
    return !!data;
}

/**
 * Add a caller to a business's blocklist. Idempotent; non-throwing.
 */
export async function addToBlocklist(
    businessId: string,
    caller: string,
    reason: string,
    source: 'auto_ai' | 'heuristic' | 'manual',
): Promise<void> {
    if (!caller) return;
    const { error } = await supabaseAdmin
        .from('spam_numbers')
        .upsert(
            { business_id: businessId, phone_number: caller, reason, source },
            { onConflict: 'business_id,phone_number' },
        );
    if (error) logger.error(`${TAG} Failed to add to blocklist`, error, { businessId });
}

/**
 * Twilio Lookup line-type enrichment. Costs a fraction of a cent per call — far
 * cheaper than an OpenAI intake — but off by default (env-gated) so it never
 * surprises anyone's bill. Only consulted in 'aggressive' mode. Fails open (null).
 */
export async function lookupLineType(caller: string): Promise<string | null> {
    if (process.env.SPAM_LOOKUP_ENABLED !== 'true') return null;
    if (!caller || !/^\+?\d{7,15}$/.test(caller.replace(/[^\d+]/g, ''))) return null;
    try {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const result = await client.lookups.v2
            .phoneNumbers(caller)
            .fetch({ fields: 'line_type_intelligence' });
        const lti = (result as { lineTypeIntelligence?: { type?: string | null } }).lineTypeIntelligence;
        return lti?.type ?? null;
    } catch (err) {
        logger.error(`${TAG} Lookup failed (fail open)`, err, {});
        return null;
    }
}

/**
 * Full spam evaluation: blocklist → (aggressive) Lookup → heuristics.
 * Fails open on any unexpected error.
 */
export async function evaluateSpam(input: {
    businessId: string;
    caller: string;                       // RAW caller ID (used for anonymous/format checks)
    callerNormalized?: string | null;     // E.164 form for blocklist matching, if normalizable
    callerName?: string | null;
    fromCountry?: string | null;
    businessCountry?: string;
    mode: SpamMode;
}): Promise<SpamVerdict> {
    const { businessId, callerNormalized, mode } = input;
    if (mode === 'off') return CLEAN;

    try {
        // 1. Blocklist — highest confidence, cheapest. Matches on the normalized
        //    number (how it's stored); anonymous/invalid callers aren't normalizable
        //    and are caught by the heuristics below instead.
        if (callerNormalized && await isBlocklisted(businessId, callerNormalized)) {
            return { isSpam: true, reason: 'blocklisted', score: 100, signals: ['blocklisted'] };
        }

        // 2. Optional Lookup enrichment (aggressive mode only, env-gated).
        let lineType: string | null = null;
        if (mode === 'aggressive' && callerNormalized) {
            lineType = await lookupLineType(callerNormalized);
        }

        // 3. Heuristics on the RAW caller ID.
        return evaluateCallerHeuristics({ ...input, lineType }, mode);
    } catch (err) {
        logger.error(`${TAG} evaluateSpam failed (fail open)`, err, { businessId });
        return CLEAN;
    }
}
