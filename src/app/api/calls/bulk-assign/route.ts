import { createSupabaseServerClient } from '@/lib/supabase-server';
import { validateCsrfOrigin } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const TAG = '[BulkAssign]';

const bodySchema = z.object({
    call_ids: z.array(z.string().uuid()).min(1).max(50),
    owner: z.string().min(1).max(100),
}).strict();

/**
 * POST /api/calls/bulk-assign
 * Assigns multiple call analyses to an owner.
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

        const { call_ids, owner } = parsed.data;

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

        // Update all matching calls owned by this business
        const { error: updateError, count } = await supabase
            .from('call_analyses')
            .update({ owner })
            .eq('business_id', business.id)
            .in('id', call_ids);

        if (updateError) {
            logger.error(`${TAG} Update failed`, updateError);
            return Response.json({ error: 'Failed to assign calls' }, { status: 500 });
        }

        logger.info(`${TAG} Bulk assigned`, { owner, count, callIds: call_ids.length });
        return Response.json({ success: true, assigned: count });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
