import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

/**
 * SMS rate limiting per business and per caller.
 *
 * Uses the messages table as a natural rate-limit store — counts recent
 * outbound messages to determine if limits have been exceeded.
 *
 * Limits:
 * - Per caller per business: max 5 outbound SMS per hour (prevents spam to a single number)
 * - Per business: max 200 outbound SMS per hour (prevents runaway cost)
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
        // First get lead IDs for this business+caller
        const { data: leads } = await supabaseAdmin
            .from('leads')
            .select('id')
            .eq('business_id', businessId)
            .eq('caller_phone', callerPhone);

        if (leads && leads.length > 0) {
            const leadIds = leads.map(l => l.id);

            // Check per-caller limit
            const { count: callerCount, error: callerError } = await supabaseAdmin
                .from('messages')
                .select('id', { count: 'exact', head: true })
                .eq('direction', 'outbound')
                .gte('created_at', windowStart)
                .in('lead_id', leadIds);

            if (callerError) {
                logger.error('[SmsRateLimit] Per-caller check failed', callerError, { businessId, callerPhone });
                return { allowed: true }; // Fail open
            }

            if (callerCount !== null && callerCount >= PER_CALLER_LIMIT) {
                logger.warn('[SmsRateLimit] Per-caller limit exceeded', {
                    businessId, callerPhone, count: callerCount.toString(), limit: PER_CALLER_LIMIT.toString(),
                });
                return { allowed: false, reason: `Rate limit: max ${PER_CALLER_LIMIT} messages per hour to this number` };
            }
        }

        // Check per-business limit
        const { data: allLeads } = await supabaseAdmin
            .from('leads')
            .select('id')
            .eq('business_id', businessId);

        if (allLeads && allLeads.length > 0) {
            const allLeadIds = allLeads.map(l => l.id);

            const { count: bizCount, error: bizError } = await supabaseAdmin
                .from('messages')
                .select('id', { count: 'exact', head: true })
                .eq('direction', 'outbound')
                .gte('created_at', windowStart)
                .in('lead_id', allLeadIds);

            if (bizError) {
                logger.error('[SmsRateLimit] Per-business check failed', bizError, { businessId });
                return { allowed: true }; // Fail open
            }

            if (bizCount !== null && bizCount >= PER_BUSINESS_LIMIT) {
                logger.warn('[SmsRateLimit] Per-business limit exceeded', {
                    businessId, count: bizCount.toString(), limit: PER_BUSINESS_LIMIT.toString(),
                });
                return { allowed: false, reason: `Rate limit: max ${PER_BUSINESS_LIMIT} messages per hour for this business` };
            }
        }

        return { allowed: true };
    } catch (error) {
        logger.error('[SmsRateLimit] Unexpected error', error, { businessId });
        return { allowed: true }; // Fail open
    }
}
