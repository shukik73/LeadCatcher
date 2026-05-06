import { supabaseAdmin } from '@/lib/supabase-server';
import { checkBillingStatus } from '@/lib/billing-guard';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';
import { checkOptOut } from '@/lib/webhook-common';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'crypto';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

const TAG = '[FollowUp Cron]';
const MAX_FOLLOW_UPS = 1; // Only send one follow-up (no spam bombing)

function verifyCronSecret(header: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret || !header) return false;
    const expected = `Bearer ${secret}`;
    if (header.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * GET /api/cron/followup
 *
 * Sends follow-up SMS to leads who didn't reply after 15 minutes.
 * Triggered by Vercel Cron every 5 minutes.
 */
export async function GET(request: Request) {
    if (!verifyCronSecret(request.headers.get('Authorization'))) {
        return new Response('Unauthorized', { status: 401 });
    }

    // Atomically claim due follow-ups by transitioning status New -> Processing
    // and clearing follow_up_due_at in a single UPDATE ... RETURNING. Concurrent
    // cron invocations cannot claim the same row twice — the second one's UPDATE
    // matches zero rows because status is no longer 'New'.
    const now = new Date().toISOString();
    const { data: dueLeads, error } = await supabaseAdmin
        .from('leads')
        .update({ status: 'Processing', follow_up_due_at: null })
        .eq('status', 'New')
        .lte('follow_up_due_at', now)
        .lt('follow_up_count', MAX_FOLLOW_UPS)
        .select('id, caller_phone, business_id, follow_up_count');

    if (error) {
        logger.error(`${TAG} Failed to claim due leads`, error);
        return Response.json({ error: 'DB error' }, { status: 500 });
    }

    if (!dueLeads || dueLeads.length === 0) {
        return Response.json({ processed: 0 });
    }

    logger.info(`${TAG} Claimed ${dueLeads.length} follow-ups`);

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    let sent = 0;
    let skipped = 0;

    // Helper: revert claim by setting status back to New so other flows are not blocked.
    // follow_up_due_at was cleared during the atomic claim, so the row will not be
    // re-claimed on the next cron run unless something else schedules a new follow-up.
    const releaseLead = async (leadId: string) => {
        await supabaseAdmin.from('leads')
            .update({ status: 'New' })
            .eq('id', leadId);
    };

    for (const lead of dueLeads) {
        try {
            // Get business info
            const { data: business } = await supabaseAdmin
                .from('businesses')
                .select('id, forwarding_number, name, owner_phone')
                .eq('id', lead.business_id)
                .single();

            if (!business?.forwarding_number) {
                await releaseLead(lead.id);
                skipped++;
                continue;
            }

            // Check billing
            const billing = await checkBillingStatus(business.id);
            if (!billing.allowed) {
                logger.info(`${TAG} Skipping follow-up - billing inactive`, { leadId: lead.id });
                await releaseLead(lead.id);
                skipped++;
                continue;
            }

            // Check opt-out
            const optOut = await checkOptOut(business.id, lead.caller_phone, TAG);
            if (optOut.optedOut || optOut.error) {
                await releaseLead(lead.id);
                skipped++;
                continue;
            }

            // Check rate limit
            const rateLimit = await checkSmsRateLimit(business.id, lead.caller_phone);
            if (!rateLimit.allowed) {
                await releaseLead(lead.id);
                skipped++;
                continue;
            }

            // Send follow-up
            const safeName = business.name || 'us';
            const followUpMessage = `Just checking in — still need help with your device? Reply here and we'll get right back to you. - ${safeName}`;

            await client.messages.create({
                to: lead.caller_phone,
                from: business.forwarding_number,
                body: followUpMessage,
            });

            // Log message
            await supabaseAdmin.from('messages').insert({
                lead_id: lead.id,
                direction: 'outbound',
                body: followUpMessage,
                is_ai_generated: true,
            });

            // Mark follow-up as sent, restore status to Contacted
            await supabaseAdmin.from('leads')
                .update({
                    status: 'Contacted',
                    follow_up_count: (lead.follow_up_count || 0) + 1,
                })
                .eq('id', lead.id);

            sent++;
            logger.info(`${TAG} Follow-up sent`, { leadId: lead.id, caller: lead.caller_phone });

        } catch (err) {
            logger.error(`${TAG} Failed to send follow-up`, err, { leadId: lead.id });
            // Release the claim so the lead is not stuck in Processing forever
            await releaseLead(lead.id);
            skipped++;
        }
    }

    logger.info(`${TAG} Complete`, { sent, skipped });
    return Response.json({ processed: dueLeads.length, sent, skipped });
}
