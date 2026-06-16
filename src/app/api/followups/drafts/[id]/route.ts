import { createSupabaseServerClient, supabaseAdmin } from '@/lib/supabase-server';
import { validateCsrfOrigin } from '@/lib/csrf';
import { sendFollowUpSms } from '@/lib/followup-send';
import { logger } from '@/lib/logger';
import { z } from 'zod';

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

        // --- approve: send via the shared guard stack (billing, opt-out, rate limit) ---
        if (!business.forwarding_number) {
            await supabaseAdmin.from('pending_followups').update({ status: 'pending', sent_at: null }).eq('id', id);
            return Response.json({ error: 'No business phone number configured' }, { status: 400 });
        }

        const result = await sendFollowUpSms({
            businessId: business.id,
            forwardingNumber: business.forwarding_number,
            customerPhone: claimed.customer_phone,
            body: claimed.draft_sms,
        });

        if (!result.sent) {
            if (result.optedOut) {
                // Never send; mark skipped so it leaves the queue.
                await supabaseAdmin.from('pending_followups').update({ status: 'skipped' }).eq('id', id);
                return Response.json({ error: 'Customer has opted out of SMS' }, { status: 409 });
            }
            // Transient failure — revert to pending so the owner can retry.
            await supabaseAdmin.from('pending_followups').update({ status: 'pending', sent_at: null }).eq('id', id);
            return Response.json({ error: result.reason || 'SMS send failed' }, { status: 502 });
        }

        await supabaseAdmin
            .from('pending_followups')
            .update({ sent_via: 'manual' })
            .eq('id', id);

        logger.info(`${TAG} Follow-up sent`, { draftId: id, businessId: business.id });
        return Response.json({ success: true, status: 'sent' });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
