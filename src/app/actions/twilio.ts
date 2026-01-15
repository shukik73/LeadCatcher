'use server';

import twilio from 'twilio';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase-server';

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
        console.error('[verifyTwilioPhoneNumber] Missing Twilio credentials');
        return {
            success: false,
            error: 'Server configuration error. Please contact support.'
        };
    }

    if (!accountSid.startsWith('AC')) {
        console.error('[verifyTwilioPhoneNumber] Invalid Twilio Account SID format');
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
        console.error('[verifyTwilioPhoneNumber] Twilio API error:', error);

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

        // Update the business with the verified Twilio number
        const { error: updateError } = await supabase
            .from('businesses')
            .update({
                forwarding_number: phoneNumber,
                twilio_sid: twilioSid
            })
            .eq('user_id', user.id);

        if (updateError) {
            console.error('[linkTwilioNumberToBusiness] DB error:', updateError);
            return { success: false, error: 'Failed to save phone number to your account' };
        }

        return { success: true };

    } catch (error) {
        console.error('[linkTwilioNumberToBusiness] Error:', error);
        return { success: false, error: 'An unexpected error occurred' };
    }
}
