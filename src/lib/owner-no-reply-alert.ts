import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { checkBillingStatus } from '@/lib/billing-guard';
import twilio from 'twilio';

const TAG = '[OwnerNoReplyAlert]';

export interface OwnerAlertDecisionInput {
    /** Lead status — we only alert after the customer was texted (status 'Contacted'). */
    status: string;
    /** When the owner was already alerted for this lead, or null. */
    ownerAlertedAt: string | null;
    ownerPhone: string | null;
    forwardingNumber: string | null;
    /** When we last texted the customer, or null if we never did. */
    lastOutboundAt: string | null;
    /** Whether the customer has replied at all. */
    inboundExists: boolean;
    now: Date;
    thresholdMinutes: number;
}

/**
 * Pure decision: should we ping the owner to call this lead?
 *
 * Yes when: we texted the customer (status 'Contacted'), they have not replied,
 * the wait threshold has elapsed since our last text, the owner has not already
 * been alerted, and the business has both an owner number and a sending number.
 */
export function shouldAlertOwner(i: OwnerAlertDecisionInput): boolean {
    if (i.status !== 'Contacted') return false;
    if (i.ownerAlertedAt) return false;
    if (!i.ownerPhone || !i.forwardingNumber) return false;
    if (i.inboundExists) return false;
    if (!i.lastOutboundAt) return false;
    const elapsedMin = (i.now.getTime() - new Date(i.lastOutboundAt).getTime()) / 60000;
    return elapsedMin >= i.thresholdMinutes;
}

/**
 * Send a one-shot SMS to the business owner: "we texted them, no reply — call them."
 * Deduplicated via leads.owner_alerted_at — the atomic claim guarantees one send.
 *
 * Returns true if an alert was sent (or already sent), false on skip.
 */
export async function sendOwnerNoReplyAlert(opts: {
    leadId: string;
    businessId: string;
    ownerPhone: string | null | undefined;
    forwardingNumber: string | null | undefined;
    callerPhone: string;
    callerName: string | null;
}): Promise<boolean> {
    const { leadId, businessId, ownerPhone, forwardingNumber, callerPhone, callerName } = opts;

    if (!ownerPhone || !forwardingNumber) return false;

    // Atomically claim: only sets owner_alerted_at if it was NULL so concurrent
    // cron runs cannot both send.
    const { data: claimed, error: claimError } = await supabaseAdmin
        .from('leads')
        .update({ owner_alerted_at: new Date().toISOString() })
        .eq('id', leadId)
        .is('owner_alerted_at', null)
        .select('id');

    if (claimError) {
        logger.error(`${TAG} Failed to claim owner alert`, claimError, { leadId });
        return false;
    }
    if (!claimed || claimed.length === 0) {
        // Already alerted — dedupe.
        return true;
    }

    const billing = await checkBillingStatus(businessId);
    if (!billing.allowed) {
        logger.info(`${TAG} Skipping - billing inactive`, { businessId });
        return false;
    }

    const rateLimit = await checkSmsRateLimit(businessId, ownerPhone);
    if (!rateLimit.allowed) {
        logger.warn(`${TAG} Skipping - rate limited`, { businessId, reason: rateLimit.reason });
        return false;
    }

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    try {
        const who = callerName ? `${callerName} (${callerPhone})` : callerPhone;
        const body = `[CALL BACK] We texted ${who} about their missed call — no reply yet. Might be worth giving them a call.`;

        await client.messages.create({
            to: ownerPhone,
            from: forwardingNumber,
            body,
        });
        logger.info(`${TAG} Owner no-reply alert sent`, { leadId, businessId });
        return true;
    } catch (error) {
        logger.error(`${TAG} Failed to send owner alert`, error, { leadId, businessId });
        return false;
    }
}
