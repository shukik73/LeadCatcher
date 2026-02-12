import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { isBusinessHours, type BusinessHours } from '@/lib/business-logic';
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
    const callerRaw = formData.get('Caller') as string;
    const calledRaw = formData.get('Called') as string;

    if (!callerRaw) return new Response('No caller found', { status: 400 });

    const caller = normalizePhoneNumber(callerRaw);
    const called = normalizePhoneNumber(calledRaw);

    logger.info(`[Voice Webhook] Incoming call`, { caller, called });

    // 2. ISOLATION: Look up business
    const { data: business, error: bizError } = await supabaseAdmin
        .from('businesses')
        .select('id, owner_phone, name, business_hours, timezone, sms_template, sms_template_closed')
        .eq('forwarding_number', called)
        .single();

    if (bizError || !business) {
        logger.error(`[Voice Webhook] No business found`, bizError, { called });
        const response = new twilio.twiml.VoiceResponse();
        response.say("We're sorry, this number is not configured correctly. Goodbye.");
        response.hangup();
        return new Response(response.toString(), { headers: { 'Content-Type': 'text/xml' } });
    }

    logger.info(`[Voice Webhook] Missed call for business`, { business: business.name });

    // 3. CHECK BUSINESS HOURS
    const hours = business.business_hours as BusinessHours | null;
    const timezone = business.timezone || 'America/New_York';
    const isOpen = isBusinessHours(hours, timezone);

    // LOGIC: We currently trigger the "Missed Call Text Back" 24/7.
    // In the future, we might want to vary the message based on 'isOpen'.
    logger.info(`[Voice Webhook] Processing missed call. Business Open: ${isOpen}`);

    // 4. TCPA COMPLIANCE: Check if user is opted out before sending any SMS
    const { data: optOut } = await supabaseAdmin
        .from('opt_outs')
        .select('id')
        .eq('business_id', business.id)
        .eq('phone_number', caller)
        .maybeSingle();

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    // 5. PREPARE MESSAGE (only if not opted out) — use time-aware template
    if (!optOut) {
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
    } else {
        logger.info('[Voice Webhook] Skipping immediate ack - user opted out', { caller, businessId: business.id });
    }

    // 6. Log Lead (Scoped to Business)
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

    // 7. TwiML: Greeting + Record
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

    return new Response(response.toString(), {
        headers: { 'Content-Type': 'text/xml' },
    });
}
