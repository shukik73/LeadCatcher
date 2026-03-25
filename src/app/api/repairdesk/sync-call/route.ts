import { createSupabaseServerClient } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { validateCsrfOrigin } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const TAG = '[RD SyncCall]';

const bodySchema = z.object({
    call_id: z.string().uuid(),
}).strict();

/**
 * POST /api/repairdesk/sync-call
 *
 * Syncs a call analysis to RepairDesk:
 * 1. Looks up the customer by phone in RepairDesk
 * 2. Finds their open ticket(s)
 * 3. Adds a note with the call summary and outcome
 * 4. Updates the call_analyses record with rd_ticket_id and rd_synced_at
 *
 * Non-blocking: RepairDesk failures don't prevent local updates.
 */
export async function POST(request: Request) {
    if (!validateCsrfOrigin(request)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) {
            return Response.json(
                { error: 'Invalid payload', details: parsed.error.issues.map(i => i.message) },
                { status: 400 },
            );
        }

        const { call_id } = parsed.data;

        const supabase = await createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (!user || authError) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id, repairdesk_api_key, repairdesk_store_url')
            .eq('user_id', user.id)
            .single();

        if (!business) {
            return Response.json({ error: 'Business not found' }, { status: 404 });
        }

        if (!business.repairdesk_api_key) {
            return Response.json({ error: 'RepairDesk not configured' }, { status: 400 });
        }

        // Fetch the call analysis
        const { data: call, error: callError } = await supabase
            .from('call_analyses')
            .select('*')
            .eq('id', call_id)
            .eq('business_id', business.id)
            .single();

        if (!call || callError) {
            return Response.json({ error: 'Call not found' }, { status: 404 });
        }

        // Skip if already synced
        if (call.rd_synced_at) {
            return Response.json({ success: true, already_synced: true });
        }

        const client = new RepairDeskClient(
            business.repairdesk_api_key,
            business.repairdesk_store_url || undefined,
        );

        let ticketId: number | null = null;
        let ticketStatus: string | null = null;

        // Try to find a ticket for this customer
        if (call.customer_phone) {
            try {
                const tickets = await client.searchTickets(call.customer_phone);
                if (tickets.data.length > 0) {
                    // Use the most recent ticket
                    const ticket = tickets.data[0];
                    ticketId = ticket.id;
                    ticketStatus = ticket.status;

                    // Build note from call analysis
                    const noteParts = [
                        `[LeadCatcher Call Review]`,
                        `Date: ${new Date(call.created_at).toLocaleString()}`,
                        `Category: ${call.category || 'N/A'}`,
                        `Urgency: ${call.urgency || 'N/A'}`,
                        `Status: ${call.callback_status}`,
                        call.summary ? `Summary: ${call.summary}` : null,
                        call.outcome_notes ? `Outcome: ${call.outcome_notes}` : null,
                        call.follow_up_notes ? `Follow-up Notes: ${call.follow_up_notes}` : null,
                    ].filter(Boolean).join('\n');

                    await client.addTicketNote(ticket.id, noteParts);
                }
            } catch (error) {
                // Non-blocking: log and continue
                logger.error(`${TAG} Failed to sync to RepairDesk ticket`, error, {
                    callId: call_id,
                    phone: call.customer_phone,
                });
            }
        }

        // Update call_analyses with sync info (even if ticket wasn't found)
        const { error: updateError } = await supabase
            .from('call_analyses')
            .update({
                rd_synced_at: new Date().toISOString(),
                ...(ticketId != null ? { rd_ticket_id: ticketId.toString() } : {}),
                ...(ticketStatus ? { rd_ticket_status: ticketStatus } : {}),
            })
            .eq('id', call_id);

        if (updateError) {
            logger.error(`${TAG} Failed to update sync status`, updateError, { callId: call_id });
        }

        logger.info(`${TAG} Call synced`, {
            callId: call_id,
            ticketId: ticketId?.toString() || 'none',
        });

        return Response.json({
            success: true,
            ticket_found: ticketId != null,
            ticket_id: ticketId,
            ticket_status: ticketStatus,
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Failed to sync call' }, { status: 500 });
    }
}
