import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TAG = '[HotLeads]';

// Callback statuses that still need owner action (i.e. not yet booked/lost).
const ACTIONABLE_STATUSES = ['pending', 'no_answer', 'called'] as const;
// Action-item statuses that still need owner action.
const OPEN_ACTION_STATUSES = ['pending', 'in_progress'] as const;

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

interface ActionItemRow {
    id: string;
    call_analysis_id: string | null;
    title: string | null;
    description: string | null;
    action_type: string | null;
    priority: string | null;
    status: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    rd_ticket_id: string | null;
    created_at: string;
    updated_at: string;
}

// Unified shape the dashboard renders. `type` discriminates a call-based lead
// (supports call quick actions) from an AI action item (supports complete/dismiss).
interface HotLead {
    type: 'call' | 'action';
    id: string;
    customerName: string | null;
    customerPhone: string | null;
    urgency: string | null;
    callStatus: string | null;
    callbackStatus: string | null;
    dueBy: string | null;
    summary: string | null;
    followUpNotes: string | null;
    coachingNote: string | null;
    sourceCallId: string | null;
    rdTicketId: string | null;
    actionType: string | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * GET /api/hot-leads
 *
 * Hot Lead Recovery feed for the owner's business. A "hot lead" is either:
 *   - an analyzed call that still needs follow-up (follow_up_needed = true and
 *     callback_status not yet booked/lost), or
 *   - an open AI action item (status pending/in_progress).
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

        // --- Call-based hot leads ---
        const { data: callData, error: callError } = await supabase
            .from('call_analyses')
            .select(
                'id, source_call_id, customer_name, customer_phone, urgency, call_status, callback_status, due_by, summary, follow_up_notes, coaching_note, rd_ticket_id, created_at, updated_at',
            )
            .eq('business_id', business.id)
            .eq('follow_up_needed', true)
            .in('callback_status', ACTIONABLE_STATUSES as unknown as string[])
            .order('due_by', { ascending: true, nullsFirst: false })
            .limit(100);

        if (callError) {
            logger.error(`${TAG} Call query failed`, callError);
            return Response.json({ error: 'Failed to fetch hot leads' }, { status: 500 });
        }

        const callRows = (callData || []) as CallRow[];
        const callLeads: HotLead[] = callRows.map((r) => ({
            type: 'call',
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
            actionType: null,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        }));

        // --- Open AI action items ---
        // Deduped against calls already in the feed so a customer doesn't appear
        // twice. The action_items table may not exist on older deployments — we
        // degrade gracefully to an empty list rather than failing the whole feed.
        const callIds = new Set(callRows.map((r) => r.id));
        let actionLeads: HotLead[] = [];

        const { data: actionData, error: actionError } = await supabase
            .from('action_items')
            .select(
                'id, call_analysis_id, title, description, action_type, priority, status, customer_name, customer_phone, rd_ticket_id, created_at, updated_at',
            )
            .eq('business_id', business.id)
            .in('status', OPEN_ACTION_STATUSES as unknown as string[])
            .limit(100);

        if (actionError) {
            if (actionError.code === '42P01' || actionError.message?.includes('does not exist')) {
                logger.warn(`${TAG} action_items table not found — skipping`);
            } else {
                logger.error(`${TAG} Action item query failed`, actionError);
            }
        } else {
            actionLeads = ((actionData || []) as ActionItemRow[])
                .filter((a) => !(a.call_analysis_id && callIds.has(a.call_analysis_id)))
                .map((a) => ({
                    type: 'action',
                    id: a.id,
                    customerName: a.customer_name,
                    customerPhone: a.customer_phone,
                    urgency: a.priority, // action priority shares the high/medium/low scale
                    callStatus: null,
                    callbackStatus: a.status,
                    dueBy: null, // action items have no due_by
                    summary: a.title,
                    followUpNotes: a.description,
                    coachingNote: null,
                    sourceCallId: null,
                    rdTicketId: a.rd_ticket_id,
                    actionType: a.action_type,
                    createdAt: a.created_at,
                    updatedAt: a.updated_at,
                }));
        }

        // --- Merge + sort: urgency (high first), then earliest due_by first.
        // Items without a due_by (all action items) sort after dated calls of the
        // same urgency. Capped at 100 for the combined feed.
        const leads = [...callLeads, ...actionLeads]
            .sort((a, b) => {
                const urgDiff = (urgencyOrder[a.urgency ?? ''] ?? 3) - (urgencyOrder[b.urgency ?? ''] ?? 3);
                if (urgDiff !== 0) return urgDiff;
                const aDue = a.dueBy ? new Date(a.dueBy).getTime() : Number.POSITIVE_INFINITY;
                const bDue = b.dueBy ? new Date(b.dueBy).getTime() : Number.POSITIVE_INFINITY;
                return aDue - bDue;
            })
            .slice(0, 100);

        const now = Date.now();
        const dueNow = leads.filter((r) => r.dueBy && new Date(r.dueBy).getTime() <= now).length;
        const highUrgency = leads.filter((r) => r.urgency === 'high').length;

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
