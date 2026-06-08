export interface HotLeadCallRow {
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

export interface HotLeadActionItemRow {
    id: string;
    title: string;
    description: string | null;
    action_type: string | null;
    priority: string | null;
    status: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    call_analysis_id: string | null;
    rd_ticket_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface HotLeadItem {
    id: string;
    sourceType: 'call_analysis' | 'action_item';
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
    createdAt: string;
    updatedAt: string;
}

interface BuildHotLeadQueueArgs {
    calls: HotLeadCallRow[];
    actionItems?: HotLeadActionItemRow[];
    bookedToday?: number | null;
    now?: Date;
}

const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

function sortHotLeads(a: HotLeadItem, b: HotLeadItem) {
    const urgencyDiff = (urgencyOrder[a.urgency ?? ''] ?? 3) - (urgencyOrder[b.urgency ?? ''] ?? 3);
    if (urgencyDiff !== 0) return urgencyDiff;

    const aDue = a.dueBy ? new Date(a.dueBy).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.dueBy ? new Date(b.dueBy).getTime() : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export function buildHotLeadQueue({ calls, actionItems = [], bookedToday = null, now = new Date() }: BuildHotLeadQueueArgs) {
    const leads: HotLeadItem[] = [
        ...calls.map((row) => ({
            id: row.id,
            sourceType: 'call_analysis' as const,
            customerName: row.customer_name,
            customerPhone: row.customer_phone,
            urgency: row.urgency,
            callStatus: row.call_status,
            callbackStatus: row.callback_status,
            dueBy: row.due_by,
            summary: row.summary,
            followUpNotes: row.follow_up_notes,
            coachingNote: row.coaching_note,
            sourceCallId: row.source_call_id,
            rdTicketId: row.rd_ticket_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        })),
        ...actionItems.map((row) => ({
            id: row.id,
            sourceType: 'action_item' as const,
            customerName: row.customer_name,
            customerPhone: row.customer_phone,
            urgency: row.priority,
            callStatus: row.action_type,
            callbackStatus: row.status,
            dueBy: null,
            summary: row.title,
            followUpNotes: row.description,
            coachingNote: row.call_analysis_id ? `Linked call: ${row.call_analysis_id}` : null,
            sourceCallId: row.call_analysis_id,
            rdTicketId: row.rd_ticket_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        })),
    ].sort(sortHotLeads);

    const nowMs = now.getTime();

    return {
        summary: {
            total: leads.length,
            dueNow: leads.filter((lead) => lead.dueBy && new Date(lead.dueBy).getTime() <= nowMs).length,
            highUrgency: leads.filter((lead) => lead.urgency === 'high').length,
            bookedToday,
        },
        leads,
    };
}
