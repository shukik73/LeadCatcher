import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[PendingFollowups]';

/**
 * GET /api/calls/pending-followups?urgency=high|medium|low
 *
 * Returns callback queue ordered by urgency DESC then due_by ASC.
 * Requires authentication — returns only the user's business calls.
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
            .select('id')
            .eq('user_id', user.id)
            .single();

        if (!business) {
            return Response.json({ error: 'Business not found' }, { status: 404 });
        }

        const { searchParams } = new URL(request.url);
        const urgencyFilter = searchParams.get('urgency');

        // Validate urgency param if provided
        if (urgencyFilter && !['high', 'medium', 'low'].includes(urgencyFilter)) {
            return Response.json({ error: 'Invalid urgency. Use high, medium, or low.' }, { status: 400 });
        }

        let query = supabase
            .from('call_analyses')
            .select('*')
            .eq('business_id', business.id)
            .eq('follow_up_needed', true)
            .in('callback_status', ['pending', 'called', 'no_answer']);

        if (urgencyFilter) {
            query = query.eq('urgency', urgencyFilter);
        }

        // Order: high > medium > low, then earliest due_by first
        // Supabase doesn't support custom sort order, so we use a workaround:
        // Sort by due_by ASC — high urgency items naturally have earlier due_by
        const { data, error } = await query
            .order('due_by', { ascending: true })
            .limit(100);

        if (error) {
            logger.error(`${TAG} Query failed`, error);
            return Response.json({ error: 'Failed to fetch follow-ups' }, { status: 500 });
        }

        // Sort in JS: urgency DESC then due_by ASC
        const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const sorted = (data || []).sort((a, b) => {
            const urgDiff = (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2);
            if (urgDiff !== 0) return urgDiff;
            return new Date(a.due_by || 0).getTime() - new Date(b.due_by || 0).getTime();
        });

        return Response.json({
            success: true,
            count: sorted.length,
            followups: sorted,
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
