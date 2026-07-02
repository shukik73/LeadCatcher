import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { checkBillingStatus } from '@/lib/billing-guard';
import { claimWebhookEvent, markWebhookProcessed, markWebhookFailed, markWebhookFailedIfProcessing, setWebhookBusinessId, hasWebhookSideEffect, recordWebhookSideEffect } from '@/lib/webhook-common';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { buildOwnerSummary, MAX_QUALIFICATION_QUESTIONS, type QualificationData } from '@/lib/lead-qualification';
import { generateReceptionistReply } from '@/lib/ai-receptionist';
import { summarizeHours, type BusinessHours } from '@/lib/business-hours';
import { maybeSendHotLeadAlert } from '@/lib/hot-lead-alert';
import { isCarrierAutoReply } from '@/lib/auto-reply-bounce';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = 'SMS Webhook';

// Two inbound texts arriving within this window only get one auto-reply.
const AUTO_REPLY_DEBOUNCE_MS = 20_000;

export async function POST(request: Request) {
    // 1. SECURITY: Validate request
    const isValid = await validateTwilioRequest(request);
    if (!isValid) {
        logger.warn(`[${TAG}] Invalid Twilio signature`);
        return new Response('Unauthorized', { status: 403 });
    }

    const formData = await request.formData();
    const messageSid = formData.get('MessageSid') as string;
    const fromRaw = formData.get('From') as string;
    const toRaw = formData.get('To') as string;
    const body = formData.get('Body') as string;

    if (!fromRaw || !body) return new Response('Invalid Request', { status: 400 });

    // Idempotency: atomic claim
    if (messageSid) {
        const claim = await claimWebhookEvent(messageSid, 'sms', TAG);
        if (claim.status === 'duplicate') {
            return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
        }
        if (claim.status === 'error') {
            return new Response('Internal Server Error', { status: 500 });
        }
    }

    // Wrap in try/finally to ensure webhook_events.status always reaches a terminal state
    try {
        return await handleSmsWebhook(messageSid, fromRaw, toRaw, body);
    } catch (error) {
        logger.error(`[${TAG}] Unhandled error`, error, { messageSid });
        return new Response('Internal Server Error', { status: 500 });
    } finally {
        if (messageSid) {
            await markWebhookFailedIfProcessing(messageSid);
        }
    }
}

async function handleSmsWebhook(messageSid: string | null, fromRaw: string, toRaw: string, body: string) {
    const from = normalizePhoneNumber(fromRaw);
    const to = normalizePhoneNumber(toRaw);
    const bodyUpper = body.trim().toUpperCase();

    logger.info(`[${TAG}] Message received`, { from, to, bodyLength: body.length });

    // 2. ISOLATION: Find lead based on caller AND business number
    const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('id, owner_phone, name, auto_reply_enabled, forwarding_number, address, services, business_hours, timezone')
        .eq('forwarding_number', to)
        .single();

    if (!business) {
        logger.error(`[${TAG}] No business found for number`, null, { to });
        if (messageSid) await markWebhookFailed(messageSid);
        return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    if (messageSid) await setWebhookBusinessId(messageSid, business.id);

    // 2.5. TCPA COMPLIANCE: Handle STOP keywords (STOP, UNSUBSCRIBE, CANCEL, END, QUIT)
    const stopKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
    const isOptOut = stopKeywords.some(keyword => bodyUpper === keyword || bodyUpper === `${keyword}ALL`);

    if (isOptOut) {
        const optOutKeyword = stopKeywords.find(keyword => bodyUpper.startsWith(keyword)) || 'STOP';

        // Add to opt-out table (upsert to handle re-opts).
        // TCPA: we must confirm the opt-out is PERSISTED before telling the caller
        // they're unsubscribed. If the write fails we fail closed — skip the
        // confirmation and return 500 so the webhook event is reclaimed and retried
        // by Twilio, rather than sending "You have been unsubscribed" while future
        // automated messages keep going out (direct compliance liability).
        const { error: optOutError } = await supabaseAdmin.from('opt_outs').upsert({
            business_id: business.id,
            phone_number: from,
            opt_out_keyword: optOutKeyword,
            opted_out_at: new Date().toISOString()
        }, {
            onConflict: 'business_id,phone_number'
        });

        if (optOutError) {
            logger.error(`[${TAG}] Failed to persist opt-out — failing closed`, optOutError, { from, businessId: business.id });
            if (messageSid) await markWebhookFailed(messageSid);
            return new Response('Internal Server Error', { status: 500 });
        }

        logger.info(`[${TAG}] Opt-out registered`, { from, businessId: business.id, keyword: optOutKeyword });

        // Send confirmation message (TCPA requirement)
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        try {
            await client.messages.create({
                to: from,
                from: to,
                body: `You have been unsubscribed. You will no longer receive messages from ${business.name}. Reply START to resubscribe.`,
            });
        } catch (err) {
            logger.error('Error sending opt-out confirmation', err);
        }

        if (messageSid) await markWebhookProcessed(messageSid);
        return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // 2.6. TCPA COMPLIANCE: Handle START keyword (re-subscribe)
    if (bodyUpper === 'START') {
        // Remove from opt-out table
        await supabaseAdmin.from('opt_outs')
            .delete()
            .eq('business_id', business.id)
            .eq('phone_number', from);

        logger.info(`[${TAG}] Re-subscription`, { from, businessId: business.id });

        // Send confirmation
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        try {
            await client.messages.create({
                to: from,
                from: to,
                body: `You have been resubscribed. You will now receive messages from ${business.name}. Reply STOP to unsubscribe.`,
            });
        } catch (err) {
            logger.error('Error sending resubscription confirmation', err);
        }

        if (messageSid) await markWebhookProcessed(messageSid);
        return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // 2.7. TCPA COMPLIANCE: Check if user is opted out (FAIL CLOSED)
    const { data: optOut, error: optOutError } = await supabaseAdmin
        .from('opt_outs')
        .select('id')
        .eq('business_id', business.id)
        .eq('phone_number', from)
        .maybeSingle();

    if (optOutError) {
        logger.error(`[${TAG}] Opt-out lookup failed, suppressing all outbound SMS (fail closed)`, optOutError, { from, businessId: business.id });
        if (messageSid) await markWebhookProcessed(messageSid);
        return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    if (optOut) {
        logger.info(`[${TAG}] Message from opted-out user ignored`, { from, businessId: business.id });
        if (messageSid) await markWebhookProcessed(messageSid);
        return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    // BILLING GUARD: Check subscription before sending outbound SMS
    const billing = await checkBillingStatus(business.id);

    // Find or Create Lead — upsert to avoid race condition
    const { data: upsertedLead } = await supabaseAdmin
        .from('leads')
        .upsert({
            caller_phone: from,
            status: 'New',
            business_id: business.id,
        }, {
            onConflict: 'business_id,caller_phone',
            ignoreDuplicates: true,
        })
        .select('id, caller_name, qualification_status, qualification_data, qualification_step, qualification_summary_sent_at')
        .single();

    // If upsert returned nothing (ignoreDuplicates), fetch the existing lead
    type LeadCtx = {
        id: string;
        caller_name: string | null;
        qualification_status: string | null;
        qualification_data: QualificationData | null;
        qualification_step: number | null;
        qualification_summary_sent_at: string | null;
    };
    let leadCtx: LeadCtx | null = (upsertedLead as LeadCtx) ?? null;
    if (!leadCtx) {
        const { data: existingLead } = await supabaseAdmin
            .from('leads')
            .select('id, caller_name, qualification_status, qualification_data, qualification_step, qualification_summary_sent_at')
            .eq('caller_phone', from)
            .eq('business_id', business.id)
            .single();
        leadCtx = (existingLead as LeadCtx) ?? null;
    }
    const leadId: string | null = leadCtx?.id ?? null;

    // Carrier / device auto-reply (e.g. "this number is not monitored — try
    // calling") bounced back from a number we texted. It is NOT a real customer
    // reply: log it for the record, stop re-texting a dead number, and stay
    // silent — no owner ping, no engagement, no "Contacted" status.
    if (isCarrierAutoReply(body)) {
        logger.info(`[${TAG}] Carrier auto-reply ignored (not a real reply)`, { from, businessId: business.id });
        if (leadId) {
            await supabaseAdmin.from('messages').insert({ lead_id: leadId, direction: 'inbound', body });
            await supabaseAdmin.from('leads').update({ follow_up_due_at: null }).eq('id', leadId);
        }
        if (messageSid) await markWebhookProcessed(messageSid);
        return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }

    if (leadId) {
        // 3. Log Message + cancel any pending follow-up (customer replied!)
        await supabaseAdmin.from('messages').insert({
            lead_id: leadId,
            direction: 'inbound',
            body: body
        });

        // Cancel follow-up — customer engaged
        await supabaseAdmin.from('leads')
            .update({ follow_up_due_at: null, status: 'Contacted' })
            .eq('id', leadId);

        // 4. AI Analysis (Async-ish)
        try {
            const { analyzeIntent } = await import('@/lib/ai-service');
            const analysis = await analyzeIntent(body);

            logger.info('AI Analysis Result', { analysis, leadId });

            if (analysis.intent !== 'other') {
                await supabaseAdmin.from('leads')
                    .update({
                        intent: analysis.intent,
                        ai_summary: analysis.summary
                    })
                    .eq('id', leadId);
            }
        } catch (error) {
            logger.error('AI Analysis failed', error);
        }

        // 4a. AI RECEPTIONIST — answer-first conversational reply.
        // ONE model call: answers the customer's actual question using real
        // shop facts (services, address, hours), drives the visit, never quotes
        // a price, and extracts device/issue/urgency for the owner on the side.
        // Replaces the old device->issue->urgency interrogation.
        // Customer-facing replies require auto_reply_enabled; when it's off the
        // owner still gets the raw notification in section 5.
        const currentStep = leadCtx?.qualification_step ?? 0;
        const currentData: QualificationData = leadCtx?.qualification_data ?? {};
        let qualificationUrgency: string | null = currentData.urgency ?? null;
        let lastSummary = '';

        if (billing.allowed && business.auto_reply_enabled) {
            // Atomic race guard: when two inbound texts land at the same instant,
            // only the one that wins this conditional update gets to reply. The
            // row-level lock makes the second update match zero rows.
            // last_auto_reply_at defaults to epoch (migration 012), never NULL,
            // so a single .lt(cutoff) reliably means "no reply in the window" —
            // no fragile .or()/null handling that previously errored and muted
            // the bot entirely.
            const claimCutoff = new Date(Date.now() - AUTO_REPLY_DEBOUNCE_MS).toISOString();
            const { data: claimed, error: claimError } = await supabaseAdmin
                .from('leads')
                .update({ last_auto_reply_at: new Date().toISOString() })
                .eq('id', leadId)
                .lt('last_auto_reply_at', claimCutoff)
                .select('id')
                .maybeSingle();

            if (claimError) {
                logger.error(`[${TAG}] Auto-reply claim failed`, claimError, { leadId });
            }

            // Degrade open: a broken guard must never silence the bot. Reply when
            // we won the claim OR the claim mechanism itself errored. Only a clean
            // "already replied within the debounce window" (no row, no error)
            // suppresses the reply.
            if (claimed || claimError) {
                const replyRateLimit = await checkSmsRateLimit(business.id, from);
                if (replyRateLimit.allowed) {
                    try {
                        const hours = summarizeHours(
                            business.business_hours as BusinessHours | null,
                            business.timezone,
                        );
                        const result = await generateReceptionistReply({
                            customerMessage: body,
                            existing: currentData,
                            context: {
                                businessName: business.name || 'our shop',
                                address: business.address,
                                services: business.services,
                                hoursLine: hours.todayLine,
                                isOpenNow: hours.isOpenNow,
                                freeCheck: true,
                            },
                        });

                        qualificationUrgency = result.extracted.urgency ?? qualificationUrgency;

                        // Persist extracted lead intel + status.
                        await supabaseAdmin.from('leads')
                            .update({
                                qualification_status: result.qualified ? 'qualified' : 'in_progress',
                                qualification_data: result.extracted,
                                qualification_step: Math.min(currentStep + 1, MAX_QUALIFICATION_QUESTIONS),
                            })
                            .eq('id', leadId);

                        // Reply to the customer. Reprocessing guard: on a retry of a
                        // failed event, don't re-text the customer (the debounce claim
                        // only covers a 20s window; this covers later retries too).
                        if (result.should_reply && result.reply && !(await hasWebhookSideEffect(messageSid, 'receptionist_reply'))) {
                            try {
                                const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                                await client.messages.create({ to: from, from: to, body: result.reply });
                                await recordWebhookSideEffect(messageSid, 'receptionist_reply');
                                await supabaseAdmin.from('messages').insert({
                                    lead_id: leadId,
                                    direction: 'outbound',
                                    body: result.reply,
                                    is_ai_generated: true,
                                });
                            } catch (err) {
                                logger.error(`[${TAG}] Failed to send receptionist reply`, err);
                            }
                        }

                        // Forward a structured summary to the owner ONCE, when qualified.
                        if (result.qualified && !leadCtx?.qualification_summary_sent_at) {
                            const summary = buildOwnerSummary({
                                customerPhone: from,
                                customerName: leadCtx?.caller_name,
                                data: result.extracted,
                            });
                            lastSummary = summary;
                            const ownerRateLimit = await checkSmsRateLimit(business.id, business.owner_phone);
                            if (business.owner_phone && ownerRateLimit.allowed) {
                                try {
                                    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                                    await client.messages.create({ to: business.owner_phone, from: to, body: summary });
                                    await supabaseAdmin.from('leads')
                                        .update({ qualification_summary_sent_at: new Date().toISOString() })
                                        .eq('id', leadId);
                                } catch (err) {
                                    logger.error(`[${TAG}] Failed to forward lead summary`, err);
                                }
                            }
                        }
                    } catch (error) {
                        logger.error(`[${TAG}] Receptionist failed (non-blocking)`, error);
                    }
                } else {
                    logger.warn(`[${TAG}] Receptionist skipped - rate limited`, { businessId: business.id });
                }
            }
        }

        // 4a.1. HOT LEAD ALERT — fire owner SMS when urgency is high.
        if (qualificationUrgency === 'high') {
            await maybeSendHotLeadAlert({
                leadId,
                businessId: business.id,
                ownerPhone: business.owner_phone,
                forwardingNumber: business.forwarding_number,
                summary: lastSummary || `New high-urgency lead from ${from}: "${body.slice(0, 140)}"`,
                urgency: qualificationUrgency,
            });
        }

        // 5. Notify Owner (only if billing is active and rate limit OK).
        // Skipped when the qualification flow already forwarded a structured
        // summary so the owner doesn't get the same lead twice — either in THIS
        // invocation (lastSummary set) or a prior one (qualification_summary_sent_at
        // persisted), which matters when a failed event is reprocessed on retry.
        const summaryAlreadyForwarded = lastSummary !== '' || !!leadCtx?.qualification_summary_sent_at;
        const ownerRateLimit = await checkSmsRateLimit(business.id, business.owner_phone);
        if (!summaryAlreadyForwarded && business.owner_phone && billing.allowed && ownerRateLimit.allowed) {
            const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            try {
                await client.messages.create({
                    to: business.owner_phone,
                    from: to,
                    body: `New message from ${from}: "${body}"`,
                });
            } catch (err) {
                logger.error('Error notifying owner of SMS:', err);
            }
        } else if (!billing.allowed) {
            logger.warn(`[${TAG}] Skipping owner notification - billing inactive`, { businessId: business.id });
        } else if (!ownerRateLimit.allowed) {
            logger.warn(`[${TAG}] Skipping owner notification - rate limited`, { businessId: business.id });
        }
    }

    // Mark event as fully processed
    if (messageSid) await markWebhookProcessed(messageSid);

    return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
    });
}
