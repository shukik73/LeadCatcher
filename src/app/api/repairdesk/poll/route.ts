import { supabaseAdmin } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { isBusinessHours, type BusinessHours } from '@/lib/business-logic';
import { checkBillingStatus } from '@/lib/billing-guard';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const GRACE_PERIOD_MINUTES = 3;

/**
 * GET /api/repairdesk/poll
 *
 * Cron-triggered endpoint (Vercel Cron sends GET) that:
 * 1. Polls RepairDesk for new missed calls
 * 2. Creates leads with a grace period (sms_hold_until)
 * 3. After grace period, checks if user returned the call
 * 4. If no callback detected → sends SMS automatically
 *
 * Secured via CRON_SECRET bearer token (Vercel Cron).
 */
export async function GET(request: Request) {
    // Authenticate cron request
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        logger.warn('[RepairDesk Poll] Unauthorized cron request');
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Get all businesses with RepairDesk configured
        const { data: businesses, error: bizError } = await supabaseAdmin
            .from('businesses')
            .select('id, repairdesk_api_key, repairdesk_store_url, repairdesk_last_poll_at, forwarding_number, name, sms_template, sms_template_closed, business_hours, timezone')
            .not('repairdesk_api_key', 'is', null);

        if (bizError) {
            logger.error('[RepairDesk Poll] Failed to fetch businesses', bizError);
            return Response.json({ error: 'Database error' }, { status: 500 });
        }

        if (!businesses || businesses.length === 0) {
            return Response.json({ message: 'No businesses with RepairDesk configured' });
        }

        const results = [];

        for (const business of businesses) {
            try {
                const result = await pollBusiness(business);
                results.push({ businessId: business.id, ...result });
            } catch (error) {
                logger.error('[RepairDesk Poll] Error polling business', error, {
                    businessId: business.id,
                });
                results.push({ businessId: business.id, error: 'Poll failed' });
            }
        }

        logger.info('[RepairDesk Poll] Completed', {
            businessCount: businesses.length.toString(),
        });

        return Response.json({ success: true, results });
    } catch (error) {
        logger.error('[RepairDesk Poll] Error', error);
        return Response.json({ error: 'Poll failed' }, { status: 500 });
    }
}

interface BusinessRow {
    id: string;
    repairdesk_api_key: string;
    repairdesk_store_url: string | null;
    repairdesk_last_poll_at: string | null;
    forwarding_number: string;
    name: string;
    sms_template: string | null;
    sms_template_closed: string | null;
    business_hours: BusinessHours | null;
    timezone: string | null;
}

async function pollBusiness(business: BusinessRow) {
    const client = new RepairDeskClient(
        business.repairdesk_api_key,
        business.repairdesk_store_url || undefined
    );

    let newMissedCalls = 0;
    let smsSent = 0;
    let callbacksDetected = 0;

    // --- Phase 1: Fetch new missed calls and create leads with grace period ---
    try {
        const since = business.repairdesk_last_poll_at || undefined;
        const missedCalls = await client.getMissedCalls(1, since);

        for (const call of missedCalls.data) {
            if (!call.phone) continue;

            let normalizedPhone: string;
            try {
                normalizedPhone = normalizePhoneNumber(call.phone);
            } catch {
                logger.warn('[RepairDesk Poll] Skipping call with invalid phone', {
                    callId: call.id.toString(),
                    phone: call.phone,
                });
                continue;
            }

            const externalId = `rd-call-${call.id}`;
            const holdUntil = new Date(Date.now() + GRACE_PERIOD_MINUTES * 60 * 1000).toISOString();

            const callerName = call.customer_name || null;

            // Create lead with grace period — skip if already imported
            const { error } = await supabaseAdmin
                .from('leads')
                .upsert(
                    {
                        business_id: business.id,
                        caller_phone: normalizedPhone,
                        caller_name: callerName,
                        source: 'repairdesk',
                        external_id: externalId,
                        status: 'New',
                        sms_hold_until: holdUntil,
                    },
                    {
                        onConflict: 'business_id,source,external_id',
                        ignoreDuplicates: true,
                    }
                );

            if (error) {
                logger.error('[RepairDesk Poll] Failed to upsert missed call lead', error, {
                    callId: call.id.toString(),
                });
            } else {
                newMissedCalls++;
            }
        }
    } catch (error) {
        logger.error('[RepairDesk Poll] Failed to fetch missed calls', error, {
            businessId: business.id,
        });
    }

    // --- Phase 2: Process leads whose grace period has expired ---
    // Atomically claim leads by updating status to 'Processing' in a single query.
    // This prevents concurrent cron runs from double-selecting the same leads.
    const { data: claimedLeads, error: claimError } = await supabaseAdmin
        .from('leads')
        .update({ status: 'Processing' })
        .eq('business_id', business.id)
        .eq('source', 'repairdesk')
        .eq('status', 'New')
        .not('sms_hold_until', 'is', null)
        .lt('sms_hold_until', new Date().toISOString())
        .select('id, caller_phone, caller_name, external_id, sms_hold_until, created_at');

    if (claimError) {
        logger.error('[RepairDesk Poll] Failed to claim pending leads', claimError);
    }

    // Billing guard: check once per business before sending any SMS
    const billing = await checkBillingStatus(business.id);

    if (claimedLeads && claimedLeads.length > 0) {
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        for (const lead of claimedLeads) {
            try {
                // Check if user returned the call since the lead was created
                const callbackDetected = await checkForCallback(client, lead.caller_phone, lead.created_at);

                if (callbackDetected) {
                    // User already returned the call — mark as Contacted, clear hold
                    await supabaseAdmin
                        .from('leads')
                        .update({ status: 'Contacted', sms_hold_until: null })
                        .eq('id', lead.id);

                    callbacksDetected++;
                    logger.info('[RepairDesk Poll] Callback detected, skipping SMS', {
                        leadId: lead.id,
                        phone: lead.caller_phone,
                    });
                } else if (!billing.allowed) {
                    // Billing inactive — revert to New so it can be retried later
                    await supabaseAdmin
                        .from('leads')
                        .update({ status: 'New' })
                        .eq('id', lead.id);
                    logger.warn('[RepairDesk Poll] Skipping SMS - billing inactive', {
                        leadId: lead.id,
                        businessId: business.id,
                    });
                } else {
                    // No callback — send SMS
                    const sent = await sendMissedCallSms(
                        twilioClient,
                        business,
                        lead
                    );

                    if (sent) {
                        smsSent++;
                    } else {
                        // Revert to New if SMS failed so it can be retried
                        await supabaseAdmin
                            .from('leads')
                            .update({ status: 'New' })
                            .eq('id', lead.id);
                    }
                }
            } catch (error) {
                logger.error('[RepairDesk Poll] Error processing pending lead', error, {
                    leadId: lead.id,
                });
                // Revert to New on unexpected errors
                await supabaseAdmin
                    .from('leads')
                    .update({ status: 'New' })
                    .eq('id', lead.id);
            }
        }
    }

    // Update last poll timestamp
    await supabaseAdmin
        .from('businesses')
        .update({ repairdesk_last_poll_at: new Date().toISOString() })
        .eq('id', business.id);

    return { newMissedCalls, smsSent, callbacksDetected };
}

/**
 * Check if the user returned a call to this phone number.
 * Looks for outbound calls in RepairDesk since the lead was created
 * (i.e. since the missed call was first detected), covering the full
 * grace window.
 */
async function checkForCallback(
    client: RepairDeskClient,
    phone: string,
    since: string
): Promise<boolean> {
    try {
        const outboundCalls = await client.getOutboundCallsTo(phone, since);
        return outboundCalls.data.length > 0;
    } catch (error) {
        // If the API call fails, err on the side of sending the SMS
        logger.warn('[RepairDesk Poll] Failed to check for callback, will send SMS', {
            phone,
            error: error instanceof Error ? error.message : 'Unknown',
        });
        return false;
    }
}

/**
 * Send the missed call follow-up SMS via Twilio.
 */
async function sendMissedCallSms(
    twilioClient: ReturnType<typeof twilio>,
    business: BusinessRow,
    lead: { id: string; caller_phone: string; caller_name: string | null }
): Promise<boolean> {
    // TCPA compliance: check opt-out list
    // FAIL CLOSED: if the opt-out lookup errors, do NOT send SMS
    const { data: optOut, error: optOutError } = await supabaseAdmin
        .from('opt_outs')
        .select('id')
        .eq('business_id', business.id)
        .eq('phone_number', lead.caller_phone)
        .maybeSingle();

    if (optOutError) {
        logger.error('[RepairDesk Poll] Opt-out check failed, suppressing SMS (fail closed)', optOutError, {
            leadId: lead.id,
            phone: lead.caller_phone,
        });
        return false;
    }

    if (optOut) {
        logger.info('[RepairDesk Poll] Skipping SMS - user opted out', {
            leadId: lead.id,
            phone: lead.caller_phone,
        });
        // Clear the hold so we don't keep checking
        await supabaseAdmin
            .from('leads')
            .update({ sms_hold_until: null })
            .eq('id', lead.id);
        return false;
    }

    // Pick template based on business hours
    const timezone = business.timezone || 'America/New_York';
    const isOpen = isBusinessHours(business.business_hours, timezone);

    const defaultOpen = "Hi! We missed your call — we were helping another customer. How can we help you? Would you like us to give you a call back in a few?";
    const defaultClosed = "Hi! Our store is currently closed. How can we help you? Would you like us to schedule an appointment for when we open?";

    const template = isOpen
        ? (business.sms_template || defaultOpen)
        : (business.sms_template_closed || defaultClosed);
    const body = template.replace(/\{\{business_name\}\}/g, business.name || 'our business');

    try {
        await twilioClient.messages.create({
            to: lead.caller_phone,
            from: business.forwarding_number,
            body,
        });

        // Log the message
        await supabaseAdmin.from('messages').insert({
            lead_id: lead.id,
            direction: 'outbound',
            body,
        });

        // Update lead status and clear hold
        await supabaseAdmin
            .from('leads')
            .update({ status: 'Contacted', sms_hold_until: null })
            .eq('id', lead.id);

        logger.info('[RepairDesk Poll] SMS sent', {
            leadId: lead.id,
            phone: lead.caller_phone,
        });

        return true;
    } catch (error) {
        logger.error('[RepairDesk Poll] Failed to send SMS', error, {
            leadId: lead.id,
            phone: lead.caller_phone,
        });
        return false;
    }
}
