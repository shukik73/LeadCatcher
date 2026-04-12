import { createSupabaseServerClient } from '@/lib/supabase-server';
import { validateCsrfOrigin } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const TAG = '[ActionItemUpdate]';

const updateSchema = z.object({
    id: z.string().uuid(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
    assigned_to: z.string().max(200).optional(),
    assigned_role: z.enum(['owner', 'tech', 'front_desk']).optional(),
}).strict();

/**
 * POST /api/action-items/update
 *
 * Update an action item's status, assignment, etc.
 * Completing an item sets completed_at automatically.
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

        const parsed = updateSchema.safeParse(body);
        if (!parsed.success) {
            return Response.json(
                { error: 'Invalid payload', details: parsed.error.issues.map(i => i.message) },
                { status: 400 },
            );
        }

        const { id, status, assigned_to, assigned_role } = parsed.data;

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

        // Verify ownership
        const { data: item } = await supabase
            .from('action_items')
            .select('id')
            .eq('id', id)
            .eq('business_id', business.id)
            .single();

        if (!item) {
            return Response.json({ error: 'Action item not found' }, { status: 404 });
        }

        // Build update payload
        const updates: Record<string, unknown> = {};
        if (status) {
            updates.status = status;
            if (status === 'completed') {
                updates.completed_at = new Date().toISOString();
            } else {
                updates.completed_at = null;
            }
        }
        if (assigned_to !== undefined) updates.assigned_to = assigned_to;
        if (assigned_role !== undefined) updates.assigned_role = assigned_role;

        if (Object.keys(updates).length === 0) {
            return Response.json({ error: 'No updates provided' }, { status: 400 });
        }

        const { error: updateError } = await supabase
            .from('action_items')
            .update(updates)
            .eq('id', id);

        if (updateError) {
            logger.error(`${TAG} Update failed`, updateError, { id });
            return Response.json({ error: 'Failed to update' }, { status: 500 });
        }

        logger.info(`${TAG} Updated`, { id, updates: JSON.stringify(updates) });

        return Response.json({ success: true });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
