import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { analyzeIntent } from '@/lib/ai-service';
import { checkBillingStatus } from '@/lib/billing-guard';
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

    // Idempotency: atomic claim via INSERT ... ON CONFLICT DO NOTHING.
    if (recordingSid) {
        const { data: claimed, error: claimError } = await supabaseAdmin
            .from('webhook_events')
            .insert({
                event_id: recordingSid,
                event_type: 'transcription',
                status: 'processing',
            })
            .select('id')
            .maybeSingle();

        if (claimError) {
            const isUniqueViolation = claimError.code === '23505';
            if (isUniqueViolation) {
                logger.info('[Transcription Webhook] Duplicate RecordingSid, skipping', { recordingSid });
                return new Response('OK');
            }
            logger.error('[Transcription Webhook] Failed to claim event', claimError, { recordingSid });
            return new Response('Internal Server Error', { status: 500 });
        }

        if (!claimed) {
            logger.info('[Transcription Webhook] Duplicate RecordingSid, skipping', { recordingSid });
            return new Response('OK');
        }
    }

    // Wrap in try/finally to ensure webhook_events.status always reaches a terminal state
    try {
        return await handleTranscriptionWebhook(recordingSid, request, transcriptionText, transcriptionStatus);
    } catch (error) {
        logger.error('[Transcription Webhook] Unhandled error', error, { recordingSid });
        return new Response('Internal Server Error', { status: 500 });
    } finally {
        if (recordingSid) {
            await supabaseAdmin.from('webhook_events')
                .update({ status: 'failed' })
                .eq('event_id', recordingSid)
                .eq('status', 'processing');
        }
    }
}

async function handleTranscriptionWebhook(
    recordingSid: string | null,
    request: Request,
    transcriptionText: string,
    transcriptionStatus: string,
) {
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
        if (recordingSid) {
            await supabaseAdmin.from('webhook_events')
                .update({ status: 'processed', processed_at: new Date().toISOString() })
                .eq('event_id', recordingSid);
        }
        return new Response('OK');
    }

    if (!transcriptionText) {
        logger.warn('[Transcription Webhook] Transcription completed but text is empty', { caller });
        if (recordingSid) {
            await supabaseAdmin.from('webhook_events')
                .update({ status: 'processed', processed_at: new Date().toISOString() })
                .eq('event_id', recordingSid);
        }
        return new Response('OK');
    }

    logger.info('Voicemail Transcribed', { textLength: transcriptionText.length, caller });

    // 2. AI Analysis
    const analysis = await analyzeIntent(transcriptionText, 'Voicemail Transcript');

    // 3. Update Lead
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

        await supabaseAdmin.from('messages').insert({
            lead_id: lead.id,
            direction: 'inbound',
            body: `[Voicemail]: ${transcriptionText}`,
            is_ai_generated: false
        });
    }

    // 4. BILLING GUARD: Check subscription before sending SMS
    const billing = await checkBillingStatus(businessId);

    // 5. TCPA COMPLIANCE: Check if user is opted out before sending any SMS
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

    // 6. Send Smart SMS Reply (only if billing active, not opted out, AND lookup succeeded)
    if (analysis.suggestedReply && billing.allowed && !optOut && !optOutError) {
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
    } else if (!billing.allowed) {
        logger.warn('[Transcription Webhook] Skipping auto-reply - billing inactive', { businessId });
    } else if (optOut || optOutError) {
        logger.info('[Transcription Webhook] Skipping auto-reply - user opted out or lookup failed', { caller, businessId });
    }

    // 7. Notify Owner with Summary (only if billing active)
    if (billing.allowed) {
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
    }

    // Mark event as fully processed
    if (recordingSid) {
        await supabaseAdmin.from('webhook_events')
            .update({ status: 'processed', processed_at: new Date().toISOString() })
            .eq('event_id', recordingSid);
    }

    return new Response('OK');
}
