import { supabaseAdmin } from '@/lib/supabase-server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import twilio from 'twilio';
import { logger } from '@/lib/logger';
import { validateCsrfOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

/**
 * POST /api/verify
 * Initiates a verification call and stores a verification token.
 * The voice webhook will detect the forwarded call and mark verified=true.
 */
export async function POST(request: Request) {
    // CSRF protection: validate Origin header
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

    // Get Business
    const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('id, business_phone, forwarding_number')
        .eq('user_id', user.id)
        .single();

    if (!business) return new Response('Business not found', { status: 404 });
    if (!business.forwarding_number) {
        return new Response(JSON.stringify({ success: false, error: 'No phone number is linked yet. Connect your phone in the Phone Connection section above, then run the test call.' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
        });
    }

    // Generate a unique verification token so the webhook can identify this test call
    const verifyToken = crypto.randomUUID();

    // Store the pending verification token in the DB
    await supabaseAdmin
        .from('businesses')
        .update({ verification_token: verifyToken, verified: false })
        .eq('id', business.id);

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const baseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;

    try {
        // Call the business phone. User should decline/ignore so it forwards to Twilio.
        // When the forwarded call hits our voice webhook, it will see the
        // business has a pending verification_token and matching verification_call_sid,
        // and mark verified=true.
        const call = await client.calls.create({
            url: `${baseUrl}/api/verify/webhook`,
            to: business.business_phone,
            from: business.forwarding_number,
            timeout: 20,
        });

        // Store the CallSid so the voice webhook can correlate the forwarded call
        await supabaseAdmin
            .from('businesses')
            .update({ verification_call_sid: call.sid })
            .eq('id', business.id);

        return new Response(JSON.stringify({
            success: true,
            message: 'Call initiated. Please decline or ignore the call to test forwarding.',
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        logger.error('Verification Call Failed', error);
        // Surface Twilio's actual failure so owners can self-serve the fix instead
        // of seeing a generic "Failed to place call". Common codes:
        //   21210/21219 — 'To' number isn't a Verified Caller ID (Twilio trial accounts)
        //   21211       — invalid 'To' phone number
        //   21601/21614 — number isn't reachable / not a valid mobile
        //   21205/11200/21601 — webhook URL couldn't be fetched by Twilio
        const twErr = error as { code?: number; message?: string };
        const friendly =
            twErr.code === 21210 || twErr.code === 21219
                ? 'Your business phone is not a verified caller ID on this account. Verify it in the Twilio Console (or upgrade off the trial), then try again.'
                : twErr.code === 21211
                ? 'Your business phone number looks invalid. Check it in the Phone Connection section above and try again.'
                : twErr.code === 21601 || twErr.code === 21614
                ? 'We could not place a call to your business phone — the number may be unreachable or not a valid phone line. Double-check it and try again.'
                : twErr.code === 11200 || twErr.code === 21205
                ? `Our server could not be reached to set up the call (${twErr.code}). This is usually a configuration issue on our end — please contact support.`
                : `The call could not be placed${twErr.code ? ` (error ${twErr.code})` : ''}. Please try again, or contact support if it keeps failing.`;

        return new Response(JSON.stringify({ success: false, error: friendly }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * GET /api/verify
 * Polls verification status for the current user's business.
 * The Wizard calls this to check if the webhook confirmed the forwarding.
 */
export async function GET() {
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
        .select('verified')
        .eq('user_id', user.id)
        .single();

    if (!business) return new Response('Business not found', { status: 404 });

    return new Response(JSON.stringify({ verified: business.verified ?? false }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
