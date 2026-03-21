import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getTopPatterns } from '@/lib/pattern-tracker';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[TopPatterns]';

/**
 * GET /api/calls/patterns/top?type=sms&limit=10&min_uses=3
 *
 * Returns top-performing message patterns ordered by conversion rate.
 * Used for future voice/SMS tuning.
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
        const patternType = searchParams.get('type') || undefined;
        const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 50);
        const minUses = Math.max(parseInt(searchParams.get('min_uses') || '3', 10), 1);

        const patterns = await getTopPatterns(business.id, patternType, limit, minUses);

        return Response.json({
            success: true,
            count: patterns.length,
            patterns,
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
