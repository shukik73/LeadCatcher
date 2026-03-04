import { supabaseAdmin } from '@/lib/supabase-server';
import { validateTelnyxRequest } from '@/lib/telnyx-validator';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { checkBillingStatus } from '@/lib/billing-guard';
import { claimWebhookEvent, markWebhookProcessed, markWebhookFailed, markWebhookFailedIfProcessing, setWebhookBusinessId } from '@/lib/webhook-common';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = 'Telnyx SMS Webhook';

/**
 * Send an SMS via the Telnyx API.
 * Uses fetch instead of a full SDK to keep dependencies light.
 */
async function sendTelnyxSms(from: string, to: string, text: string): Promise<void> {
    const apiKey = process.env.TELNYX_API_KEY;
    if (!apiKey) throw new Error('TELNYX_API_KEY is not set');

    const res = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ from, to, text }),
    });

    if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`Telnyx API error ${res.status}: ${errorBody}`);
    }
}

export async function POST(request: Request) {
    // 1. SECURITY: Validate Telnyx webhook signature
    const { valid, body: rawBody } = await validateTelnyxRequest(request);
    if (!valid) {
        logger.warn(`[${TAG}] Invalid Telnyx signature`);
        return new Response('Unauthorized', { status: 403 });
    }

    let payload;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        logger.error(`[${TAG}] Failed to parse webhook body`, null);
        return new Response('Bad Request', { status: 400 });
    }

    const eventType = payload?.data?.event_type;

    // Only handle inbound messages
    if (eventType !== 'message.received') {
        return new Response('OK', { status: 200 });
    }

    const messagePayload = payload.data.payload;
    const eventId = payload.data.id; // Unique event ID for idempotency
    const fromRaw = messagePayload?.from?.phone_number;
    const toRaw = messagePayload?.to?.[0]?.phone_number;
    const body = messagePayload?.text;

    if (!fromRaw || !body) {
        logger.warn(`[${TAG}] Missing from or body in payload`);
        return new Response('Bad Request', { status: 400 });
    }

    // Idempotency: atomic claim
    if (eventId) {
        const claim = await claimWebhookEvent(eventId, 'telnyx_sms', TAG);
        if (claim.status === 'duplicate') {
            return new Response('OK', { status: 200 });
        }
        if (claim.status === 'error') {
            return new Response('Internal Server Error', { status: 500 });
        }
    }

    // Wrap in try/finally to ensure webhook_events.status always reaches a terminal state
    try {
        return await handleSmsWebhook(eventId, fromRaw, toRaw, body);
    } catch (error) {
        logger.error(`[${TAG}] Unhandled error`, error, { eventId });
        return new Response('Internal Server Error', { status: 500 });
    } finally {
        if (eventId) {
            await markWebhookFailedIfProcessing(eventId);
        }
    }
}

async function handleSmsWebhook(eventId: string | null, fromRaw: string, toRaw: string, body: string) {
    const from = normalizePhoneNumber(fromRaw);
    const to = normalizePhoneNumber(toRaw);
    const bodyUpper = body.trim().toUpperCase();

    logger.info(`[${TAG}] Message received`, { from, to, bodyLength: body.length });

    // 2. ISOLATION: Find business based on the Telnyx number that received the message
    const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('id, owner_phone, name')
        .eq('forwarding_number', to)
        .single();

    if (!business) {
        logger.error(`[${TAG}] No business found for number`, null, { to });
        if (eventId) await markWebhookFailed(eventId);
        return new Response('OK', { status: 200 });
    }

    if (eventId) await setWebhookBusinessId(eventId, business.id);

    // 2.5. TCPA COMPLIANCE: Handle STOP keywords
    const stopKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
    const isOptOut = stopKeywords.some(keyword => bodyUpper === keyword || bodyUpper === `${keyword}ALL`);

    if (isOptOut) {
        const optOutKeyword = stopKeywords.find(keyword => bodyUpper.startsWith(keyword)) || 'STOP';

        await supabaseAdmin.from('opt_outs').upsert({
            business_id: business.id,
            phone_number: from,
            opt_out_keyword: optOutKeyword,
            opted_out_at: new Date().toISOString()
        }, {
            onConflict: 'business_id,phone_number'
        });

        logger.info(`[${TAG}] Opt-out registered`, { from, businessId: business.id, keyword: optOutKeyword });

        // Send opt-out confirmation via Telnyx
        try {
            await sendTelnyxSms(
                to,
                from,
                `You have been unsubscribed. You will no longer receive messages from ${business.name}. Reply START to resubscribe.`,
            );
        } catch (err) {
            logger.error('Error sending opt-out confirmation via Telnyx', err);
        }

        if (eventId) await markWebhookProcessed(eventId);
        return new Response('OK', { status: 200 });
    }

    // 2.6. TCPA COMPLIANCE: Handle START keyword (re-subscribe)
    if (bodyUpper === 'START') {
        await supabaseAdmin.from('opt_outs')
            .delete()
            .eq('business_id', business.id)
            .eq('phone_number', from);

        logger.info(`[${TAG}] Re-subscription`, { from, businessId: business.id });

        try {
            await sendTelnyxSms(
                to,
                from,
                `You have been resubscribed. You will now receive messages from ${business.name}. Reply STOP to unsubscribe.`,
            );
        } catch (err) {
            logger.error('Error sending resubscription confirmation via Telnyx', err);
        }

        if (eventId) await markWebhookProcessed(eventId);
        return new Response('OK', { status: 200 });
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
        if (eventId) await markWebhookProcessed(eventId);
        return new Response('OK', { status: 200 });
    }

    // BILLING GUARD: Check subscription before sending outbound SMS
    const billing = await checkBillingStatus(business.id);

    // Find or Create Lead
    let leadId: string | null = null;

    const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('caller_phone', from)
        .eq('business_id', business.id)
        .single();

    if (lead) {
        leadId = lead.id;
    } else {
        const { data: newLead } = await supabaseAdmin
            .from('leads')
            .insert({
                caller_phone: from,
                status: 'New',
                business_id: business.id
            })
            .select('id')
            .single();
        if (newLead) leadId = newLead.id;
    }

    if (leadId) {
        // 3. Log Message
        await supabaseAdmin.from('messages').insert({
            lead_id: leadId,
            direction: 'inbound',
            body: body
        });

        // 4. AI Analysis
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

        // 5. Notify Owner (only if billing is active)
        if (business.owner_phone && billing.allowed) {
            try {
                await sendTelnyxSms(
                    to,
                    business.owner_phone,
                    `📩 Reply from ${from}: "${body}"`,
                );
            } catch (err) {
                logger.error('Error notifying owner of SMS via Telnyx:', err);
            }
        } else if (!billing.allowed) {
            logger.warn(`[${TAG}] Skipping owner notification - billing inactive`, { businessId: business.id });
        }
    }

    // Mark event as fully processed
    if (eventId) await markWebhookProcessed(eventId);

    return new Response('OK', { status: 200 });
}
