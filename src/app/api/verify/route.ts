import { supabaseAdmin } from '@/lib/supabase-server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import twilio from 'twilio';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/verify
 * Initiates a verification call and stores a verification token.
 * The voice webhook will detect the forwarded call and mark verified=true.
 */
export async function POST() {
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
        return new Response(JSON.stringify({ success: false, error: 'No Twilio number linked. Complete step 3 first.' }), {
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
        // business has a pending verification_token and mark verified=true.
        await client.calls.create({
            url: `${baseUrl}/api/verify/webhook`,
            to: business.business_phone,
            from: business.forwarding_number,
            timeout: 20,
        });

        return new Response(JSON.stringify({
            success: true,
            message: 'Call initiated. Please decline or ignore the call to test forwarding.',
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        logger.error('Verification Call Failed', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to place call' }), {
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
