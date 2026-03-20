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

/**
 * Automatically links the platform's Twilio phone number (from TWILIO_PHONE_NUMBER env var)
 * to the current user's business. The user only provides their business phone —
 * the Twilio number is assigned in the background.
 */
export async function autoLinkTwilioNumber(): Promise<AutoLinkResult> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken) {
        logger.error('[autoLinkTwilioNumber] Missing Twilio credentials');
        return { success: false, error: 'Server configuration error. Please contact support.' };
    }

    if (!twilioPhoneNumber) {
        logger.error('[autoLinkTwilioNumber] TWILIO_PHONE_NUMBER env var not set');
        return { success: false, error: 'Twilio phone number not configured. Please contact support.' };
    }

    try {
        // Verify the number exists in the Twilio account
        const client = twilio(accountSid, authToken);
        const numbers = await client.incomingPhoneNumbers.list({
            phoneNumber: twilioPhoneNumber,
            limit: 1
        });

        if (numbers.length === 0) {
            logger.error('[autoLinkTwilioNumber] TWILIO_PHONE_NUMBER not found in account', { twilioPhoneNumber });
            return { success: false, error: 'Twilio number not found in account. Please contact support.' };
        }

        const foundNumber = numbers[0];

        // Link to the user's business
        const linkResult = await linkTwilioNumberToBusiness(
            foundNumber.phoneNumber,
            foundNumber.sid
        );

        if (!linkResult.success) {
            return { success: false, error: linkResult.error || 'Failed to link number' };
        }

        return { success: true, forwardingNumber: foundNumber.phoneNumber };

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
