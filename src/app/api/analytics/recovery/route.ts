import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { calculateRecoveryScore } from '@/lib/recovery-score';

export const dynamic = 'force-dynamic';

const TAG = '[Recovery Score]';

/**
 * GET /api/analytics/recovery?period=7|30|90
 *
 * Returns the missed-call recovery scoreboard:
 *   missed_calls / sms_sent / customer_replies / booked_leads / recovery_rate /
 *   estimated_recovered_revenue.
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
        const period = parseInt(searchParams.get('period') || '30', 10);
        const days = Math.min(90, Math.max(1, period));
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        // Run all aggregate queries in parallel.
        const [missedRes, leadsRes, repliesRes, smsSentRes, bookedRevRes] = await Promise.all([
            // Missed calls in window (call_analyses.call_status = 'missed').
            supabase
                .from('call_analyses')
                .select('id', { count: 'exact', head: true })
                .eq('business_id', business.id)
                .eq('call_status', 'missed')
                .gte('created_at', since),
            // Leads in window — for booked count + revenue.
            supabase
                .from('leads')
                .select('id, status, conversion_value', { count: 'exact' })
                .eq('business_id', business.id)
                .gte('created_at', since),
            // Inbound customer replies (messages joined to leads).
            supabase
                .from('messages')
                .select('id, leads!inner(business_id, created_at)', { count: 'exact', head: true })
                .eq('direction', 'inbound')
                .eq('leads.business_id', business.id)
                .gte('leads.created_at', since),
            // Outbound SMS the system sent for the period's leads.
            supabase
                .from('messages')
                .select('id, leads!inner(business_id, created_at)', { count: 'exact', head: true })
                .eq('direction', 'outbound')
                .eq('leads.business_id', business.id)
                .gte('leads.created_at', since),
            // Avg booked revenue from call_analyses (when available).
            supabase
                .from('call_analyses')
                .select('booked_value')
                .eq('business_id', business.id)
                .not('booked_value', 'is', null)
                .gte('created_at', since),
        ]);

        const missedCalls = missedRes.count || 0;
        const smsSent = smsSentRes.count || 0;
        const customerReplies = repliesRes.count || 0;

        const leadRows = (leadsRes.data || []) as Array<{ status: string | null; conversion_value: number | null }>;
        const bookedLeads = leadRows.filter(l => l.status === 'Booked' || l.status === 'Closed').length;

        const conversionValues = leadRows
            .filter(l => l.conversion_value != null)
            .map(l => Number(l.conversion_value));
        const callBookedValues = ((bookedRevRes.data || []) as Array<{ booked_value: number | null }>)
            .map(r => Number(r.booked_value || 0))
            .filter(v => v > 0);
        const allValues = [...conversionValues, ...callBookedValues];
        const avgBookedValue = allValues.length > 0
            ? allValues.reduce((sum, v) => sum + v, 0) / allValues.length
            : 0;

        const score = calculateRecoveryScore({
            missedCalls,
            smsSent,
            customerReplies,
            bookedLeads,
            avgBookedValue,
        });

        return Response.json({
            success: true,
            period: days,
            ...score,
            avg_booked_value: Math.round(avgBookedValue * 100) / 100,
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
