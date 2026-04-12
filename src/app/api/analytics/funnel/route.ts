import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[Analytics]';

/**
 * GET /api/analytics/funnel?period=7|30|90
 *
 * Returns lead conversion funnel data:
 * - Missed calls → SMS sent → Customer replied → Booked → Revenue
 * - Conversion rates at each stage
 * - Breakdown by day of week and hour
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

        // Fetch all data in parallel
        const [
            totalLeadsResult,
            contactedResult,
            bookedResult,
            callsResult,
            messagesResult,
            revenueResult,
        ] = await Promise.all([
            // Total leads in period
            supabase
                .from('leads')
                .select('id, status, source, created_at, converted_at, conversion_value', { count: 'exact' })
                .eq('business_id', business.id)
                .gte('created_at', since),

            // Contacted (replied)
            supabase
                .from('leads')
                .select('id', { count: 'exact', head: true })
                .eq('business_id', business.id)
                .in('status', ['Contacted', 'Booked', 'Closed'])
                .gte('created_at', since),

            // Booked
            supabase
                .from('leads')
                .select('id', { count: 'exact', head: true })
                .eq('business_id', business.id)
                .in('status', ['Booked', 'Closed'])
                .gte('created_at', since),

            // Calls
            supabase
                .from('call_analyses')
                .select('id, call_status, callback_status, booked_value, owner, created_at', { count: 'exact' })
                .eq('business_id', business.id)
                .gte('created_at', since),

            // Outbound messages
            supabase
                .from('messages')
                .select('id', { count: 'exact', head: true })
                .eq('direction', 'outbound')
                .in('lead_id', (await supabase
                    .from('leads')
                    .select('id')
                    .eq('business_id', business.id)
                    .gte('created_at', since)
                ).data?.map(l => l.id) || []),

            // Revenue from booked calls
            supabase
                .from('call_analyses')
                .select('booked_value')
                .eq('business_id', business.id)
                .not('booked_value', 'is', null)
                .gte('created_at', since),
        ]);

        const totalLeads = totalLeadsResult.count || 0;
        const contacted = contactedResult.count || 0;
        const booked = bookedResult.count || 0;
        const totalCalls = callsResult.count || 0;
        const smsSent = messagesResult.count || 0;

        // Calculate revenue
        const revenue = (revenueResult.data || [])
            .reduce((sum, r) => sum + (r.booked_value || 0), 0);

        // Calculate lead conversions with value
        const leadRevenue = (totalLeadsResult.data || [])
            .filter(l => l.conversion_value != null)
            .reduce((sum, l) => sum + (l.conversion_value || 0), 0);

        const totalRevenue = revenue + leadRevenue;

        // Calls breakdown
        const calls = callsResult.data || [];
        const missedCalls = calls.filter(c => c.call_status === 'missed').length;
        const answeredCalls = calls.filter(c => c.call_status === 'answered').length;
        const bookedCalls = calls.filter(c => c.callback_status === 'booked').length;
        const lostCalls = calls.filter(c => c.callback_status === 'lost').length;

        // Conversion rates
        const missedToContactRate = missedCalls > 0 ? Math.round((contacted / missedCalls) * 100) : 0;
        const contactToBookRate = contacted > 0 ? Math.round((booked / contacted) * 100) : 0;
        const overallConversion = totalLeads > 0 ? Math.round((booked / totalLeads) * 100) : 0;

        // Owner/employee leaderboard
        const ownerMap: Record<string, { calls: number; booked: number; revenue: number }> = {};
        for (const call of calls) {
            const owner = call.owner || 'Unassigned';
            if (!ownerMap[owner]) ownerMap[owner] = { calls: 0, booked: 0, revenue: 0 };
            ownerMap[owner].calls++;
            if (call.callback_status === 'booked') {
                ownerMap[owner].booked++;
                ownerMap[owner].revenue += call.booked_value || 0;
            }
        }
        const leaderboard = Object.entries(ownerMap)
            .map(([name, stats]) => ({ name, ...stats }))
            .sort((a, b) => b.booked - a.booked);

        return Response.json({
            success: true,
            period: days,
            funnel: {
                total_calls: totalCalls,
                missed_calls: missedCalls,
                answered_calls: answeredCalls,
                sms_sent: smsSent,
                total_leads: totalLeads,
                contacted: contacted,
                booked: booked,
                lost: lostCalls,
                revenue: totalRevenue,
            },
            rates: {
                missed_to_contact: missedToContactRate,
                contact_to_book: contactToBookRate,
                overall_conversion: overallConversion,
            },
            leaderboard,
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
