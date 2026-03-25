import { createSupabaseServerClient } from '@/lib/supabase-server';
import { generateCoachingSummary } from '@/lib/coaching-report';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[CoachingSummary]';

/**
 * GET /api/coaching/summary?period=week&from=2026-03-18&to=2026-03-25
 *
 * Returns coaching summary for a business over a date range.
 * Defaults to the last 7 days if no dates provided.
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
        const period = searchParams.get('period') || 'week';

        // Calculate date range
        const now = new Date();
        let fromDate: string;
        let toDate: string = now.toISOString();

        if (searchParams.get('from') && searchParams.get('to')) {
            fromDate = new Date(searchParams.get('from')!).toISOString();
            toDate = new Date(searchParams.get('to')! + 'T23:59:59').toISOString();
        } else {
            const daysBack = period === 'day' ? 1 : period === 'month' ? 30 : 7;
            fromDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString();
        }

        const summary = await generateCoachingSummary(business.id, fromDate, toDate);

        return Response.json({ success: true, summary });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
