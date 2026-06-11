import { createSupabaseServerClient, supabaseAdmin } from '@/lib/supabase-server';
import { validateCsrfOrigin } from '@/lib/csrf';
import { checkBillingStatus } from '@/lib/billing-guard';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = '[FollowUpDraft Action]';

const bodySchema = z.object({
    action: z.enum(['approve', 'skip']),
    // Owner may edit the message before approving
    sms: z.string().min(1).max(320).optional(),
}).strict();

/**
 * POST /api/followups/drafts/:id   { action: "approve" | "skip", sms? }
 *
 * approve → sends the SMS to the customer (opt-out, rate-limit, and billing
 * guarded) and marks the draft sent. skip → marks skipped. Both owner-only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!validateCsrfOrigin(request)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const { id } = await params;

        let raw: unknown;
        try {
            raw = await request.json();
        } catch {
            return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
            return Response.json(
                { error: 'Invalid payload', details: parsed.error.issues.map((i) => i.message) },
                { status: 400 },
            );
        }

        const supabase = await createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (!user || authError) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id, forwarding_number')
            .eq('user_id', user.id)
            .single();
        if (!business) {
            return Response.json({ error: 'Business not found' }, { status: 404 });
        }

        // Atomically claim the draft: only a 'pending' row can transition, so a
        // double-tap or two devices can't send the same SMS twice.
        const nextStatus = parsed.data.action === 'approve' ? 'sent' : 'skipped';
        const { data: claimed, error: claimError } = await supabaseAdmin
            .from('pending_followups')
            .update({
                status: nextStatus,
                ...(parsed.data.action === 'approve'
                    ? { sent_at: new Date().toISOString(), ...(parsed.data.sms ? { draft_sms: parsed.data.sms } : {}) }
                    : {}),
            })
            .eq('id', id)
            .eq('business_id', business.id)
            .eq('status', 'pending')
            .select('id, customer_phone, draft_sms')
            .single();

        if (claimError || !claimed) {
            return Response.json({ error: 'Draft not found or already handled' }, { status: 404 });
        }

        if (parsed.data.action === 'skip') {
            return Response.json({ success: true, status: 'skipped' });
        }

        // --- approve: send, with every guard the rest of the app uses ---
        const revert = async () => {
            await supabaseAdmin
                .from('pending_followups')
                .update({ status: 'pending', sent_at: null })
                .eq('id', id);
        };

        if (!business.forwarding_number) {
            await revert();
            return Response.json({ error: 'No business phone number configured' }, { status: 400 });
        }

        const billing = await checkBillingStatus(business.id);
        if (!billing.allowed) {
            await revert();
            return Response.json({ error: 'Billing inactive' }, { status: 402 });
        }

        // TCPA: fail closed on opt-out lookup errors
        const { data: optOut, error: optOutError } = await supabaseAdmin
            .from('opt_outs')
            .select('id')
            .eq('business_id', business.id)
            .eq('phone_number', claimed.customer_phone)
            .maybeSingle();
        if (optOutError) {
            await revert();
            return Response.json({ error: 'Opt-out check failed, not sent' }, { status: 500 });
        }
        if (optOut) {
            // Customer opted out — never send; mark skipped so it leaves the queue
            await supabaseAdmin.from('pending_followups').update({ status: 'skipped' }).eq('id', id);
            return Response.json({ error: 'Customer has opted out of SMS' }, { status: 409 });
        }

        const rateLimit = await checkSmsRateLimit(business.id, claimed.customer_phone);
        if (!rateLimit.allowed) {
            await revert();
            return Response.json({ error: `Rate limited: ${rateLimit.reason || 'too many messages'}` }, { status: 429 });
        }

        try {
            const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            await client.messages.create({
                to: claimed.customer_phone,
                from: business.forwarding_number,
                body: claimed.draft_sms,
            });
        } catch (sendError) {
            logger.error(`${TAG} Twilio send failed`, sendError, { draftId: id });
            await revert();
            return Response.json({ error: 'SMS send failed' }, { status: 502 });
        }

        // Log to the conversation history when a lead exists for this phone
        const { data: lead } = await supabaseAdmin
            .from('leads')
            .select('id')
            .eq('business_id', business.id)
            .eq('caller_phone', claimed.customer_phone)
            .maybeSingle();
        if (lead) {
            await supabaseAdmin.from('messages').insert({
                lead_id: lead.id,
                direction: 'outbound',
                body: claimed.draft_sms,
                is_ai_generated: true,
            });
        }

        logger.info(`${TAG} Follow-up sent`, { draftId: id, businessId: business.id });
        return Response.json({ success: true, status: 'sent' });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
