import { supabaseAdmin } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { checkBillingStatus } from '@/lib/billing-guard';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { sendReviewRequest } from '@/lib/review-request';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = '[Repair Status]';

// Status messages sent to customers when ticket status changes
const STATUS_MESSAGES: Record<string, string> = {
    'In Progress': "Update from {{business_name}}: Your device repair is now in progress! We'll let you know when it's ready.",
    'Ready for Pickup': "Great news from {{business_name}}! Your device is ready for pickup. We're open until {{close_time}} today.",
    'Completed': "Your repair at {{business_name}} is complete! Come pick it up at your convenience.",
    'Waiting for Parts': "Update from {{business_name}}: We're waiting for parts for your repair. We'll notify you once they arrive.",
    'Parts Arrived': "Good news from {{business_name}}! The parts for your repair have arrived. We'll start working on it right away.",
};

// Statuses that mean the repair is finished and we should request a Google review.
const REVIEW_TRIGGER_STATUSES = new Set(['Completed', 'Paid', 'Picked Up']);

function verifyCronSecret(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || !header) return false;
    const expected = `Bearer ${secret}`;
    if (header.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * GET /api/cron/repair-status
 *
 * Polls RepairDesk for ticket status changes and sends SMS updates to customers.
 * Vercel Cron: schedule every 15 minutes.
 */
export async function GET(request: Request) {
    if (!verifyCronSecret(request.headers.get('authorization'))) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data: businesses } = await supabaseAdmin
            .from('businesses')
            .select('id, name, repairdesk_api_key, repairdesk_store_url, forwarding_number, status_updates_enabled, business_hours, timezone, google_review_link')
            .eq('status_updates_enabled', true)
            .not('repairdesk_api_key', 'is', null);

        if (!businesses || businesses.length === 0) {
            return Response.json({ message: 'No businesses with status updates enabled' });
        }

        const results = [];
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        for (const biz of businesses) {
            try {
                const result = await processBusinessTickets(biz, twilioClient);
                results.push({ businessId: biz.id, ...result });
            } catch (error) {
                logger.error(`${TAG} Error for business`, error, { businessId: biz.id });
                results.push({ businessId: biz.id, error: 'Failed' });
            }
        }

        return Response.json({ success: true, results });
    } catch (error) {
        logger.error(`${TAG} Fatal error`, error);
        return Response.json({ error: 'Failed' }, { status: 500 });
    }
}

async function processBusinessTickets(
    biz: {
        id: string; name: string; repairdesk_api_key: string;
        repairdesk_store_url: string | null; forwarding_number: string;
        business_hours: unknown; timezone: string | null;
        google_review_link: string | null;
    },
    twilioClient: ReturnType<typeof twilio>,
) {
    const client = new RepairDeskClient(
        biz.repairdesk_api_key,
        biz.repairdesk_store_url || undefined,
    );

    const billing = await checkBillingStatus(biz.id);
    let statusChanges = 0;
    let smsSent = 0;
    let reviewRequests = 0;

    // Fetch recent tickets (first 3 pages)
    for (let page = 1; page <= 3; page++) {
        const tickets = await client.getTickets(page);
        if (tickets.data.length === 0) break;

        for (const ticket of tickets.data) {
            if (!ticket.customer?.phone) continue;

            let normalizedPhone: string;
            try {
                normalizedPhone = normalizePhoneNumber(ticket.customer.phone);
            } catch {
                continue;
            }

            // Upsert tracking record
            const { data: existing } = await supabaseAdmin
                .from('ticket_status_tracking')
                .select('id, last_status')
                .eq('business_id', biz.id)
                .eq('rd_ticket_id', ticket.id)
                .maybeSingle();

            if (existing) {
                // Check if status changed
                if (existing.last_status !== ticket.status) {
                    statusChanges++;

                    // Update tracking
                    await supabaseAdmin
                        .from('ticket_status_tracking')
                        .update({
                            last_status: ticket.status,
                            current_status: ticket.status,
                        })
                        .eq('id', existing.id);

                    // If the ticket just transitioned to a completed/paid state,
                    // fire a one-shot review request (deduped on ticket id).
                    if (REVIEW_TRIGGER_STATUSES.has(ticket.status)) {
                        const sent = await sendReviewRequest({
                            businessId: biz.id,
                            businessName: biz.name,
                            forwardingNumber: biz.forwarding_number,
                            googleReviewLink: biz.google_review_link,
                            customerPhone: normalizedPhone,
                            customerName: ticket.customer
                                ? `${ticket.customer.first_name || ''} ${ticket.customer.last_name || ''}`.trim()
                                : null,
                            ticketId: ticket.id,
                        });
                        if (sent) reviewRequests++;
                    }

                    // Send SMS if we have a message template for this status
                    const template = STATUS_MESSAGES[ticket.status];
                    if (template && billing.allowed && biz.forwarding_number) {
                        const rateLimit = await checkSmsRateLimit(biz.id, normalizedPhone);
                        if (rateLimit.allowed) {
                            // Check opt-out
                            const { data: optOut } = await supabaseAdmin
                                .from('opt_outs')
                                .select('id')
                                .eq('business_id', biz.id)
                                .eq('phone_number', normalizedPhone)
                                .maybeSingle();

                            if (!optOut) {
                                const body = template
                                    .replace(/\{\{business_name\}\}/g, biz.name)
                                    .replace(/\{\{close_time\}\}/g, 'closing time');

                                try {
                                    await twilioClient.messages.create({
                                        to: normalizedPhone,
                                        from: biz.forwarding_number,
                                        body,
                                    });

                                    await supabaseAdmin
                                        .from('ticket_status_tracking')
                                        .update({ sms_sent_at: new Date().toISOString() })
                                        .eq('id', existing.id);

                                    smsSent++;
                                    logger.info(`${TAG} Status SMS sent`, {
                                        businessId: biz.id,
                                        ticketId: ticket.id.toString(),
                                        status: ticket.status,
                                    });
                                } catch (error) {
                                    logger.error(`${TAG} Failed to send status SMS`, error);
                                }
                            }
                        }
                    }
                }
            } else {
                // First time seeing this ticket — insert tracking without SMS
                await supabaseAdmin
                    .from('ticket_status_tracking')
                    .upsert({
                        business_id: biz.id,
                        rd_ticket_id: ticket.id,
                        customer_phone: normalizedPhone,
                        customer_name: ticket.customer
                            ? `${ticket.customer.first_name || ''} ${ticket.customer.last_name || ''}`.trim()
                            : null,
                        device: ticket.device || null,
                        last_status: ticket.status,
                        current_status: ticket.status,
                    }, {
                        onConflict: 'business_id,rd_ticket_id',
                        ignoreDuplicates: true,
                    });
            }
        }

        const meta = tickets.meta;
        if (!meta || page >= meta.last_page) break;
    }

    return { statusChanges, smsSent, reviewRequests };
}
