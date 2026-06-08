import { createSupabaseServerClient } from '@/lib/supabase-server';
import { buildHotLeadQueue, type HotLeadActionItemRow, type HotLeadCallRow } from '@/lib/hot-lead-queue';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[HotLeads]';

// Callback statuses that still need owner action (i.e. not yet booked/lost).
const ACTIONABLE_STATUSES = ['pending', 'no_answer', 'called'] as const;
const OPEN_ACTION_ITEM_STATUSES = ['pending', 'in_progress'] as const;

/**
 * GET /api/hot-leads
 *
 * Hot Lead Recovery feed for the owner's business. A "hot lead" is any
 * analyzed call that still needs follow-up (follow_up_needed = true) and
 * hasn't been resolved as booked/lost.
 *
 * Requires authentication. RLS plus an explicit business_id filter ensure
 * only the current user's business data is returned (no cross-tenant leakage).
 *
 * Sorted by urgency (high > medium > low) then due_by ASC, limited to 100.
 */
export async function GET() {
    try {
        const supabase = await createSupabaseServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (!user || authError) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('user_id', user.id)
            .single();

        if (!business) {
            return Response.json({ error: 'Business not found' }, { status: 404 });
        }

        const { data, error } = await supabase
            .from('call_analyses')
            .select(
                'id, source_call_id, customer_name, customer_phone, urgency, call_status, callback_status, due_by, summary, follow_up_notes, coaching_note, rd_ticket_id, created_at, updated_at',
            )
            .eq('business_id', business.id)
            .eq('follow_up_needed', true)
            .in('callback_status', ACTIONABLE_STATUSES as unknown as string[])
            .order('due_by', { ascending: true, nullsFirst: false })
            .limit(100);

        if (error) {
            logger.error(`${TAG} Query failed`, error);
            return Response.json({ error: 'Failed to fetch hot leads' }, { status: 500 });
        }

        const { data: actionItems, error: actionItemsError } = await supabase
            .from('action_items')
            .select('id, title, description, action_type, priority, status, customer_name, customer_phone, call_analysis_id, rd_ticket_id, created_at, updated_at')
            .eq('business_id', business.id)
            .in('status', OPEN_ACTION_ITEM_STATUSES as unknown as string[])
            .order('created_at', { ascending: false })
            .limit(100);

        if (actionItemsError) {
            logger.error(`${TAG} Action item query failed`, actionItemsError);
            return Response.json({ error: 'Failed to fetch hot leads' }, { status: 500 });
        }

        // Booked today — derived from existing data (call_analyses resolved as
        // booked and updated since the start of the local day). Null if it can't
        // be computed (treated as "—" in the UI).
        let bookedToday: number | null = null;
        try {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const { count } = await supabase
                .from('call_analyses')
                .select('id', { count: 'exact', head: true })
                .eq('business_id', business.id)
                .eq('callback_status', 'booked')
                .gte('updated_at', startOfDay.toISOString());
            bookedToday = count ?? 0;
        } catch {
            bookedToday = null;
        }

        return Response.json({
            success: true,
            ...buildHotLeadQueue({
                calls: (data || []) as HotLeadCallRow[],
                actionItems: (actionItems || []) as HotLeadActionItemRow[],
                bookedToday,
            }),
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
