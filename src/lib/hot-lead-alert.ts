import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { checkBillingStatus } from '@/lib/billing-guard';
import twilio from 'twilio';

const TAG = '[HotLeadAlert]';

/**
 * Send a one-shot SMS to the business owner when a lead is flagged high-urgency.
 * Deduplicated via leads.hot_alert_sent_at — only the first AI/qualification
 * signal that detects "hot" triggers the alert.
 *
 * Returns true if an alert was sent (or already sent), false on skip.
 */
export async function maybeSendHotLeadAlert(opts: {
    leadId: string;
    businessId: string;
    ownerPhone: string | null | undefined;
    forwardingNumber: string | null | undefined;
    summary: string;
    urgency: string | null;
}): Promise<boolean> {
    const { leadId, businessId, ownerPhone, forwardingNumber, summary, urgency } = opts;

    if (urgency !== 'high') return false;
    if (!ownerPhone || !forwardingNumber) return false;

    // Atomically claim the alert: only sets hot_alert_sent_at if it was NULL.
    // Uses UPDATE ... WHERE hot_alert_sent_at IS NULL so concurrent runs cannot
    // both succeed.
    const { data: claimed, error: claimError } = await supabaseAdmin
        .from('leads')
        .update({ hot_alert_sent_at: new Date().toISOString() })
        .eq('id', leadId)
        .is('hot_alert_sent_at', null)
        .select('id');

    if (claimError) {
        logger.error(`${TAG} Failed to claim hot lead alert`, claimError, { leadId });
        return false;
    }
    if (!claimed || claimed.length === 0) {
        // Already sent — dedupe.
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
        await client.messages.create({
            to: ownerPhone,
            from: forwardingNumber,
            body: `[HOT LEAD] ${summary}`.slice(0, 320),
        });
        logger.info(`${TAG} Hot lead alert sent`, { leadId, businessId });
        return true;
    } catch (error) {
        logger.error(`${TAG} Failed to send hot lead alert`, error, { leadId, businessId });
        return false;
    }
}
