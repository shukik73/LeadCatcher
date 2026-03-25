import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { analyzeIntent } from '@/lib/ai-service';
import { checkBillingStatus } from '@/lib/billing-guard';
import { claimWebhookEvent, markWebhookProcessed, markWebhookFailedIfProcessing, checkOptOut } from '@/lib/webhook-common';
import { verifyCallbackSignature } from '@/lib/callback-signature';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { scoreCall } from '@/lib/call-scoring';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = 'Transcription Webhook';

export async function POST(request: Request) {
    // 1. SECURITY: Validate Twilio signature - STRICT validation required
    const isValid = await validateTwilioRequest(request);
    if (!isValid) {
        logger.warn(`[${TAG}] Invalid Twilio signature - rejecting request`);
        return new Response('Unauthorized', { status: 403 });
    }

    const formData = await request.formData();
    const recordingSid = formData.get('RecordingSid') as string;
    const transcriptionText = formData.get('TranscriptionText') as string;
    const transcriptionStatus = formData.get('TranscriptionStatus') as string;

    // Idempotency: atomic claim
    if (recordingSid) {
        const claim = await claimWebhookEvent(recordingSid, 'transcription', TAG);
        if (claim.status === 'duplicate') {
            return new Response('OK');
        }
        if (claim.status === 'error') {
            return new Response('Internal Server Error', { status: 500 });
        }
    }

    // Wrap in try/finally to ensure webhook_events.status always reaches a terminal state
    try {
        return await handleTranscriptionWebhook(recordingSid, request, transcriptionText, transcriptionStatus);
    } catch (error) {
        logger.error(`[${TAG}] Unhandled error`, error, { recordingSid });
        return new Response('Internal Server Error', { status: 500 });
    } finally {
        if (recordingSid) {
            await markWebhookFailedIfProcessing(recordingSid);
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
    const sourceCallId = url.searchParams.get('callSid'); // matches call_analyses.source_call_id

    if (!businessId || !caller || !called) {
        logger.error('Missing params in transcription callback', null, { url: request.url });
        return new Response('Missing params', { status: 400 });
    }

    // Validate param formats to prevent injection via crafted callback URLs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const e164Regex = /^\+[1-9]\d{1,14}$/;

    if (!uuidRegex.test(businessId) || !e164Regex.test(caller) || !e164Regex.test(called)) {
        logger.warn(`[${TAG}] Invalid param format`, { businessId, caller, called });
        return new Response('Invalid params', { status: 400 });
    }

    // Verify HMAC signature to prevent IDOR via crafted callback URLs
    const sig = url.searchParams.get('sig');
    if (!sig || !verifyCallbackSignature(businessId, caller, called, sig)) {
        logger.warn(`[${TAG}] Invalid callback signature — possible IDOR attempt`, { businessId });
        return new Response('Invalid signature', { status: 403 });
    }

    if (transcriptionStatus !== 'completed') {
        logger.warn('Transcription failed or pending', { status: transcriptionStatus });
        if (recordingSid) await markWebhookProcessed(recordingSid);
        return new Response('OK');
    }

    if (!transcriptionText) {
        logger.warn(`[${TAG}] Transcription completed but text is empty`, { caller });
        if (recordingSid) await markWebhookProcessed(recordingSid);
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

    // 3b. Update call_analyses with transcript and AI scoring
    try {
        // Find the call_analyses record by source_call_id (passed from voice webhook)
        // Falls back to phone+newest match if callSid not present (legacy calls)
        let callAnalysisId: string | null = null;

        if (sourceCallId) {
            const { data: match } = await supabaseAdmin
                .from('call_analyses')
                .select('id')
                .eq('source_call_id', sourceCallId)
                .single();
            callAnalysisId = match?.id || null;
        }

        if (!callAnalysisId) {
            // Fallback: match by business + phone, most recent
            const { data: match } = await supabaseAdmin
                .from('call_analyses')
                .select('id')
                .eq('business_id', businessId)
                .eq('customer_phone', caller)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            callAnalysisId = match?.id || null;
        }

        // Score the call with the actual transcript
        const score = await scoreCall({
            transcript: transcriptionText,
            callStatus: 'missed',
            customerPhone: caller,
        });

        if (callAnalysisId) {
            // Update existing record with transcript and AI scoring
            await supabaseAdmin
                .from('call_analyses')
                .update({
                    transcript: transcriptionText,
                    summary: score.summary,
                    sentiment: score.sentiment,
                    category: score.category,
                    urgency: score.urgency,
                    follow_up_needed: score.follow_up_needed,
                    follow_up_notes: score.follow_up_notes,
                    coaching_note: score.coaching_note,
                    due_by: score.due_by,
                    processed_at: new Date().toISOString(),
                })
                .eq('id', callAnalysisId);

            logger.info(`[${TAG}] Updated call_analyses with transcript`, {
                id: callAnalysisId,
                category: score.category,
                urgency: score.urgency,
            });
        } else {
            // No existing record — create one (voice webhook may have failed)
            const fallbackSourceId = sourceCallId || `transcription-${Date.now()}-${caller}`;
            const { error: insertError } = await supabaseAdmin
                .from('call_analyses')
                .insert({
                    business_id: businessId,
                    source_call_id: fallbackSourceId,
                    customer_phone: caller,
                    call_status: 'missed',
                    transcript: transcriptionText,
                    summary: score.summary,
                    sentiment: score.sentiment,
                    category: score.category,
                    urgency: score.urgency,
                    follow_up_needed: score.follow_up_needed,
                    follow_up_notes: score.follow_up_notes,
                    callback_status: 'pending',
                    coaching_note: score.coaching_note,
                    due_by: score.due_by,
                    processed_at: new Date().toISOString(),
                });

            if (insertError && insertError.code !== '23505') {
                logger.error(`[${TAG}] Failed to create call_analyses`, insertError);
            } else {
                logger.info(`[${TAG}] Created new call_analyses from transcription`, {
                    sourceCallId: fallbackSourceId,
                    category: score.category,
                });
            }
        }
    } catch (error) {
        // Non-blocking — don't fail the webhook
        logger.error(`[${TAG}] Error updating call analysis`, error);
    }

    // 4. BILLING GUARD: Check subscription before sending SMS
    const billing = await checkBillingStatus(businessId);

    // 5. TCPA COMPLIANCE: Check opt-out (fail closed)
    const optOutResult = await checkOptOut(businessId, caller, TAG);

    // 5b. SMS RATE LIMIT
    const rateLimit = await checkSmsRateLimit(businessId, caller);

    // 6. Send Smart SMS Reply (only if billing active, not opted out, rate limit OK, AND lookup succeeded)
    if (analysis.suggestedReply && billing.allowed && !optOutResult.optedOut && !optOutResult.error && rateLimit.allowed) {
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
        logger.warn(`[${TAG}] Skipping auto-reply - billing inactive`, { businessId });
    } else if (!rateLimit.allowed) {
        logger.warn(`[${TAG}] Skipping auto-reply - rate limited`, { businessId, caller, reason: rateLimit.reason });
    } else if (optOutResult.optedOut || optOutResult.error) {
        logger.info(`[${TAG}] Skipping auto-reply - user opted out or lookup failed`, { caller, businessId });
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
    if (recordingSid) await markWebhookProcessed(recordingSid);

    return new Response('OK');
}
