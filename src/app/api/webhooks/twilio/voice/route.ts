import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { isBusinessHours, type BusinessHours } from '@/lib/business-logic';
import { checkBillingStatus } from '@/lib/billing-guard';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    // 1. SECURITY
    const isValid = await validateTwilioRequest(request);
    if (!isValid) {
        logger.warn('[Voice Webhook] Invalid Twilio signature');
        return new Response('Unauthorized', { status: 403 });
    }

    const formData = await request.formData();
    const callSid = formData.get('CallSid') as string;
    const callerRaw = formData.get('Caller') as string;
    const calledRaw = formData.get('Called') as string;

    if (!callerRaw) return new Response('No caller found', { status: 400 });

    // Idempotency: atomic claim via INSERT ... ON CONFLICT DO NOTHING.
    // Only the first request to claim the event_id proceeds; retries get 0 rows.
    if (callSid) {
        const { data: claimed, error: claimError } = await supabaseAdmin
            .from('webhook_events')
            .insert({
                event_id: callSid,
                event_type: 'voice',
                status: 'processing',
            })
            .select('id')
            .maybeSingle();

        if (claimError) {
            const isUniqueViolation = claimError.code === '23505';
            if (isUniqueViolation) {
                logger.info('[Voice Webhook] Duplicate CallSid, skipping', { callSid });
                const dup = new twilio.twiml.VoiceResponse();
                dup.hangup();
                return new Response(dup.toString(), { headers: { 'Content-Type': 'text/xml' } });
            }
            // Real DB error — return 500 so Twilio retries
            logger.error('[Voice Webhook] Failed to claim event', claimError, { callSid });
            return new Response('Internal Server Error', { status: 500 });
        }

        if (!claimed) {
            logger.info('[Voice Webhook] Duplicate CallSid, skipping', { callSid });
            const dup = new twilio.twiml.VoiceResponse();
            dup.hangup();
            return new Response(dup.toString(), { headers: { 'Content-Type': 'text/xml' } });
        }
    }

    // Wrap in try/finally to ensure webhook_events.status always reaches a terminal state
    try {
        return await handleVoiceWebhook(callSid, callerRaw, calledRaw);
    } catch (error) {
        logger.error('[Voice Webhook] Unhandled error', error, { callSid });
        return new Response('Internal Server Error', { status: 500 });
    } finally {
        // Safety net: transition any still-processing event to 'failed'.
        // If handler already set 'processed', this conditional update is a no-op.
        if (callSid) {
            await supabaseAdmin.from('webhook_events')
                .update({ status: 'failed' })
                .eq('event_id', callSid)
                .eq('status', 'processing');
        }
    }
}

async function handleVoiceWebhook(callSid: string | null, callerRaw: string, calledRaw: string) {
    const caller = normalizePhoneNumber(callerRaw);
    const called = normalizePhoneNumber(calledRaw);

    logger.info(`[Voice Webhook] Incoming call`, { caller, called });

    // 2. ISOLATION: Look up business
    const { data: business, error: bizError } = await supabaseAdmin
        .from('businesses')
        .select('id, owner_phone, name, business_hours, timezone, sms_template, sms_template_closed, verification_token')
        .eq('forwarding_number', called)
        .single();

    if (bizError || !business) {
        logger.error(`[Voice Webhook] No business found`, bizError, { called });
        if (callSid) {
            await supabaseAdmin.from('webhook_events')
                .update({ status: 'failed' })
                .eq('event_id', callSid);
        }
        const response = new twilio.twiml.VoiceResponse();
        response.say("We're sorry, this number is not configured correctly. Goodbye.");
        response.hangup();
        return new Response(response.toString(), { headers: { 'Content-Type': 'text/xml' } });
    }

    // Update the claimed event with the business_id
    if (callSid) {
        await supabaseAdmin.from('webhook_events')
            .update({ business_id: business.id })
            .eq('event_id', callSid);
    }

    // VERIFICATION: If business has a pending verification_token, this incoming
    // call proves forwarding works. Mark verified=true via webhook confirmation.
    if (business.verification_token) {
        await supabaseAdmin
            .from('businesses')
            .update({ verified: true, verification_token: null })
            .eq('id', business.id);
        logger.info('[Voice Webhook] Business forwarding verified via webhook', { businessId: business.id });
    }

    logger.info(`[Voice Webhook] Missed call for business`, { business: business.name });

    // 3. CHECK BUSINESS HOURS
    const hours = business.business_hours as BusinessHours | null;
    const timezone = business.timezone || 'America/New_York';
    const isOpen = isBusinessHours(hours, timezone);

    logger.info(`[Voice Webhook] Processing missed call. Business Open: ${isOpen}`);

    // 4. BILLING GUARD: Check subscription before sending SMS
    const billing = await checkBillingStatus(business.id);

    // 5. TCPA COMPLIANCE: Check if user is opted out before sending any SMS
    // FAIL CLOSED: if the opt-out lookup errors, do NOT send SMS
    const { data: optOut, error: optOutError } = await supabaseAdmin
        .from('opt_outs')
        .select('id')
        .eq('business_id', business.id)
        .eq('phone_number', caller)
        .maybeSingle();

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    if (optOutError) {
        logger.error('[Voice Webhook] Opt-out check failed, suppressing SMS (fail closed)', optOutError, { caller, businessId: business.id });
    }

    // 6. PREPARE MESSAGE (only if billing active, not opted out, AND lookup succeeded)
    if (billing.allowed && !optOut && !optOutError) {
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
        } catch (error) {
            logger.error('Error sending immediate ack:', error);
        }
    } else if (!billing.allowed) {
        logger.warn('[Voice Webhook] Skipping SMS - billing inactive', { businessId: business.id });
    } else {
        logger.info('[Voice Webhook] Skipping immediate ack - user opted out or lookup failed', { caller, businessId: business.id });
    }

    // 7. Log Lead (Scoped to Business)
    const { data: existingLead } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('caller_phone', caller)
        .eq('business_id', business.id)
        .single();

    if (!existingLead) {
        const { error } = await supabaseAdmin.from('leads').insert({
            caller_phone: caller,
            status: 'New',
            business_id: business.id
        });
        if (error) logger.error('Error creating lead:', error);
    }

    // 8. TwiML: Greeting + Record
    const response = new twilio.twiml.VoiceResponse();
    // Sanitize business name for TwiML (prevent injection)
    const safeName = (business.name || 'our business').replace(/[<>&"']/g, '');
    response.say({ voice: 'alice' }, `Hello! You've reached ${safeName}. We are currently assisting other clients. Please leave your name and how we can help, and I will have a team member text you back immediately.`);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!baseUrl) {
        logger.error('[Voice Webhook] NEXT_PUBLIC_APP_URL missing; cannot build transcription callback URL');
        const errorResponse = new twilio.twiml.VoiceResponse();
        errorResponse.say({ voice: 'alice' }, 'We apologize, but we are experiencing technical difficulties. Please try again later.');
        errorResponse.hangup();
        return new Response(errorResponse.toString(), { headers: { 'Content-Type': 'text/xml' } });
    }
    const callbackUrl = `${baseUrl}/api/webhooks/twilio/transcription?businessId=${business.id}&caller=${encodeURIComponent(caller)}&called=${encodeURIComponent(called)}`;

    response.record({
        transcribe: true,
        transcribeCallback: callbackUrl,
        maxLength: 60,
        playBeep: true,
    });

    response.hangup();

    // Mark event as fully processed after all side effects succeeded
    if (callSid) {
        await supabaseAdmin.from('webhook_events')
            .update({ status: 'processed', processed_at: new Date().toISOString() })
            .eq('event_id', callSid);
    }

    return new Response(response.toString(), {
        headers: { 'Content-Type': 'text/xml' },
    });
}
