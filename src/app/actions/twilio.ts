'use server';

import twilio from 'twilio';
import { z } from 'zod';
import { createSupabaseServerClient, supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

// Validation schema for phone number (E.164 format)
const phoneNumberSchema = z.string()
    .min(10, 'Phone number is too short')
    .max(15, 'Phone number is too long')
    .regex(/^\+?1?\d{10,14}$/, 'Invalid phone number format. Use format: +15551234567');

// Response types
interface VerifyNumberSuccess {
    success: true;
    sid: string;
    phoneNumber: string;
    friendlyName: string;
}

interface VerifyNumberError {
    success: false;
    error: string;
}

type VerifyNumberResult = VerifyNumberSuccess | VerifyNumberError;

interface AutoLinkResult {
    success: boolean;
    forwardingNumber?: string;
    error?: string;
}

type TwilioClient = ReturnType<typeof twilio>;

/**
 * Shown when a business tries to link a forwarding number that another business
 * already owns. In single-tenant ('shared') mode this is expected on the second
 * signup; the partial unique index `businesses_forwarding_number_unique` guarantees
 * one business per number, and this message tells the operator what's actually wrong
 * instead of leaking a raw Postgres 23505.
 */
const NUMBER_ALREADY_LINKED_ERROR =
    'This phone number is already linked to another business. LeadCatcher is currently ' +
    'running in single-tenant mode, so each business needs its own dedicated Twilio ' +
    'number. Contact support to provision a dedicated number.';

type NumberStrategy = 'shared' | 'per-tenant';

interface AcquiredNumber {
    phoneNumber: string;
    sid: string;
}

type AcquireNumberResult =
    | { success: true; number: AcquiredNumber }
    | { success: false; error: string };

/**
 * Selects how a business gets its telephony number. Defaults to 'shared'
 * (single-tenant). Set TWILIO_NUMBER_STRATEGY=per-tenant to go multi-tenant
 * once provisionDedicatedNumber() is implemented.
 */
function getNumberStrategy(): NumberStrategy {
    return process.env.TWILIO_NUMBER_STRATEGY === 'per-tenant' ? 'per-tenant' : 'shared';
}

/**
 * Resolves the Twilio number a business should use.
 *
 * - 'shared' (default): single-tenant. Every business links the one platform number
 *   in TWILIO_PHONE_NUMBER. Only one business can own it (enforced by
 *   businesses_forwarding_number_unique), so the second signup is rejected upstream
 *   with NUMBER_ALREADY_LINKED_ERROR rather than a raw constraint error.
 * - 'per-tenant': MULTI-TENANT HOOK. Assign a dedicated number per business via
 *   provisionDedicatedNumber(). The rest of the flow already keys off the per-business
 *   `forwarding_number` (link step + both webhook lookups), so no other code changes.
 */
async function acquireNumberForBusiness(client: TwilioClient): Promise<AcquireNumberResult> {
    if (getNumberStrategy() === 'per-tenant') {
        return provisionDedicatedNumber();
    }

    const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!twilioPhoneNumber) {
        logger.error('[acquireNumberForBusiness] TWILIO_PHONE_NUMBER env var not set');
        return { success: false, error: 'Twilio phone number not configured. Please contact support.' };
    }

    // Verify the number exists in the Twilio account
    const numbers = await client.incomingPhoneNumbers.list({
        phoneNumber: twilioPhoneNumber,
        limit: 1,
    });

    if (numbers.length === 0) {
        logger.error('[acquireNumberForBusiness] TWILIO_PHONE_NUMBER not found in account', { twilioPhoneNumber });
        return { success: false, error: 'Twilio number not found in account. Please contact support.' };
    }

    return { success: true, number: { phoneNumber: numbers[0].phoneNumber, sid: numbers[0].sid } };
}

/**
 * MULTI-TENANT HOOK — provision a dedicated Twilio number for a single business.
 *
 * When you're ready to pay ~$1/mo per tenant (+ first-purchase fee), give this the
 * Twilio client (pass `client` from acquireNumberForBusiness) and implement it (and
 * set TWILIO_NUMBER_STRATEGY=per-tenant):
 *
 *   const available = await client.availablePhoneNumbers('US').local.list({ limit: 1 });
 *   if (available.length === 0) return { success: false, error: 'No numbers available right now.' };
 *   const purchased = await client.incomingPhoneNumbers.create({ phoneNumber: available[0].phoneNumber });
 *   return { success: true, number: { phoneNumber: purchased.phoneNumber, sid: purchased.sid } };
 *
 * Until then it fails loudly so flipping the env var without finishing the work
 * doesn't silently misbehave.
 */
async function provisionDedicatedNumber(): Promise<AcquireNumberResult> {
    logger.error('[provisionDedicatedNumber] per-tenant provisioning is not implemented yet');
    return { success: false, error: 'Per-tenant number provisioning is not enabled yet. Please contact support.' };
}

/**
 * Automatically links a Twilio phone number to the current user's business. The user
 * only provides their business phone — the Twilio number is assigned in the background
 * according to TWILIO_NUMBER_STRATEGY (shared single-tenant number by default).
 */
export async function autoLinkTwilioNumber(): Promise<AutoLinkResult> {
    // Server actions are publicly-invokable POST endpoints; require an authenticated
    // user before touching the platform Twilio account (prevents anonymous probing
    // and quota burn). Ownership is re-verified downstream in linkTwilioNumberToBusiness.
    const authClient = await createSupabaseServerClient();
    const { data: { user: authUser } } = await authClient.auth.getUser();
    if (!authUser) {
        return { success: false, error: 'You must be logged in' };
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        logger.error('[autoLinkTwilioNumber] Missing Twilio credentials');
        return { success: false, error: 'Server configuration error. Please contact support.' };
    }

    try {
        const client = twilio(accountSid, authToken);

        const acquired = await acquireNumberForBusiness(client);
        if (!acquired.success) {
            return { success: false, error: acquired.error };
        }

        // Link to the user's business
        const linkResult = await linkTwilioNumberToBusiness(
            acquired.number.phoneNumber,
            acquired.number.sid
        );

        if (!linkResult.success) {
            return { success: false, error: linkResult.error || 'Failed to link number' };
        }

        return { success: true, forwardingNumber: acquired.number.phoneNumber };

    } catch (error) {
        logger.error('[autoLinkTwilioNumber] Error', error);
        return { success: false, error: 'Failed to connect phone number. Please try again.' };
    }
}

/**
 * Verifies that a phone number exists in the user's Twilio account
 * and returns the SID if found.
 */
export async function verifyTwilioPhoneNumber(phoneNumber: string): Promise<VerifyNumberResult> {
    // Require auth before hitting the platform Twilio account — this action is a
    // public POST endpoint and would otherwise let anyone enumerate account numbers.
    const authClient = await createSupabaseServerClient();
    const { data: { user: authUser } } = await authClient.auth.getUser();
    if (!authUser) {
        return { success: false, error: 'You must be logged in' };
    }

    // 1. Validate input
    const validation = phoneNumberSchema.safeParse(phoneNumber);
    if (!validation.success) {
        return {
            success: false,
            error: validation.error.issues[0]?.message || 'Invalid phone number format'
        };
    }

    // Normalize to E.164 format
    let normalizedNumber = phoneNumber.replace(/\D/g, '');
    if (!normalizedNumber.startsWith('1') && normalizedNumber.length === 10) {
        normalizedNumber = '1' + normalizedNumber;
    }
    normalizedNumber = '+' + normalizedNumber;

    // 2. Verify environment variables
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        logger.error('[verifyTwilioPhoneNumber] Missing Twilio credentials');
        return {
            success: false,
            error: 'Server configuration error. Please contact support.'
        };
    }

    if (!accountSid.startsWith('AC')) {
        logger.error('[verifyTwilioPhoneNumber] Invalid Twilio Account SID format');
        return {
            success: false,
            error: 'Invalid Twilio configuration. Account SID must start with AC.'
        };
    }

    try {
        // 3. Initialize Twilio client
        const client = twilio(accountSid, authToken);

        // 4. Search for the phone number in the account
        const numbers = await client.incomingPhoneNumbers.list({
            phoneNumber: normalizedNumber,
            limit: 1
        });

        if (numbers.length === 0) {
            return {
                success: false,
                error: `Number ${normalizedNumber} not found in your Twilio account. Please ensure you have purchased this number.`
            };
        }

        const foundNumber = numbers[0];

        return {
            success: true,
            sid: foundNumber.sid,
            phoneNumber: foundNumber.phoneNumber,
            friendlyName: foundNumber.friendlyName || foundNumber.phoneNumber
        };

    } catch (error) {
        logger.error('[verifyTwilioPhoneNumber] Twilio API error', error);

        // Handle specific Twilio errors
        if (error instanceof Error) {
            if (error.message.includes('authenticate')) {
                return {
                    success: false,
                    error: 'Invalid Twilio credentials. Please check your Account SID and Auth Token.'
                };
            }
            if (error.message.includes('not found')) {
                return {
                    success: false,
                    error: 'Twilio account not found. Please verify your credentials.'
                };
            }
        }

        return {
            success: false,
            error: 'Failed to verify phone number. Please try again.'
        };
    }
}

/**
 * Links a verified Twilio phone number to the user's business
 * and automatically configures Twilio webhook URLs to point to this app.
 */
export async function linkTwilioNumberToBusiness(
    phoneNumber: string,
    twilioSid: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createSupabaseServerClient();

        // Get current user
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return { success: false, error: 'You must be logged in' };
        }

        // Verify user owns a business (via RLS-scoped client)
        const { data: business, error: bizError } = await supabase
            .from('businesses')
            .select('id')
            .eq('user_id', user.id)
            .single();

        if (bizError || !business) {
            return { success: false, error: 'Business not found. Complete onboarding first.' };
        }

        // Multi-tenant guard: a forwarding number may belong to exactly one business
        // (enforced by businesses_forwarding_number_unique). Check across tenants with
        // the admin client (RLS would hide other businesses' rows) so we can return a
        // clear message before hitting the unique constraint. Re-linking the same number
        // to the same business stays allowed via the .neq('id', …) filter.
        const { data: existingOwner } = await supabaseAdmin
            .from('businesses')
            .select('id')
            .eq('forwarding_number', phoneNumber)
            .neq('id', business.id)
            .maybeSingle();

        if (existingOwner) {
            logger.warn('[linkTwilioNumberToBusiness] Number already owned by another business', {
                phoneNumber,
                existingBusinessId: existingOwner.id,
                currentBusinessId: business.id,
            });
            return { success: false, error: NUMBER_ALREADY_LINKED_ERROR };
        }

        // Use supabaseAdmin to update protected telephony fields (bypasses trigger)
        const { error: updateError } = await supabaseAdmin
            .from('businesses')
            .update({
                forwarding_number: phoneNumber,
                twilio_sid: twilioSid
            })
            .eq('id', business.id);

        if (updateError) {
            logger.error('[linkTwilioNumberToBusiness] DB error', updateError);
            // Safety net for the race between the pre-check above and this update:
            // Postgres 23505 = unique_violation on businesses_forwarding_number_unique.
            if ((updateError as { code?: string }).code === '23505') {
                return { success: false, error: NUMBER_ALREADY_LINKED_ERROR };
            }
            return { success: false, error: 'Failed to save phone number to your account' };
        }

        // Auto-configure Twilio webhook URLs
        const baseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
        if (baseUrl) {
            try {
                const accountSid = process.env.TWILIO_ACCOUNT_SID;
                const authToken = process.env.TWILIO_AUTH_TOKEN;
                if (accountSid && authToken) {
                    const client = twilio(accountSid, authToken);
                    await client.incomingPhoneNumbers(twilioSid).update({
                        voiceUrl: `${baseUrl}/api/webhooks/twilio/voice`,
                        voiceMethod: 'POST',
                        smsUrl: `${baseUrl}/api/webhooks/twilio/sms`,
                        smsMethod: 'POST',
                    });
                    logger.info('[linkTwilioNumberToBusiness] Twilio webhooks configured', {
                        voiceUrl: `${baseUrl}/api/webhooks/twilio/voice`,
                        smsUrl: `${baseUrl}/api/webhooks/twilio/sms`,
                    });
                }
            } catch (webhookError) {
                // Non-fatal: number is linked, webhooks can be configured manually
                logger.error('[linkTwilioNumberToBusiness] Failed to auto-configure webhooks', webhookError);
            }
        }

        return { success: true };

    } catch (error) {
        logger.error('[linkTwilioNumberToBusiness] Error', error);
        return { success: false, error: 'An unexpected error occurred' };
    }
}
