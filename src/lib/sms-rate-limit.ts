import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

/**
 * SMS rate limiting per business and per caller.
 *
 * Counts recent outbound `messages` rows by joining through `leads`. Uses
 * PostgREST's nested filter syntax (leads!inner) so the count happens in a
 * single SQL statement and we never load lead IDs into memory.
 *
 * Limits:
 * - Per caller per business: max 5 outbound SMS per hour (prevents spam to a single number)
 * - Per business: max 200 outbound SMS per hour (prevents runaway cost)
 *
 * Fail closed: any query error blocks the SMS as a precaution.
 */

const PER_CALLER_LIMIT = 5;
const PER_BUSINESS_LIMIT = 200;
const WINDOW_MINUTES = 60;

export interface SmsRateLimitResult {
    allowed: boolean;
    reason?: string;
}

/**
 * Check if sending an SMS to this caller from this business is within rate limits.
 */
export async function checkSmsRateLimit(
    businessId: string,
    callerPhone: string,
): Promise<SmsRateLimitResult> {
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

    try {
        // --- Per-caller count ---
        // messages -> leads inner join, filter on business_id + caller_phone.
        const { count: callerCount, error: callerError } = await supabaseAdmin
            .from('messages')
            .select('id, leads!inner(business_id, caller_phone)', { count: 'exact', head: true })
            .eq('direction', 'outbound')
            .gte('created_at', windowStart)
            .eq('leads.business_id', businessId)
            .eq('leads.caller_phone', callerPhone);

        if (callerError) {
            // Fail closed — never let a query failure silently allow a send.
            logger.error('[SmsRateLimit] Per-caller check failed', callerError, { businessId });
            return { allowed: false, reason: 'Rate limit check failed — blocking SMS as precaution' };
        }

        if (callerCount !== null && callerCount >= PER_CALLER_LIMIT) {
            logger.warn('[SmsRateLimit] Per-caller limit exceeded', {
                businessId, count: callerCount.toString(), limit: PER_CALLER_LIMIT.toString(),
            });
            return { allowed: false, reason: `Rate limit: max ${PER_CALLER_LIMIT} messages per hour to this number` };
        }

        // --- Per-business count ---
        const { count: bizCount, error: bizError } = await supabaseAdmin
            .from('messages')
            .select('id, leads!inner(business_id)', { count: 'exact', head: true })
            .eq('direction', 'outbound')
            .gte('created_at', windowStart)
            .eq('leads.business_id', businessId);

        if (bizError) {
            logger.error('[SmsRateLimit] Per-business check failed', bizError, { businessId });
            return { allowed: false, reason: 'Rate limit check failed — blocking SMS as precaution' };
        }

        if (bizCount !== null && bizCount >= PER_BUSINESS_LIMIT) {
            logger.warn('[SmsRateLimit] Per-business limit exceeded', {
                businessId, count: bizCount.toString(), limit: PER_BUSINESS_LIMIT.toString(),
            });
            return { allowed: false, reason: `Rate limit: max ${PER_BUSINESS_LIMIT} messages per hour for this business` };
        }

        return { allowed: true };
    } catch (error) {
        logger.error('[SmsRateLimit] Unexpected error', error, { businessId });
        return { allowed: false, reason: 'Rate limit check failed — blocking SMS as precaution' };
    }
}
