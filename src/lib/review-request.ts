import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { checkBillingStatus } from '@/lib/billing-guard';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import twilio from 'twilio';

const TAG = '[ReviewRequest]';

/**
 * Send a Google review-request SMS to a repair customer once a ticket is
 * marked completed/paid. Deduped on (business_id, ticket_id) via the
 * review_requests table — see migration 003b/007.
 *
 * Respects billing, opt-out, and SMS rate limits.
 *
 * Returns true when an SMS was successfully dispatched. Returns false (and
 * logs) on any skip path, including dedupe hits.
 */
export async function sendReviewRequest(opts: {
    businessId: string;
    businessName: string | null | undefined;
    forwardingNumber: string | null | undefined;
    googleReviewLink: string | null | undefined;
    customerPhone: string;
    customerName?: string | null;
    ticketId: string | number | null;
}): Promise<boolean> {
    const {
        businessId,
        businessName,
        forwardingNumber,
        googleReviewLink,
        customerPhone,
        customerName,
        ticketId,
    } = opts;

    if (!googleReviewLink) {
        logger.info(`${TAG} Skipping - no google_review_link configured`, { businessId });
        return false;
    }
    if (!forwardingNumber) {
        logger.info(`${TAG} Skipping - no forwarding number`, { businessId });
        return false;
    }

    // Dedupe on (business_id, ticket_id). The unique partial index makes this
    // safe under concurrent runs — a duplicate insert errors out.
    const ticketIdStr = ticketId !== null && ticketId !== undefined ? String(ticketId) : null;
    if (ticketIdStr) {
        const { data: existing, error: existingErr } = await supabaseAdmin
            .from('review_requests')
            .select('id')
            .eq('business_id', businessId)
            .eq('ticket_id', ticketIdStr)
            .maybeSingle();
        if (existingErr) {
            logger.error(`${TAG} Dedupe check failed`, existingErr, { businessId, ticketIdStr });
            return false;
        }
        if (existing) {
            logger.info(`${TAG} Already sent for ticket — dedupe hit`, { businessId, ticketIdStr });
            return false;
        }
    }

    // Billing guard
    const billing = await checkBillingStatus(businessId);
    if (!billing.allowed) {
        logger.info(`${TAG} Skipping - billing inactive`, { businessId });
        return false;
    }

    // Opt-out (fail closed)
    const { data: optOut, error: optOutErr } = await supabaseAdmin
        .from('opt_outs')
        .select('id')
        .eq('business_id', businessId)
        .eq('phone_number', customerPhone)
        .maybeSingle();
    if (optOutErr) {
        logger.error(`${TAG} Opt-out lookup failed - blocking send`, optOutErr, { businessId });
        return false;
    }
    if (optOut) {
        logger.info(`${TAG} Skipping - opted out`, { businessId });
        return false;
    }

    // Rate limit
    const rl = await checkSmsRateLimit(businessId, customerPhone);
    if (!rl.allowed) {
        logger.warn(`${TAG} Skipping - rate limited`, { businessId, reason: rl.reason });
        return false;
    }

    const safeName = (businessName || 'our shop').replace(/[<>]/g, '');
    const body = `Thanks for choosing ${safeName}. If we helped, would you mind leaving us a quick review? ${googleReviewLink}`;

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    try {
        await client.messages.create({
            to: customerPhone,
            from: forwardingNumber,
            body,
        });
    } catch (error) {
        logger.error(`${TAG} Twilio send failed`, error, { businessId });
        return false;
    }

    // Insert review_requests row only after a successful Twilio send.
    const { error: insertError } = await supabaseAdmin.from('review_requests').insert({
        business_id: businessId,
        customer_phone: customerPhone,
        customer_name: customerName || null,
        ticket_id: ticketIdStr,
        review_link: googleReviewLink,
    });

    if (insertError) {
        // If the unique index trips, treat it as dedupe rather than failure.
        if (insertError.code === '23505') {
            logger.info(`${TAG} Dedupe race avoided`, { businessId, ticketIdStr });
            return false;
        }
        logger.error(`${TAG} review_requests insert failed (SMS already sent)`, insertError, { businessId });
    }

    logger.info(`${TAG} Review request sent`, { businessId, ticketIdStr });
    return true;
}
