import { createSupabaseServerClient } from '@/lib/supabase-server';
import { generateDailyReport } from '@/lib/daily-report';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[DailyReportAPI]';

/**
 * GET /api/calls/daily-report?from=2024-01-01&to=2024-01-02&format=markdown
 *
 * Returns daily call analysis report. Defaults to last 24 hours.
 * format=markdown returns plain text, otherwise JSON.
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
        const from = searchParams.get('from') || undefined;
        const to = searchParams.get('to') || undefined;
        const format = searchParams.get('format');

        const report = await generateDailyReport(business.id, from, to);

        if (format === 'markdown') {
            return new Response(report.markdown, {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
        }

        return Response.json({ success: true, report: report.json });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
