import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

/**
 * Shared webhook utilities for idempotency, status tracking, and opt-out checks.
 * Used by Twilio voice/sms/transcription and Stripe webhook handlers.
 */

export type ClaimResult =
    | { status: 'claimed' }
    | { status: 'duplicate' }
    | { status: 'error' };

/**
 * Atomic claim for webhook idempotency.
 * Uses INSERT ... ON CONFLICT DO NOTHING so only the first request proceeds.
 */
export async function claimWebhookEvent(
    eventId: string,
    eventType: string,
    tag: string,
): Promise<ClaimResult> {
    const { data: claimed, error: claimError } = await supabaseAdmin
        .from('webhook_events')
        .insert({
            event_id: eventId,
            event_type: eventType,
            status: 'processing',
        })
        .select('id')
        .maybeSingle();

    if (claimError) {
        const isUniqueViolation = claimError.code === '23505';
        if (isUniqueViolation) {
            logger.info(`[${tag}] Duplicate event, skipping`, { eventId });
            return { status: 'duplicate' };
        }
        logger.error(`[${tag}] Failed to claim event`, claimError, { eventId });
        return { status: 'error' };
    }

    if (!claimed) {
        logger.info(`[${tag}] Duplicate event, skipping`, { eventId });
        return { status: 'duplicate' };
    }

    return { status: 'claimed' };
}

/**
 * Mark a webhook event as fully processed.
 */
export async function markWebhookProcessed(eventId: string): Promise<void> {
    await supabaseAdmin
        .from('webhook_events')
        .update({ status: 'processed', processed_at: new Date().toISOString() })
        .eq('event_id', eventId);
}

/**
 * Mark a webhook event as failed.
 */
export async function markWebhookFailed(eventId: string): Promise<void> {
    await supabaseAdmin
        .from('webhook_events')
        .update({ status: 'failed' })
        .eq('event_id', eventId);
}

/**
 * Safety-net for try/finally blocks: transitions any still-processing
 * event to 'failed'. If handler already set 'processed', the conditional
 * update is a no-op.
 */
export async function markWebhookFailedIfProcessing(eventId: string): Promise<void> {
    await supabaseAdmin
        .from('webhook_events')
        .update({ status: 'failed' })
        .eq('event_id', eventId)
        .eq('status', 'processing');
}

/**
 * Associate a business_id with a claimed webhook event.
 */
export async function setWebhookBusinessId(eventId: string, businessId: string): Promise<void> {
    await supabaseAdmin
        .from('webhook_events')
        .update({ business_id: businessId })
        .eq('event_id', eventId);
}

export interface OptOutResult {
    optedOut: boolean;
    error: boolean;
}

/**
 * TCPA-compliant opt-out check.
 * FAIL CLOSED: if the lookup errors, returns { optedOut: false, error: true }
 * so callers can suppress SMS.
 */
export async function checkOptOut(
    businessId: string,
    phoneNumber: string,
    tag: string,
): Promise<OptOutResult> {
    const { data: optOut, error: optOutError } = await supabaseAdmin
        .from('opt_outs')
        .select('id')
        .eq('business_id', businessId)
        .eq('phone_number', phoneNumber)
        .maybeSingle();

    if (optOutError) {
        logger.error(
            `[${tag}] Opt-out check failed, suppressing SMS (fail closed)`,
            optOutError,
            { phoneNumber, businessId },
        );
        return { optedOut: false, error: true };
    }

    return { optedOut: !!optOut, error: false };
}
