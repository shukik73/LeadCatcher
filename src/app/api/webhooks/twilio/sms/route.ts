import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { checkBillingStatus } from '@/lib/billing-guard';
import { claimWebhookEvent, markWebhookProcessed, markWebhookFailed, markWebhookFailedIfProcessing, setWebhookBusinessId } from '@/lib/webhook-common';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { qualifyLead, buildOwnerSummary, MAX_QUALIFICATION_QUESTIONS, type QualificationData } from '@/lib/lead-qualification';
import { maybeSendHotLeadAlert } from '@/lib/hot-lead-alert';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = 'SMS Webhook';

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
        .select('id, owner_phone, name, auto_reply_enabled, forwarding_number')
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

        // Add to opt-out table (upsert to handle re-opts)
        await supabaseAdmin.from('opt_outs').upsert({
            business_id: business.id,
            phone_number: from,
            opt_out_keyword: optOutKeyword,
            opted_out_at: new Date().toISOString()
        }, {
            onConflict: 'business_id,phone_number'
        });

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

    // 2.7. TCPA COMPLIANCE: Check if user is opted out
    const { data: optOut } = await supabaseAdmin
        .from('opt_outs')
        .select('id')
        .eq('business_id', business.id)
        .eq('phone_number', from)
        .maybeSingle();

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
        .select('id, caller_name, qualification_status, qualification_data, qualification_step')
        .single();

    // If upsert returned nothing (ignoreDuplicates), fetch the existing lead
    type LeadCtx = {
        id: string;
        caller_name: string | null;
        qualification_status: string | null;
        qualification_data: QualificationData | null;
        qualification_step: number | null;
    };
    let leadCtx: LeadCtx | null = (upsertedLead as LeadCtx) ?? null;
    if (!leadCtx) {
        const { data: existingLead } = await supabaseAdmin
            .from('leads')
            .select('id, caller_name, qualification_status, qualification_data, qualification_step')
            .eq('caller_phone', from)
            .eq('business_id', business.id)
            .single();
        leadCtx = (existingLead as LeadCtx) ?? null;
    }
    const leadId: string | null = leadCtx?.id ?? null;

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

        // 4a. AI LEAD QUALIFICATION
        // Asks at most 2-3 short questions to learn device/issue/urgency, then
        // forwards a structured summary to the owner. Skipped when:
        //   - billing inactive, customer opted out (already handled above)
        //   - rate limit blocks the qualification reply
        //   - lead is already qualified
        const currentStatus = leadCtx?.qualification_status ?? 'none';
        const currentStep = leadCtx?.qualification_step ?? 0;
        const currentData: QualificationData = leadCtx?.qualification_data ?? {};
        let qualificationHandled = false;
        let qualificationUrgency: string | null = currentData.urgency ?? null;
        let lastSummary = '';

        if (billing.allowed && currentStatus !== 'qualified') {
            const qualRateLimit = await checkSmsRateLimit(business.id, from);
            if (qualRateLimit.allowed) {
                try {
                    const decision = await qualifyLead({
                        customerMessage: body,
                        existing: currentData,
                        step: currentStep,
                    });
                    qualificationUrgency = decision.extracted.urgency ?? qualificationUrgency;

                    // Persist qualification progress regardless of question/summary outcome.
                    await supabaseAdmin.from('leads')
                        .update({
                            qualification_status: decision.qualified ? 'qualified' : 'in_progress',
                            qualification_data: decision.extracted,
                            qualification_step: Math.min(currentStep + 1, MAX_QUALIFICATION_QUESTIONS),
                        })
                        .eq('id', leadId);

                    if (!decision.qualified && decision.next_question) {
                        try {
                            const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                            await client.messages.create({
                                to: from,
                                from: to,
                                body: decision.next_question,
                            });
                            await supabaseAdmin.from('messages').insert({
                                lead_id: leadId,
                                direction: 'outbound',
                                body: decision.next_question,
                                is_ai_generated: true,
                            });
                            qualificationHandled = true;
                        } catch (err) {
                            logger.error(`[${TAG}] Failed to send qualification question`, err);
                        }
                    } else if (decision.qualified) {
                        const summary = buildOwnerSummary({
                            customerPhone: from,
                            customerName: leadCtx?.caller_name,
                            data: decision.extracted,
                        });
                        lastSummary = summary;

                        const ownerRateLimit = await checkSmsRateLimit(business.id, business.owner_phone);
                        if (business.owner_phone && ownerRateLimit.allowed) {
                            try {
                                const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                                await client.messages.create({
                                    to: business.owner_phone,
                                    from: to,
                                    body: summary,
                                });
                                await supabaseAdmin.from('leads')
                                    .update({ qualification_summary_sent_at: new Date().toISOString() })
                                    .eq('id', leadId);
                                qualificationHandled = true;
                            } catch (err) {
                                logger.error(`[${TAG}] Failed to forward qualification summary`, err);
                            }
                        }
                    }
                } catch (error) {
                    logger.error(`[${TAG}] Qualification failed (non-blocking)`, error);
                }
            } else {
                logger.warn(`[${TAG}] Qualification skipped - rate limited`, { businessId: business.id });
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

        // 4b. AI AUTO-REPLY (if enabled)
        if (!qualificationHandled && business.auto_reply_enabled && billing.allowed) {
            try {
                const { generateAutoReply } = await import('@/lib/ai-auto-reply');
                const autoReply = await generateAutoReply(body, business.name || 'our store');

                if (autoReply && autoReply.should_reply && autoReply.reply) {
                    const replyRateLimit = await checkSmsRateLimit(business.id, from);
                    if (replyRateLimit.allowed) {
                        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                        await client.messages.create({
                            to: from,
                            from: to,
                            body: autoReply.reply,
                        });

                        // Log the auto-reply
                        await supabaseAdmin.from('messages').insert({
                            lead_id: leadId,
                            direction: 'outbound',
                            body: autoReply.reply,
                            is_ai_generated: true,
                        });

                        logger.info(`[${TAG}] AI auto-reply sent`, {
                            from, businessId: business.id,
                            confidence: autoReply.confidence,
                        });
                    }
                }
            } catch (error) {
                logger.error(`[${TAG}] AI auto-reply failed (non-blocking)`, error);
            }
        }

        // 5. Notify Owner (only if billing is active and rate limit OK).
        // Skipped when the qualification flow already forwarded a structured
        // summary so the owner doesn't get the same lead twice.
        const summaryAlreadyForwarded = lastSummary !== '';
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
