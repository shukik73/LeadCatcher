import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[HotLeads]';

// Callback statuses that still need owner action (i.e. not yet booked/lost).
const ACTIONABLE_STATUSES = ['pending', 'no_answer', 'called'] as const;

const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

interface CallRow {
    id: string;
    source_call_id: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    urgency: string | null;
    call_status: string | null;
    callback_status: string | null;
    due_by: string | null;
    summary: string | null;
    follow_up_notes: string | null;
    coaching_note: string | null;
    rd_ticket_id: string | null;
    created_at: string;
    updated_at: string;
}

/**
 * GET /api/hot-leads
 *
 * Hot Lead Recovery feed for the owner's business. A "hot lead" is any
 * analyzed call that still needs follow-up (follow_up_needed = true) and
 * hasn't been resolved as booked/lost.
 *
 * Requires authentication. RLS plus an explicit business_id filter ensure
 * only the current user's business data is returned (no cross-tenant leakage).
 *
 * Sorted by urgency (high > medium > low) then due_by ASC, limited to 100.
 */
export async function GET() {
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

        const { data, error } = await supabase
            .from('call_analyses')
            .select(
                'id, source_call_id, customer_name, customer_phone, urgency, call_status, callback_status, due_by, summary, follow_up_notes, coaching_note, rd_ticket_id, created_at, updated_at',
            )
            .eq('business_id', business.id)
            .eq('follow_up_needed', true)
            .in('callback_status', ACTIONABLE_STATUSES as unknown as string[])
            .order('due_by', { ascending: true, nullsFirst: false })
            .limit(100);

        if (error) {
            logger.error(`${TAG} Query failed`, error);
            return Response.json({ error: 'Failed to fetch hot leads' }, { status: 500 });
        }

        const rows = (data || []) as CallRow[];

        // Sort in JS: urgency DESC (high first), then earliest due_by first.
        // Rows without a due_by sort after those that have one.
        const sorted = [...rows].sort((a, b) => {
            const urgDiff = (urgencyOrder[a.urgency ?? ''] ?? 3) - (urgencyOrder[b.urgency ?? ''] ?? 3);
            if (urgDiff !== 0) return urgDiff;
            const aDue = a.due_by ? new Date(a.due_by).getTime() : Number.POSITIVE_INFINITY;
            const bDue = b.due_by ? new Date(b.due_by).getTime() : Number.POSITIVE_INFINITY;
            return aDue - bDue;
        });

        const now = Date.now();
        const dueNow = sorted.filter((r) => r.due_by && new Date(r.due_by).getTime() <= now).length;
        const highUrgency = sorted.filter((r) => r.urgency === 'high').length;

        // Booked today — derived from existing data (call_analyses resolved as
        // booked and updated since the start of the local day). Null if it can't
        // be computed (treated as "—" in the UI).
        let bookedToday: number | null = null;
        try {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const { count } = await supabase
                .from('call_analyses')
                .select('id', { count: 'exact', head: true })
                .eq('business_id', business.id)
                .eq('callback_status', 'booked')
                .gte('updated_at', startOfDay.toISOString());
            bookedToday = count ?? 0;
        } catch {
            bookedToday = null;
        }

        const leads = sorted.map((r) => ({
            id: r.id,
            customerName: r.customer_name,
            customerPhone: r.customer_phone,
            urgency: r.urgency,
            callStatus: r.call_status,
            callbackStatus: r.callback_status,
            dueBy: r.due_by,
            summary: r.summary,
            followUpNotes: r.follow_up_notes,
            coachingNote: r.coaching_note,
            sourceCallId: r.source_call_id,
            rdTicketId: r.rd_ticket_id,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        }));

        return Response.json({
            success: true,
            summary: {
                total: leads.length,
                dueNow,
                highUrgency,
                bookedToday,
            },
            leads,
        });
    } catch (error) {
        logger.error(`${TAG} Unexpected error`, error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
