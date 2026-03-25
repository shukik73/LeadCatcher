import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[CoachingByOwner]';

/**
 * GET /api/coaching/by-owner?owner=John&from=...&to=...
 *
 * Returns detailed coaching data for a specific owner.
 * If no owner specified, returns all owners with their stats.
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
        const owner = searchParams.get('owner');

        // Default to last 30 days
        const now = new Date();
        const fromDate = searchParams.get('from')
            ? new Date(searchParams.get('from')!).toISOString()
            : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const toDate = searchParams.get('to')
            ? new Date(searchParams.get('to')! + 'T23:59:59').toISOString()
            : now.toISOString();

        let query = supabase
            .from('call_analyses')
            .select('*')
            .eq('business_id', business.id)
            .gte('created_at', fromDate)
            .lte('created_at', toDate)
            .not('owner', 'is', null);

        if (owner) {
            query = query.eq('owner', owner);
        }

        const { data: calls, error } = await query;

        if (error) {
            logger.error(`${TAG} Query failed`, error);
            return Response.json({ error: 'Failed to fetch data' }, { status: 500 });
        }

        // Aggregate by owner
        const ownerMap: Record<string, {
            total: number;
            booked: number;
            lost: number;
            pending: number;
            revenue: number;
            notes: string[];
            responseTimes: number[];
        }> = {};

        for (const call of (calls || [])) {
            const key = call.owner || 'Unknown';
            if (!ownerMap[key]) {
                ownerMap[key] = { total: 0, booked: 0, lost: 0, pending: 0, revenue: 0, notes: [], responseTimes: [] };
            }
            const s = ownerMap[key];
            s.total++;
            if (call.callback_status === 'booked') {
                s.booked++;
                if (call.booked_value) s.revenue += Number(call.booked_value);
            }
            if (call.callback_status === 'lost') s.lost++;
            if (['pending', 'called', 'no_answer'].includes(call.callback_status)) s.pending++;
            if (call.coaching_note?.trim()) s.notes.push(call.coaching_note.trim());

            if (call.last_contacted_at && call.created_at) {
                const minutes = (new Date(call.last_contacted_at).getTime() - new Date(call.created_at).getTime()) / 60000;
                if (minutes > 0 && minutes < 10080) s.responseTimes.push(minutes);
            }
        }

        const owners = Object.entries(ownerMap).map(([name, s]) => ({
            owner: name,
            total_calls: s.total,
            calls_booked: s.booked,
            calls_lost: s.lost,
            calls_pending: s.pending,
            revenue: s.revenue,
            booked_rate: s.total > 0 ? Math.round((s.booked / s.total) * 100) : 0,
            avg_response_minutes: s.responseTimes.length > 0
                ? Math.round(s.responseTimes.reduce((a, b) => a + b, 0) / s.responseTimes.length)
                : null,
            top_coaching_notes: [...new Set(s.notes)].slice(0, 5),
        })).sort((a, b) => b.total_calls - a.total_calls);

        return Response.json({ success: true, owners });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
