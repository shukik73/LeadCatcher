import { supabaseAdmin } from '@/lib/supabase-server';
import { checkBillingStatus } from '@/lib/billing-guard';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

const TAG = '[FollowUpSend]';

export interface SendResult {
    sent: boolean;
    reason?: string; // why it was NOT sent (for logging / API responses)
}

/**
 * Send one follow-up SMS to a customer, behind the full guard stack shared by
 * the owner-approval path and the auto-send engine: billing, TCPA opt-out
 * (fail closed), and per-customer SMS rate limit. On a hard opt-out it returns
 * sent:false with an `optedOut` reason so the caller can mark the draft skipped
 * rather than retried.
 *
 * This does NOT change pending_followups status — the caller owns that, so the
 * approve route and the cron can record sent/auto state differently.
 */
export async function sendFollowUpSms(opts: {
    businessId: string;
    forwardingNumber: string | null | undefined;
    customerPhone: string;
    body: string;
    leadLogged?: boolean; // if true, also append to the lead conversation
}): Promise<SendResult & { optedOut?: boolean }> {
    const { businessId, forwardingNumber, customerPhone, body } = opts;

    if (!forwardingNumber) return { sent: false, reason: 'no business phone configured' };

    const billing = await checkBillingStatus(businessId);
    if (!billing.allowed) return { sent: false, reason: 'billing inactive' };

    // TCPA: fail closed on lookup error; hard stop on opt-out.
    const { data: optOut, error: optOutError } = await supabaseAdmin
        .from('opt_outs')
        .select('id')
        .eq('business_id', businessId)
        .eq('phone_number', customerPhone)
        .maybeSingle();
    if (optOutError) return { sent: false, reason: 'opt-out check failed' };
    if (optOut) return { sent: false, reason: 'customer opted out', optedOut: true };

    const rateLimit = await checkSmsRateLimit(businessId, customerPhone);
    if (!rateLimit.allowed) return { sent: false, reason: `rate limited: ${rateLimit.reason || 'too many'}` };

    try {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({ to: customerPhone, from: forwardingNumber, body });
    } catch (error) {
        logger.error(`${TAG} Twilio send failed`, error, { businessId });
        return { sent: false, reason: 'sms send failed' };
    }

    // Log to the conversation history when a lead exists for this phone.
    if (opts.leadLogged !== false) {
        const { data: lead } = await supabaseAdmin
            .from('leads')
            .select('id')
            .eq('business_id', businessId)
            .eq('caller_phone', customerPhone)
            .maybeSingle();
        if (lead) {
            await supabaseAdmin.from('messages').insert({
                lead_id: lead.id,
                direction: 'outbound',
                body,
                is_ai_generated: true,
            });
        }
    }

    return { sent: true };
}

/**
 * Has this customer already been sent a follow-up today (any draft)? Prevents
 * a repeat-caller / multi-call customer from getting several texts in one day.
 */
export async function alreadyTextedToday(businessId: string, customerPhone: string): Promise<boolean> {
    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);
    const { count } = await supabaseAdmin
        .from('pending_followups')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('customer_phone', customerPhone)
        .eq('status', 'sent')
        .gte('sent_at', startOfDayUtc.toISOString());
    return (count || 0) > 0;
}
