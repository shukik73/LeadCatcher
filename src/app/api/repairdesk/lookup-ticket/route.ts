import { createSupabaseServerClient } from '@/lib/supabase-server';
import { RepairDeskClient } from '@/lib/repairdesk';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[RD LookupTicket]';

/**
 * GET /api/repairdesk/lookup-ticket?phone=+1234567890
 *
 * Searches RepairDesk for tickets matching a customer phone number.
 * Returns matching tickets with status info.
 */
export async function GET(request: Request) {
    try {
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

        const { searchParams } = new URL(request.url);
        const phone = searchParams.get('phone');

        if (!phone) {
            return Response.json({ error: 'phone parameter is required' }, { status: 400 });
        }

        const client = new RepairDeskClient(
            business.repairdesk_api_key,
            business.repairdesk_store_url || undefined,
        );

        const result = await client.searchTickets(phone);

        logger.info(`${TAG} Ticket lookup`, {
            phone,
            ticketCount: result.data.length.toString(),
        });

        return Response.json({
            success: true,
            tickets: result.data,
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Failed to lookup ticket' }, { status: 500 });
    }
}
