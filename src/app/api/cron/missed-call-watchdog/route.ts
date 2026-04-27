import { supabaseAdmin } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { checkBillingStatus } from '@/lib/billing-guard';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = '[Missed Call Watchdog]';
const LOOKBACK_MINUTES = 20;

function verifyCronSecret(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || !header) return false;
    const expected = `Bearer ${secret}`;
    if (header.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * GET /api/cron/missed-call-watchdog
 *
 * Runs every 10-15 minutes. For each business with RepairDesk:
 * 1. Checks RepairDesk for missed calls in the last 20 minutes
 * 2. Checks if there was a return call to that number
 * 3. If NO return call → sends SMS: "Sorry we missed your call..."
 * 4. If return call found → marks as handled, no SMS
 *
 * This is a BACKUP for when Twilio call forwarding isn't working.
 * The primary missed-call SMS flow is the Twilio voice webhook.
 */
export async function GET(request: Request) {
    if (!verifyCronSecret(request.headers.get('authorization'))) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data: businesses } = await supabaseAdmin
            .from('businesses')
            .select('id, name, repairdesk_api_key, repairdesk_store_url, forwarding_number, owner_phone, sms_template, timezone')
            .not('repairdesk_api_key', 'is', null)
            .not('forwarding_number', 'is', null);

        if (!businesses || businesses.length === 0) {
            return Response.json({ message: 'No businesses configured' });
        }

        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const results = [];
        const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();

        for (const biz of businesses) {
            try {
                const client = new RepairDeskClient(
                    biz.repairdesk_api_key,
                    biz.repairdesk_store_url || undefined,
                );

                const billing = await checkBillingStatus(biz.id);
                let missedFound = 0;
                let smsSent = 0;
                let alreadyReturned = 0;

                // Get missed calls from the last 20 minutes
                const missedCalls = await client.getMissedCalls(1, since);

                for (const call of missedCalls.data) {
                    if (!call.phone) continue;

                    let phone: string;
                    try {
                        phone = normalizePhoneNumber(call.phone);
                    } catch {
                        continue;
                    }

                    missedFound++;

                    // Check if we already handled this call (sent SMS or it's in our DB)
                    const externalId = `watchdog-${call.id}`;
                    const { data: existing } = await supabaseAdmin
                        .from('leads')
                        .select('id')
                        .eq('business_id', biz.id)
                        .eq('external_id', externalId)
                        .maybeSingle();

                    if (existing) continue; // Already processed

                    // Check if someone returned the call
                    let returnCallFound = false;
                    try {
                        const outbound = await client.getOutboundCallsTo(phone, call.created_at);
                        returnCallFound = outbound.data.length > 0;
                    } catch {
                        // If lookup fails, err on the side of sending SMS
                    }

                    if (returnCallFound) {
                        alreadyReturned++;
                        // Mark as handled so we don't check again
                        await supabaseAdmin.from('leads').upsert({
                            business_id: biz.id,
                            caller_phone: phone,
                            caller_name: call.customer_name || null,
                            status: 'Contacted',
                            source: 'repairdesk',
                            external_id: externalId,
                        }, {
                            onConflict: 'business_id,source,external_id',
                            ignoreDuplicates: true,
                        });
                        continue;
                    }

                    // No return call → send SMS
                    if (!billing.allowed) continue;

                    // TCPA: check opt-out
                    const { data: optOut, error: optError } = await supabaseAdmin
                        .from('opt_outs')
                        .select('id')
                        .eq('business_id', biz.id)
                        .eq('phone_number', phone)
                        .maybeSingle();

                    if (optError || optOut) continue;

                    const rateLimit = await checkSmsRateLimit(biz.id, phone);
                    if (!rateLimit.allowed) continue;

                    const message = biz.sms_template
                        ? biz.sms_template.replace(/\{\{business_name\}\}/g, biz.name)
                        : `Hi! Sorry we missed your call at ${biz.name}. We were busy at the front desk. Is there anything we can help you with? Reply here and we'll get right back to you!`;

                    try {
                        await twilioClient.messages.create({
                            to: phone,
                            from: biz.forwarding_number,
                            body: message,
                        });

                        // Create lead and log message
                        const { data: lead } = await supabaseAdmin.from('leads').upsert({
                            business_id: biz.id,
                            caller_phone: phone,
                            caller_name: call.customer_name || null,
                            status: 'Contacted',
                            source: 'repairdesk',
                            external_id: externalId,
                        }, {
                            onConflict: 'business_id,source,external_id',
                            ignoreDuplicates: false,
                        }).select('id').single();

                        if (lead) {
                            await supabaseAdmin.from('messages').insert({
                                lead_id: lead.id,
                                direction: 'outbound',
                                body: message,
                            });
                        }

                        // Notify owner
                        if (biz.owner_phone) {
                            try {
                                await twilioClient.messages.create({
                                    to: biz.owner_phone,
                                    from: biz.forwarding_number,
                                    body: `Missed call from ${call.customer_name || phone}. Auto-SMS sent. No return call detected.`,
                                });
                            } catch {
                                // non-blocking
                            }
                        }

                        smsSent++;
                        logger.info(`${TAG} SMS sent for unreturned missed call`, {
                            businessId: biz.id, phone,
                        });
                    } catch (error) {
                        logger.error(`${TAG} Failed to send SMS`, error, { phone });
                    }
                }

                results.push({
                    businessId: biz.id,
                    missedFound,
                    alreadyReturned,
                    smsSent,
                });
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
