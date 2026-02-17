import { supabaseAdmin } from '@/lib/supabase-server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import twilio from 'twilio';
import { z } from 'zod';

// Initialize Twilio Client
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const sendMessageSchema = z.object({
    leadId: z.string().uuid('Invalid lead ID format'),
    body: z.string().min(1, 'Message body is required').max(1600, 'Message too long (max 1600 characters)'),
});

export async function POST(request: Request) {
    try {
        const rawBody = await request.json();
        const parsed = sendMessageSchema.safeParse(rawBody);

        if (!parsed.success) {
            return new Response(JSON.stringify({
                success: false,
                error: parsed.error.issues[0]?.message || 'Invalid request',
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const { leadId, body } = parsed.data;

        // 1. Authenticate User
        const supabase = await createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            logger.warn('Unauthorized attempt to send message', { leadId });
            return new Response('Unauthorized', { status: 401 });
        }

        // 2. Authorization & Data Fetch
        // Ensure the lead belongs to a business owned by the user
        const { data: lead, error: leadError } = await supabaseAdmin
            .from('leads')
            .select(`
                id, 
                caller_phone, 
                business_id, 
                businesses!inner (
                    id, 
                    user_id, 
                    forwarding_number, 
                    name
                )
            `)
            .eq('id', leadId)
            // .eq('businesses.user_id', user.id) // This filter is tricky in Supabase joins sometimes, easier to check after
            .single();

        if (leadError || !lead) {
            logger.error('Lead lookup failed or unauthorized', leadError, { leadId, userId: user.id });
            return new Response('Lead not found or access denied', { status: 404 });
        }

        // Explicit ownership check if the join filter wasn't strict enough (though !inner usually creates an implicit filter)
        // With admin client, we MUST check user_id manually if RLS didn't apply (admin bypasses RLS).
        type LeadWithBusiness = typeof lead & {
            businesses: { id: string; user_id: string; forwarding_number: string; name: string };
        };
        const leadWithBusiness = lead as LeadWithBusiness;
        
        if (leadWithBusiness.businesses.user_id !== user.id) {
            logger.warn('User tried to access lead of another business', { userId: user.id, leadId });
            return new Response('Access denied', { status: 403 });
        }

        // 3. TCPA COMPLIANCE: Check if user is opted out
        // FAIL CLOSED: if the opt-out lookup errors, do NOT send SMS
        const businessId = leadWithBusiness.businesses.id;
        const toNumber = leadWithBusiness.caller_phone;

        const { data: optOut, error: optOutError } = await supabaseAdmin
            .from('opt_outs')
            .select('id')
            .eq('business_id', businessId)
            .eq('phone_number', toNumber)
            .maybeSingle();

        if (optOutError) {
            logger.error('Opt-out check failed, blocking send (fail closed)', optOutError, { leadId, toNumber, userId: user.id });
            return new Response(JSON.stringify({
                success: false,
                error: 'Unable to verify opt-out status. Please try again.'
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (optOut) {
            logger.warn('Attempted to send message to opted-out user', { leadId, toNumber, userId: user.id });
            return new Response(JSON.stringify({ 
                success: false, 
                error: 'Cannot send message: user has opted out' 
            }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 4. Send SMS via Twilio
        const fromNumber = leadWithBusiness.businesses.forwarding_number; // The business's Twilio number

        logger.info('Sending SMS', { from: fromNumber, to: toNumber, userId: user.id });

        await twilioClient.messages.create({
            body: body,
            from: fromNumber,
            to: toNumber,
        });

        // 5. Log Message to Database
        const { error: msgError } = await supabaseAdmin.from('messages').insert({
            lead_id: leadId,
            direction: 'outbound',
            body: body,
            // created_at is default now()
        });

        if (msgError) {
            logger.error('Failed to save outbound message to DB', msgError);
            // We successfully sent the SMS, so we shouldn't fail the request, but we should log it.
        }

        // 6. Update Lead Status (optional, e.g. move to 'Contacted')
        await supabaseAdmin.from('leads').update({ status: 'Contacted' }).eq('id', leadId).eq('status', 'New');

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        logger.error('Error in send message API', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}
