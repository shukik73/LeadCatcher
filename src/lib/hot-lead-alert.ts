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
        // Make the alert actionable: deep-link the owner straight to the callback
        // queue. Keep the whole SMS within 320 chars by trimming the summary, not
        // the link.
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || '';
        const link = baseUrl ? `\nOpen: ${baseUrl}/dashboard/hot-leads` : '';
        const prefix = '[HOT LEAD] ';
        const room = Math.max(0, 320 - prefix.length - link.length);
        const body = `${prefix}${summary.slice(0, room)}${link}`;

        await client.messages.create({
            to: ownerPhone,
            from: forwardingNumber,
            body,
        });
        logger.info(`${TAG} Hot lead alert sent`, { leadId, businessId });
        return true;
    } catch (error) {
        logger.error(`${TAG} Failed to send hot lead alert`, error, { leadId, businessId });
        return false;
    }
}
