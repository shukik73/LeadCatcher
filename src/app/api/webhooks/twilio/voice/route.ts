import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { normalizePhoneNumber, safeNormalizePhoneNumber } from '@/lib/phone-utils';
import { isBusinessHours, type BusinessHours } from '@/lib/business-logic';
import { checkBillingStatus } from '@/lib/billing-guard';
import { claimWebhookEvent, markWebhookProcessed, markWebhookFailed, markWebhookFailedIfProcessing, setWebhookBusinessId, checkOptOut, hasWebhookSideEffect, recordWebhookSideEffect } from '@/lib/webhook-common';
import { signCallbackParams } from '@/lib/callback-signature';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { renderMissedCallSms } from '@/lib/sms-template';
import { getWebhookBaseUrl } from '@/lib/webhook-url';
import { evaluateSpam, type SpamMode } from '@/lib/spam-gate';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = 'Voice Webhook';

// Natural-sounding TTS voice. 'alice' is Twilio's legacy robotic voice.
// Polly Generative is Amazon's most human-sounding tier (~$0.013/100 chars
// vs Neural's $0.0032 — pennies per call at our volume). Alternatives to try
// by swapping this one value: Polly.Matthew-Generative (US male),
// Polly.Danielle-Generative, Polly.Ruth-Generative. Fall back to *-Neural
// if Generative is ever disabled on the Twilio account.
const NATURAL_VOICE = 'Polly.Joanna-Generative' as const;

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
    const callerName = (formData.get('CallerName') as string) || null;
    const fromCountry = (formData.get('FromCountry') as string) || (formData.get('CallerCountry') as string) || null;

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
        return await handleVoiceWebhook(callSid, callerRaw, calledRaw, callerName, fromCountry);
    } catch (error) {
        logger.error(`[${TAG}] Unhandled error`, error, { callSid });
        return new Response('Internal Server Error', { status: 500 });
    } finally {
        if (callSid) {
            await markWebhookFailedIfProcessing(callSid);
        }
    }
}

async function handleVoiceWebhook(
    callSid: string | null,
    callerRaw: string,
    calledRaw: string,
    callerName: string | null,
    fromCountry: string | null,
) {
    const called = normalizePhoneNumber(calledRaw);
    // Do NOT normalize the caller yet — an anonymous/withheld caller ID would throw
    // and turn a spam call into a 500 + retry loop. Normalize safely; the spam gate
    // below runs on the RAW caller and handles the un-normalizable ones.
    const callerNormalized = safeNormalizePhoneNumber(callerRaw);

    logger.info(`[${TAG}] Incoming call`, { caller: callerNormalized ?? '[unnormalizable]', called });

    // 2. ISOLATION: Look up business
    const { data: business, error: bizError } = await supabaseAdmin
        .from('businesses')
        .select('id, owner_phone, name, business_hours, timezone, sms_template, sms_template_closed, booking_url, verification_token, verification_call_sid, spam_filter_mode')
        .eq('forwarding_number', called)
        .single();

    if (bizError || !business) {
        logger.error(`[${TAG}] No business found`, bizError, { called });
        if (callSid) await markWebhookFailed(callSid);
        const response = new twilio.twiml.VoiceResponse();
        response.say({ voice: NATURAL_VOICE }, "We're sorry, this number is not configured correctly. Goodbye.");
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

    // 2.9. SPAM GATE — runs BEFORE any text-back, lead creation, or LLM. Robocalls
    // on a spam-heavy store line otherwise burn an SMS, create a junk lead, and text
    // a non-consenting number (A2P risk). Fails open: a legitimate call is never
    // dropped. Skip during a verification test call (handled above, returns early only
    // when verified — verification just sets the flag, so guard explicitly here too).
    const spamMode = ((business.spam_filter_mode as SpamMode) || 'standard');
    const spamVerdict = business.verification_token
        ? { isSpam: false, reason: null as string | null }
        : await evaluateSpam({
            businessId: business.id,
            caller: callerRaw,
            callerNormalized,
            callerName,
            fromCountry,
            mode: spamMode,
        });

    if (spamVerdict.isSpam) {
        logger.warn(`[${TAG}] Blocked likely-spam call — no text-back, no lead`, {
            businessId: business.id,
            caller: callerNormalized ?? '[unnormalizable]',
            reason: spamVerdict.reason,
        });

        // Log it (category 'spam') so the owner can audit blocked calls and correct
        // false positives, but do NOT send SMS, create a lead, or schedule follow-up.
        const spamCallId = callSid || `voice-spam-${callerNormalized ?? Date.now()}`;
        try {
            await supabaseAdmin.from('call_analyses').insert({
                business_id: business.id,
                source_call_id: spamCallId,
                customer_phone: callerNormalized ?? 'unknown',
                call_status: 'missed',
                summary: `Blocked as likely spam (${spamVerdict.reason ?? 'heuristic'}).`,
                sentiment: 'neutral',
                category: 'spam',
                urgency: 'low',
                follow_up_needed: false,
                callback_status: 'lost',
                processed_at: new Date().toISOString(),
            });
        } catch (error) {
            logger.error(`[${TAG}] Failed to log spam call`, error, { businessId: business.id });
        }

        if (callSid) await markWebhookProcessed(callSid);

        // Play a brief message and hang up — no recording, so no transcription cost.
        const spamResponse = new twilio.twiml.VoiceResponse();
        spamResponse.say({ voice: NATURAL_VOICE }, 'Thank you for calling. Goodbye.');
        spamResponse.hangup();
        return new Response(spamResponse.toString(), { headers: { 'Content-Type': 'text/xml' } });
    }

    // Not spam. The caller passed the gate but must still be a normalizable US
    // number for the downstream text-back / lead / recording flow. If it isn't
    // (e.g. a foreign number), log and hang up gracefully instead of throwing.
    if (!callerNormalized) {
        logger.warn(`[${TAG}] Non-spam call with un-normalizable caller — cannot process`, { businessId: business.id });
        if (callSid) await markWebhookProcessed(callSid);
        const naResponse = new twilio.twiml.VoiceResponse();
        naResponse.say({ voice: NATURAL_VOICE }, 'Thank you for calling. Goodbye.');
        naResponse.hangup();
        return new Response(naResponse.toString(), { headers: { 'Content-Type': 'text/xml' } });
    }
    const caller = callerNormalized;

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
    // Track whether Twilio actually accepted the outbound auto-reply. We only log
    // the outbound message and schedule the follow-up after a successful send so a
    // failed Twilio call cannot show up as a "sent" message in history.
    // autoReplyExists: an auto-reply has been sent for this call (this attempt or a
    // prior one that we're reprocessing after a retry). sentThisInvocation: we sent
    // it just now — only then do we log the outbound message row, so a reclaim can't
    // double-log it.
    let autoReplyBody: string | null = null;
    let autoReplyExists = false;
    let sentThisInvocation = false;
    if (billing.allowed && !optOutResult.optedOut && !optOutResult.error && rateLimit.allowed) {
        const defaultOpen = "Hi! We missed your call — we were helping another customer. How can we help you? Would you like us to give you a call back in a few?";
        const defaultClosed = "Hi! Our store is currently closed. How can we help you? Would you like us to schedule an appointment for when we open?";

        const template = isOpen
            ? (business.sms_template || defaultOpen)
            : (business.sms_template_closed || defaultClosed);
        // Caller is typically unknown at missed-call time; renderMissedCallSms
        // resolves {{first_name}} to a friendly fallback and strips any leftover
        // {{token}} so no raw placeholder is ever texted to the customer.
        autoReplyBody = renderMissedCallSms(template, business);

        // Reprocessing guard: if this event already sent its auto-reply on a prior
        // (failed-then-reclaimed) attempt, do NOT text the customer again.
        if (await hasWebhookSideEffect(callSid, 'auto_reply')) {
            logger.info(`[${TAG}] Auto-reply already sent on a prior attempt — skipping resend`, { callSid });
            autoReplyExists = true;
        } else {
            try {
                await client.messages.create({
                    to: caller,
                    from: called,
                    body: autoReplyBody,
                });
                autoReplyExists = true;
                sentThisInvocation = true;
                // Record immediately after a successful send so any later throw in this
                // handler cannot cause a resend on the retry.
                await recordWebhookSideEffect(callSid, 'auto_reply');
            } catch (error) {
                logger.error(`[${TAG}] Error sending immediate ack`, error, { businessId: business.id });
                autoReplyBody = null;
            }
        }
    } else if (!billing.allowed) {
        logger.warn(`[${TAG}] Skipping SMS - billing inactive`, { businessId: business.id });
    } else if (!rateLimit.allowed) {
        logger.warn(`[${TAG}] Skipping SMS - rate limited`, { businessId: business.id, caller, reason: rateLimit.reason });
    } else {
        logger.info(`[${TAG}] Skipping immediate ack - user opted out or lookup failed`, { caller, businessId: business.id });
    }

    // 7. Log Lead (Scoped to Business) — upsert to avoid race condition with concurrent calls
    const { data: upsertedLead } = await supabaseAdmin.from('leads').upsert({
        caller_phone: caller,
        status: 'New',
        business_id: business.id,
    }, {
        onConflict: 'business_id,caller_phone',
        ignoreDuplicates: true,
    }).select('id, follow_up_count').single();

    // If upsert returned nothing (ignoreDuplicates), fetch existing
    let leadId = upsertedLead?.id;
    let followUpCount = upsertedLead?.follow_up_count ?? 0;
    if (!leadId) {
        const { data: existing } = await supabaseAdmin.from('leads')
            .select('id, follow_up_count')
            .eq('business_id', business.id)
            .eq('caller_phone', caller)
            .single();
        leadId = existing?.id;
        followUpCount = existing?.follow_up_count ?? 0;
    }

    // 7b. Schedule follow-up SMS in 15 minutes — only if the auto-reply was actually
    // delivered. If Twilio rejected the send, don't queue a follow-up either.
    if (leadId && followUpCount === 0 && autoReplyExists) {
        const followUpDue = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await supabaseAdmin.from('leads')
            .update({ follow_up_due_at: followUpDue })
            .eq('id', leadId);
        logger.info(`[${TAG}] Follow-up scheduled`, { leadId, followUpDue });
    }

    // Log the auto-reply message ONLY if we sent it in this invocation (not on a
    // reprocess where the send was skipped) and Twilio accepted it.
    if (leadId && sentThisInvocation && autoReplyBody) {
        try {
            await supabaseAdmin.from('messages').insert({
                lead_id: leadId,
                direction: 'outbound',
                body: autoReplyBody,
            });
        } catch (logErr) {
            logger.error(`[${TAG}] Failed to log auto-reply message`, logErr);
        }
    }

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
    response.say({ voice: NATURAL_VOICE }, `Hi, thanks for calling ${safeName}! We're helping another customer right now and didn't want to miss you. Leave your name and what you need after the beep, and we'll text you right back.`);

    const baseUrl = getWebhookBaseUrl();
    if (!baseUrl) {
        logger.error(`[${TAG}] Webhook base URL missing; cannot build transcription callback URL`);
        const errorResponse = new twilio.twiml.VoiceResponse();
        errorResponse.say({ voice: NATURAL_VOICE }, 'We apologize, but we are experiencing technical difficulties. Please try again later.');
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
