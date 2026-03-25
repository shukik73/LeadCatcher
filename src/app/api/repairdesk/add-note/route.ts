import { createSupabaseServerClient } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { validateCsrfOrigin } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const TAG = '[RD AddNote]';

const bodySchema = z.object({
    ticket_id: z.number().int().positive(),
    note: z.string().min(1).max(5000),
}).strict();

/**
 * POST /api/repairdesk/add-note
 *
 * Adds a note to a RepairDesk ticket.
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

        const { ticket_id, note } = parsed.data;

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

        const client = new RepairDeskClient(
            business.repairdesk_api_key,
            business.repairdesk_store_url || undefined,
        );

        await client.addTicketNote(ticket_id, note);

        logger.info(`${TAG} Note added`, { ticketId: ticket_id.toString() });
        return Response.json({ success: true });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Failed to add note' }, { status: 500 });
    }
}
