import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { isBusinessHours, type BusinessHours } from '@/lib/business-logic';
import { checkBillingStatus } from '@/lib/billing-guard';
import { claimWebhookEvent, markWebhookProcessed, markWebhookFailed, markWebhookFailedIfProcessing, setWebhookBusinessId, checkOptOut } from '@/lib/webhook-common';
import { signCallbackParams } from '@/lib/callback-signature';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { getWebhookBaseUrl } from '@/lib/webhook-url';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = 'Voice Webhook';

export async function POST(request: Request) {
    // 1. SECURITY
    const isValid = await validateTwilioRequest(request);
    if (!isValid) {
        logger.warn(`[${TAG}] Invalid Twilio signature`);
        return new Response('Unauthorized', { status: 403 });
    }

    const formData = await request.formData();
    const callSid = formData.get('CallSid') as string;
    const callerRaw = formData.get('Caller') as string;
    const calledRaw = formData.get('Called') as string;

    if (!callerRaw) return new Response('No caller found', { status: 400 });

    // Idempotency: atomic claim
    if (callSid) {
        const claim = await claimWebhookEvent(callSid, 'voice', TAG);
        if (claim.status === 'duplicate') {
            const dup = new twilio.twiml.VoiceResponse();
            dup.hangup();
            return new Response(dup.toString(), { headers: { 'Content-Type': 'text/xml' } });
        }
        if (claim.status === 'error') {
            return new Response('Internal Server Error', { status: 500 });
        }
    }

    // Wrap in try/finally to ensure webhook_events.status always reaches a terminal state
    try {
        return await handleVoiceWebhook(callSid, callerRaw, calledRaw);
    } catch (error) {
        logger.error(`[${TAG}] Unhandled error`, error, { callSid });
        return new Response('Internal Server Error', { status: 500 });
    } finally {
        if (callSid) {
            await markWebhookFailedIfProcessing(callSid);
        }
    }
}

async function handleVoiceWebhook(callSid: string | null, callerRaw: string, calledRaw: string) {
    const caller = normalizePhoneNumber(callerRaw);
    const called = normalizePhoneNumber(calledRaw);

    logger.info(`[${TAG}] Incoming call`, { caller, called });

    // 2. ISOLATION: Look up business
    const { data: business, error: bizError } = await supabaseAdmin
        .from('businesses')
        .select('id, owner_phone, name, business_hours, timezone, sms_template, sms_template_closed, verification_token, verification_call_sid')
        .eq('forwarding_number', called)
        .single();

    if (bizError || !business) {
        logger.error(`[${TAG}] No business found`, bizError, { called });
        if (callSid) await markWebhookFailed(callSid);
        const response = new twilio.twiml.VoiceResponse();
        response.say("We're sorry, this number is not configured correctly. Goodbye.");
        response.hangup();
        return new Response(response.toString(), { headers: { 'Content-Type': 'text/xml' } });
    }

    if (callSid) await setWebhookBusinessId(callSid, business.id);

    // VERIFICATION: If business has a pending verification_token, any incoming
    // call reaching this webhook proves call forwarding is working.
    // Note: forwarded calls arrive with a NEW CallSid (different from the
    // outbound call we initiated), so we cannot match on CallSid.
    // The verification_token window is short-lived (set moments before the
    // test call), so accepting any call during this window is safe.
    if (business.verification_token) {
        await supabaseAdmin
            .from('businesses')
            .update({ verified: true, verification_token: null, verification_call_sid: null })
            .eq('id', business.id);
        logger.info(`[${TAG}] Business forwarding verified via webhook`, { businessId: business.id });
    }

    logger.info(`[${TAG}] Missed call for business`, { business: business.name });

    // 3. CHECK BUSINESS HOURS
    const hours = business.business_hours as BusinessHours | null;
    const timezone = business.timezone || 'America/New_York';
    const isOpen = isBusinessHours(hours, timezone);

    logger.info(`[${TAG}] Processing missed call. Business Open: ${isOpen}`);

    // 4. BILLING GUARD: Check subscription before sending SMS
    const billing = await checkBillingStatus(business.id);

    // 5. TCPA COMPLIANCE: Check opt-out (fail closed)
    const optOutResult = await checkOptOut(business.id, caller, TAG);

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    // 5b. SMS RATE LIMIT
    const rateLimit = await checkSmsRateLimit(business.id, caller);

    // 6. PREPARE MESSAGE (only if billing active, not opted out, rate limit OK, AND lookup succeeded)
    if (billing.allowed && !optOutResult.optedOut && !optOutResult.error && rateLimit.allowed) {
        try {
            const defaultOpen = "Hi! We missed your call — we were helping another customer. How can we help you? Would you like us to give you a call back in a few?";
            const defaultClosed = "Hi! Our store is currently closed. How can we help you? Would you like us to schedule an appointment for when we open?";

            const template = isOpen
                ? (business.sms_template || defaultOpen)
                : (business.sms_template_closed || defaultClosed);
            const message = template.replace(/\{\{business_name\}\}/g, business.name || 'our business');

            await client.messages.create({
                to: caller,
                from: called,
                body: message,
            });

            // Log the auto-reply so dashboard shows it and rate limiter counts it
            try {
                // Get lead_id for this caller (may not exist yet if upsert below hasn't run)
                const { data: lead } = await supabaseAdmin
                    .from('leads')
                    .select('id')
                    .eq('business_id', business.id)
                    .eq('caller_phone', caller)
                    .single();
                if (lead) {
                    await supabaseAdmin.from('messages').insert({
                        lead_id: lead.id,
                        direction: 'outbound',
                        body: message,
                    });
                }
            } catch (logErr) {
                logger.error(`[${TAG}] Failed to log auto-reply message`, logErr);
            }
        } catch (error) {
            logger.error('Error sending immediate ack:', error);
        }
    } else if (!billing.allowed) {
        logger.warn(`[${TAG}] Skipping SMS - billing inactive`, { businessId: business.id });
    } else if (!rateLimit.allowed) {
        logger.warn(`[${TAG}] Skipping SMS - rate limited`, { businessId: business.id, caller, reason: rateLimit.reason });
    } else {
        logger.info(`[${TAG}] Skipping immediate ack - user opted out or lookup failed`, { caller, businessId: business.id });
    }

    // 7. Log Lead (Scoped to Business) — upsert to avoid race condition with concurrent calls
    const { error: leadError } = await supabaseAdmin.from('leads').upsert({
        caller_phone: caller,
        status: 'New',
        business_id: business.id,
    }, {
        onConflict: 'business_id,caller_phone',
        ignoreDuplicates: true,
    });
    if (leadError) logger.error('Error upserting lead:', leadError);

    // 7b. Create call_analyses record for the Call Review dashboard
    // Uses fast defaults — AI scoring happens later when transcription arrives
    const sourceCallId = callSid || `voice-${Date.now()}-${caller}`;
    try {
        const { error: analysisError } = await supabaseAdmin
            .from('call_analyses')
            .insert({
                business_id: business.id,
                source_call_id: sourceCallId,
                customer_phone: caller,
                call_status: 'missed',
                summary: 'Missed call — waiting for voicemail transcription',
                sentiment: 'neutral',
                category: 'follow_up',
                urgency: 'medium',
                follow_up_needed: true,
                follow_up_notes: 'Call the customer back to follow up on their missed call.',
                callback_status: 'pending',
                due_by: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
                processed_at: new Date().toISOString(),
            });

        if (analysisError && analysisError.code !== '23505') {
            logger.error(`[${TAG}] Failed to create call_analyses record`, analysisError);
        } else {
            logger.info(`[${TAG}] Call analysis created`, { sourceCallId });
        }
    } catch (error) {
        // Non-blocking — don't fail the webhook if analysis creation fails
        logger.error(`[${TAG}] Error creating call analysis`, error);
    }

    // 8. TwiML: Greeting + Record
    const response = new twilio.twiml.VoiceResponse();
    // Sanitize business name for TwiML (prevent injection)
    const safeName = (business.name || 'our business').replace(/[<>&"']/g, '');
    response.say({ voice: 'alice' }, `Hello! You've reached ${safeName}. We are currently assisting other clients. Please leave your name and how we can help, and I will have a team member text you back immediately.`);

    const baseUrl = getWebhookBaseUrl();
    if (!baseUrl) {
        logger.error(`[${TAG}] Webhook base URL missing; cannot build transcription callback URL`);
        const errorResponse = new twilio.twiml.VoiceResponse();
        errorResponse.say({ voice: 'alice' }, 'We apologize, but we are experiencing technical difficulties. Please try again later.');
        errorResponse.hangup();
        return new Response(errorResponse.toString(), { headers: { 'Content-Type': 'text/xml' } });
    }
    const sig = signCallbackParams(business.id, caller, called);
    const callbackUrl = `${baseUrl}/api/webhooks/twilio/transcription?businessId=${business.id}&caller=${encodeURIComponent(caller)}&called=${encodeURIComponent(called)}&callSid=${encodeURIComponent(sourceCallId)}&sig=${sig}`;

    response.record({
        transcribe: true,
        transcribeCallback: callbackUrl,
        maxLength: 60,
        playBeep: true,
    });

    response.hangup();

    // Mark event as fully processed after all side effects succeeded
    if (callSid) await markWebhookProcessed(callSid);

    return new Response(response.toString(), {
        headers: { 'Content-Type': 'text/xml' },
    });
}
