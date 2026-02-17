import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { analyzeIntent } from '@/lib/ai-service';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    // 1. SECURITY: Validate Twilio signature - STRICT validation required
    const isValid = await validateTwilioRequest(request);
    if (!isValid) {
        logger.warn('[Transcription Webhook] Invalid Twilio signature - rejecting request');
        return new Response('Unauthorized', { status: 403 });
    }

    const formData = await request.formData();
    const recordingSid = formData.get('RecordingSid') as string;
    const transcriptionText = formData.get('TranscriptionText') as string;
    const transcriptionStatus = formData.get('TranscriptionStatus') as string;

    // Idempotency: skip if we already processed this RecordingSid
    if (recordingSid) {
        const { data: existing } = await supabaseAdmin
            .from('webhook_events')
            .select('id')
            .eq('event_id', recordingSid)
            .maybeSingle();

        if (existing) {
            logger.info('[Transcription Webhook] Duplicate RecordingSid, skipping', { recordingSid });
            return new Response('OK');
        }

        // Record this event
        await supabaseAdmin.from('webhook_events').insert({
            event_id: recordingSid,
            event_type: 'transcription',
        }).catch(() => { /* unique constraint = already recorded */ });
    }

    // URL Params passed in callback URL — validate format after presence check
    const url = new URL(request.url);
    const businessId = url.searchParams.get('businessId');
    const caller = url.searchParams.get('caller'); // E.164
    const called = url.searchParams.get('called'); // E.164

    if (!businessId || !caller || !called) {
        logger.error('Missing params in transcription callback', null, { url: request.url });
        return new Response('Missing params', { status: 400 });
    }

    // Validate param formats to prevent injection via crafted callback URLs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const e164Regex = /^\+[1-9]\d{1,14}$/;

    if (!uuidRegex.test(businessId) || !e164Regex.test(caller) || !e164Regex.test(called)) {
        logger.warn('[Transcription Webhook] Invalid param format', { businessId, caller, called });
        return new Response('Invalid params', { status: 400 });
    }

    if (transcriptionStatus !== 'completed') {
        logger.warn('Transcription failed or pending', { status: transcriptionStatus });
        return new Response('OK');
    }

    if (!transcriptionText) {
        logger.warn('[Transcription Webhook] Transcription completed but text is empty', { caller });
        return new Response('OK');
    }

    logger.info('Voicemail Transcribed', { textLength: transcriptionText.length, caller });

    // 2. AI Analysis
    // We summarize the voicemail and generate a reply
    const analysis = await analyzeIntent(transcriptionText, 'Voicemail Transcript');

    // 3. Update Lead
    // Find the lead first
    const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('business_id', businessId)
        .eq('caller_phone', caller)
        .single();

    if (lead) {
        await supabaseAdmin.from('leads')
            .update({
                intent: analysis.intent,
                ai_summary: `Voicemail: ${analysis.summary}`
            })
            .eq('id', lead.id);

        // Log the transcript as an inbound message? 
        // Or specific voicemail type. For now, inbound message is fine.
        await supabaseAdmin.from('messages').insert({
            lead_id: lead.id,
            direction: 'inbound',
            body: `[Voicemail]: ${transcriptionText}`,
            is_ai_generated: false
        });
    }

    // 4. TCPA COMPLIANCE: Check if user is opted out before sending any SMS
    // FAIL CLOSED: if the opt-out lookup errors, do NOT send SMS
    const { data: optOut, error: optOutError } = await supabaseAdmin
        .from('opt_outs')
        .select('id')
        .eq('business_id', businessId)
        .eq('phone_number', caller)
        .maybeSingle();

    if (optOutError) {
        logger.error('[Transcription Webhook] Opt-out check failed, suppressing SMS (fail closed)', optOutError, { caller, businessId });
    }

    // 5. Send Smart SMS Reply (only if not opted out AND lookup succeeded)
    if (analysis.suggestedReply && !optOut && !optOutError) {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        try {
            await client.messages.create({
                to: caller,
                from: called,
                body: analysis.suggestedReply,
            });

            // Log the outbound reply
            if (lead) {
                await supabaseAdmin.from('messages').insert({
                    lead_id: lead.id,
                    direction: 'outbound',
                    body: analysis.suggestedReply,
                    is_ai_generated: true
                });
            }

            logger.info('Smart Voicemail Reply Sent', { body: analysis.suggestedReply });
        } catch (error) {
            logger.error('Failed to send smart reply', error);
        }
    } else if (optOut || optOutError) {
        logger.info('[Transcription Webhook] Skipping auto-reply - user opted out or lookup failed', { caller, businessId });
    }

    // 6. Notify Owner with Summary
    const { data: business } = await supabaseAdmin.from('businesses').select('owner_phone').eq('id', businessId).single();
    if (business?.owner_phone) {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        try {
            await client.messages.create({
                to: business.owner_phone,
                from: called,
                body: `🎙️ New Voicemail from ${caller}.\nSummary: ${analysis.summary}\nIntent: ${analysis.intent}`,
            });
        } catch { /* ignore notification failure */ }
    }

    return new Response('OK');
}
