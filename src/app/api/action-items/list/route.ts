import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[ActionItemsList]';

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const VALID_PRIORITIES = ['high', 'medium', 'low'];
const VALID_TYPES = ['callback', 'follow_up', 'repair_update', 'quote_needed', 'escalation', 'info'];
const VALID_ROLES = ['owner', 'tech', 'front_desk'];

/**
 * GET /api/action-items/list
 *
 * List action items with filtering and pagination.
 * Query params: status, priority, action_type, assigned_role, from, to, page, limit
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
        const status = searchParams.get('status');
        const priority = searchParams.get('priority');
        const actionType = searchParams.get('action_type');
        const assignedRole = searchParams.get('assigned_role');
        const from = searchParams.get('from');
        const to = searchParams.get('to');
        const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));

        if (status && !VALID_STATUSES.includes(status)) {
            return Response.json({ error: 'Invalid status' }, { status: 400 });
        }
        if (priority && !VALID_PRIORITIES.includes(priority)) {
            return Response.json({ error: 'Invalid priority' }, { status: 400 });
        }
        if (actionType && !VALID_TYPES.includes(actionType)) {
            return Response.json({ error: 'Invalid action_type' }, { status: 400 });
        }
        if (assignedRole && !VALID_ROLES.includes(assignedRole)) {
            return Response.json({ error: 'Invalid assigned_role' }, { status: 400 });
        }

        let query = supabase
            .from('action_items')
            .select('*', { count: 'exact' })
            .eq('business_id', business.id);

        if (status) query = query.eq('status', status);
        if (priority) query = query.eq('priority', priority);
        if (actionType) query = query.eq('action_type', actionType);
        if (assignedRole) query = query.eq('assigned_role', assignedRole);
        if (from) query = query.gte('created_at', from);
        if (to) query = query.lte('created_at', to);

        const offset = (page - 1) * limit;
        const { data, error, count } = await query
            .order('priority', { ascending: true }) // high first
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            // Handle missing table gracefully (migration not yet run)
            if (error.code === '42P01' || error.message?.includes('does not exist')) {
                logger.warn(`${TAG} action_items table not found - migration may not have been run`);
                return Response.json({
                    success: true,
                    items: [],
                    pagination: { page, limit, total: 0, totalPages: 0 },
                    migration_needed: true,
                });
            }
            logger.error(`${TAG} Query failed`, error);
            return Response.json({ error: 'Failed to fetch action items' }, { status: 500 });
        }

        return Response.json({
            success: true,
            items: data || [],
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit),
            },
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
