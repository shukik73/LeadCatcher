
import { supabaseAdmin } from '@/lib/supabase-server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import twilio from 'twilio';

// This route triggers a real call to the user's business phone to verify forwarding.
// 1. Authenticate User
// 2. Fetch Business Phone
// 3. Make Outbound Call via Twilio
// 4. Update Business 'verified' status ? No, we verify it when WE receive the call back on the forwarding number.
// Wait, the flow is: We call the business number -> Carrier Forwards to Twilio -> Voice Webhook picks up.
// If Voice Webhook picks up and sees "Caller" is our verification service (or just any call), we mark verified?

// Actually, simpler flow for MVP:
// We just PLACE a call. If the user picks up, it means it rang. 
// BUT, to verify FORWARDING, we need to know if it hit Twilio.
// So:
// 1. We call Business Phone.
// 2. User ignores it (or we force busy?).
// 3. Carrier forwards to Twilio Number.
// 4. Twilio Webhook handles it.
// 5. Webhook should mark business as "verified" if it detects this specific test call.

export const dynamic = 'force-dynamic';

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
        .select('*')
        .eq('user_id', user.id)
        .single();

    if (!business) return new Response('Business not found', { status: 404 });

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    try {
        // We call the BUSINESS phone (the one they want to forward FROM)
        // We use a specific 'from' number (our Twilio number)
        // We can verify "forwarding" if the call eventually loops back to us? 
        // Actually, if we call them, and they have forwarding setup, it should ring OUR number?
        // That would be a loop. 
        // Twilio Call -> Business Phone -> Forwarding -> Twilio Number.
        // Twilio detects loops and kills them.

        // Better Verification for MVP:
        // Just place a call. Tell user to DECLINE it.
        // If they decline, it forwards to us.
        // Our Voice Webhook receives it.
        // We mark verified.

        await client.calls.create({
            url: `${process.env.APP_BASE_URL}/api/verify/webhook`, // TwiML for when they answer (if they answer)
            to: business.business_phone,
            from: process.env.TWILIO_PHONE_NUMBER!, // Our main number
            timeout: 20 // Short timeout so it forwards quickly?
        });

        return new Response(JSON.stringify({ success: true, message: 'Call initiated. Please decline the call to test forwarding.' }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Verification Call Failed:', error);
        return new Response(JSON.stringify({ success: false, error: 'Failed to place call' }), { status: 500 });
    }
}
