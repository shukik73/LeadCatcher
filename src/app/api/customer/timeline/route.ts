import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[CustomerTimeline]';

/**
 * GET /api/customer/timeline?phone=+1234567890
 *
 * Returns a unified timeline of all interactions with a customer:
 * calls, SMS messages, action items, and audit data.
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
        const phone = searchParams.get('phone');

        if (!phone) {
            return Response.json({ error: 'Phone number required' }, { status: 400 });
        }

        // Fetch all data for this customer in parallel
        const [leadsResult, callsResult, actionsResult] = await Promise.all([
            // Leads + messages
            supabase
                .from('leads')
                .select(`
                    id, caller_phone, caller_name, status, intent, ai_summary,
                    source, created_at, converted_at, conversion_value,
                    messages (id, direction, body, is_ai_generated, created_at)
                `)
                .eq('business_id', business.id)
                .eq('caller_phone', phone)
                .order('created_at', { ascending: false })
                .limit(5),

            // Call analyses
            supabase
                .from('call_analyses')
                .select(`
                    id, source_call_id, call_status, call_duration, summary,
                    sentiment, category, urgency, callback_status, owner,
                    coaching_note, ai_quality_total, transcript,
                    rd_ticket_id, rd_synced_at, created_at
                `)
                .eq('business_id', business.id)
                .eq('customer_phone', phone)
                .order('created_at', { ascending: false })
                .limit(20),

            // Action items
            supabase
                .from('action_items')
                .select('id, title, description, action_type, priority, status, assigned_role, created_at, completed_at')
                .eq('business_id', business.id)
                .eq('customer_phone', phone)
                .order('created_at', { ascending: false })
                .limit(20),
        ]);

        // Build unified timeline
        const timeline: Array<{
            type: string;
            timestamp: string;
            data: Record<string, unknown>;
        }> = [];

        // Add calls
        for (const call of (callsResult.data || [])) {
            timeline.push({
                type: 'call',
                timestamp: call.created_at,
                data: call,
            });
        }

        // Add messages from all leads
        for (const lead of (leadsResult.data || [])) {
            const messages = (lead as Record<string, unknown>).messages as Array<Record<string, unknown>> | undefined;
            if (messages) {
                for (const msg of messages) {
                    timeline.push({
                        type: 'message',
                        timestamp: msg.created_at as string,
                        data: {
                            ...msg,
                            lead_id: lead.id,
                            lead_status: lead.status,
                        },
                    });
                }
            }
        }

        // Add action items
        for (const action of (actionsResult.data || [])) {
            timeline.push({
                type: 'action',
                timestamp: action.created_at,
                data: action,
            });
        }

        // Sort by timestamp descending
        timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        // Get customer name from any lead
        const customerName = (leadsResult.data || []).find(l => l.caller_name)?.caller_name || null;

        return Response.json({
            success: true,
            phone,
            customer_name: customerName,
            leads: leadsResult.data || [],
            timeline,
            stats: {
                total_calls: (callsResult.data || []).length,
                total_messages: timeline.filter(t => t.type === 'message').length,
                pending_actions: (actionsResult.data || []).filter(a => a.status === 'pending').length,
            },
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
