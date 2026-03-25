import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[CallDetail]';

/**
 * GET /api/calls/:id
 *
 * Returns full details for a single call analysis.
 */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
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

        const { id } = await params;

        const { data: call, error: fetchError } = await supabase
            .from('call_analyses')
            .select('*')
            .eq('id', id)
            .eq('business_id', business.id)
            .single();

        if (!call || fetchError) {
            return Response.json({ error: 'Call not found' }, { status: 404 });
        }

        return Response.json({ success: true, call });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
