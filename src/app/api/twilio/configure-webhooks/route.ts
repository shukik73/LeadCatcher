import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase-server';
import { cookies } from 'next/headers';
import { validateCsrfOrigin } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

/**
 * POST /api/twilio/configure-webhooks
 * Re-configures Twilio webhook URLs for the current user's business.
 * Useful when webhooks get out of sync (e.g. after domain changes).
 */
export async function POST(request: Request) {
    if (!validateCsrfOrigin(request)) {
        return new Response('Forbidden', { status: 403 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return cookieStore.getAll() },
                setAll(cookiesToSet) { try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch { } }
            }
        }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response('Unauthorized', { status: 401 });

    const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('id, forwarding_number, twilio_sid')
        .eq('user_id', user.id)
        .single();

    if (!business?.forwarding_number) {
        return Response.json({ success: false, error: 'No phone number linked.' }, { status: 400 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const baseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;

    if (!accountSid || !authToken) {
        return Response.json({ success: false, error: 'Twilio credentials not configured.' }, { status: 500 });
    }
    if (!baseUrl) {
        return Response.json({ success: false, error: 'APP_BASE_URL not configured.' }, { status: 500 });
    }

    try {
        const client = twilio(accountSid, authToken);

        // If we don't have twilio_sid stored, look it up by phone number
        let numberSid = business.twilio_sid;
        if (!numberSid) {
            const numbers = await client.incomingPhoneNumbers.list({
                phoneNumber: business.forwarding_number,
                limit: 1,
            });
            if (numbers.length === 0) {
                return Response.json({ success: false, error: 'Twilio number not found in account.' }, { status: 404 });
            }
            numberSid = numbers[0].sid;

            // Store it for future use
            await supabaseAdmin
                .from('businesses')
                .update({ twilio_sid: numberSid })
                .eq('id', business.id);
        }

        const voiceUrl = `${baseUrl}/api/webhooks/twilio/voice`;
        const smsUrl = `${baseUrl}/api/webhooks/twilio/sms`;

        await client.incomingPhoneNumbers(numberSid).update({
            voiceUrl,
            voiceMethod: 'POST',
            smsUrl,
            smsMethod: 'POST',
        });

        logger.info('[configure-webhooks] Twilio webhooks updated', { voiceUrl, smsUrl, numberSid });

        return Response.json({
            success: true,
            voiceUrl,
            smsUrl,
        });
    } catch (error) {
        logger.error('[configure-webhooks] Failed', error);
        return Response.json({ success: false, error: 'Failed to configure webhooks.' }, { status: 500 });
    }
}
