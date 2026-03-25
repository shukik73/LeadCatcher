import { createSupabaseServerClient } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { logger } from '@/lib/logger';

const TAG = '[RD AutoSync]';

/**
 * Attempts to auto-sync a call analysis to RepairDesk in the background.
 * Non-blocking: errors are logged but never thrown. Returns quickly.
 *
 * Called after outcome events (booked/lost) and contact attempts.
 */
export async function autoSyncToRepairDesk(callId: string): Promise<void> {
    try {
        const supabase = await createSupabaseServerClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: business } = await supabase
            .from('businesses')
            .select('id, repairdesk_api_key, repairdesk_store_url')
            .eq('user_id', user.id)
            .single();

        if (!business?.repairdesk_api_key) return;

        const { data: call } = await supabase
            .from('call_analyses')
            .select('*')
            .eq('id', callId)
            .eq('business_id', business.id)
            .single();

        if (!call || !call.customer_phone) return;

        const client = new RepairDeskClient(
            business.repairdesk_api_key,
            business.repairdesk_store_url || undefined,
        );

        // Search for a ticket matching this customer
        const tickets = await client.searchTickets(call.customer_phone);
        if (tickets.data.length === 0) return;

        const ticket = tickets.data[0];

        // Build note
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

        // Update sync status
        await supabase
            .from('call_analyses')
            .update({
                rd_synced_at: new Date().toISOString(),
                rd_ticket_id: ticket.id.toString(),
                rd_ticket_status: ticket.status,
            })
            .eq('id', callId);

        logger.info(`${TAG} Auto-synced call to RepairDesk`, {
            callId,
            ticketId: ticket.id.toString(),
        });
    } catch (error) {
        // Non-blocking — log and move on
        logger.error(`${TAG} Auto-sync failed (non-blocking)`, error, { callId });
    }
}
