import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The route resolves `createSupabaseServerClient()` to whatever `mockClient`
// is set to for the current test.
let mockClient: unknown;
vi.mock('@/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(() => Promise.resolve(mockClient)),
}));

import { GET } from './route';

const BUSINESS_ID = 'biz-1';

interface QueryResult {
    data?: unknown;
    error?: unknown;
    count?: number;
}

// A chainable, awaitable query-builder mock. Every builder method returns the
// same chain; awaiting it (or calling .single()) resolves to `result`. Each
// `.eq(...)` call is recorded into `eqCalls` so tests can assert tenant scoping.
function makeQuery(result: QueryResult, eqCalls: Array<[string, unknown]>) {
    const chain: Record<string, unknown> = {
        select: vi.fn(() => chain),
        eq: vi.fn((col: string, val: unknown) => { eqCalls.push([col, val]); return chain; }),
        in: vi.fn(() => chain),
        gte: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        single: vi.fn(() => Promise.resolve(result)),
        then: (resolve: (r: QueryResult) => unknown) => resolve(result),
    };
    return chain;
}

interface Scenario {
    user?: { id: string } | null;
    business?: { id: string } | null;
    callRows?: unknown[];
    callError?: unknown;
    actionRows?: unknown[];
    actionError?: unknown;
    bookedCount?: number;
}

function buildClient(s: Scenario, eqCalls: Array<[string, unknown]>) {
    let callAnalysesCalls = 0;
    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({
                data: { user: s.user === undefined ? { id: 'user-1' } : s.user },
                error: null,
            }),
        },
        from: (table: string) => {
            if (table === 'businesses') {
                return makeQuery({ data: s.business === undefined ? { id: BUSINESS_ID } : s.business, error: null }, eqCalls);
            }
            if (table === 'call_analyses') {
                callAnalysesCalls++;
                if (callAnalysesCalls === 1) {
                    // Primary hot-lead query
                    return makeQuery({ data: s.callRows ?? [], error: s.callError ?? null }, eqCalls);
                }
                // bookedToday count query
                return makeQuery({ count: s.bookedCount ?? 0, error: null }, eqCalls);
            }
            if (table === 'action_items') {
                return makeQuery({ data: s.actionRows ?? [], error: s.actionError ?? null }, eqCalls);
            }
            return makeQuery({ data: null, error: null }, eqCalls);
        },
    };
}

async function runGet(s: Scenario) {
    const eqCalls: Array<[string, unknown]> = [];
    mockClient = buildClient(s, eqCalls);
    const res = await GET();
    const json = await res.json();
    return { status: res.status, json, eqCalls };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('GET /api/hot-leads', () => {
    it('returns 401 when unauthenticated', async () => {
        const { status, json } = await runGet({ user: null });
        expect(status).toBe(401);
        expect(json.error).toBe('Unauthorized');
    });

    it('returns 404 when the user has no business', async () => {
        const { status, json } = await runGet({ business: null });
        expect(status).toBe(404);
        expect(json.error).toBe('Business not found');
    });

    it('scopes every query to the user\'s business (tenant isolation)', async () => {
        const { eqCalls } = await runGet({ callRows: [] });
        // call_analyses and action_items queries must filter by business_id.
        const businessScoped = eqCalls.filter(([col, val]) => col === 'business_id' && val === BUSINESS_ID);
        expect(businessScoped.length).toBeGreaterThanOrEqual(2);
    });

    it('sorts by urgency (high first) then due_by ASC and computes summary counts', async () => {
        const callRows = [
            { id: 'a', urgency: 'low', due_by: null, callback_status: 'pending', customer_name: 'A' },
            { id: 'b', urgency: 'high', due_by: '2099-01-01T10:00:00Z', callback_status: 'pending', customer_name: 'B' },
            { id: 'c', urgency: 'high', due_by: '2020-01-01T09:00:00Z', callback_status: 'pending', customer_name: 'C' },
            { id: 'd', urgency: 'medium', due_by: null, callback_status: 'pending', customer_name: 'D' },
        ];
        const { status, json } = await runGet({ callRows, bookedCount: 0 });
        expect(status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.leads.map((l: { id: string }) => l.id)).toEqual(['c', 'b', 'd', 'a']);
        expect(json.summary.total).toBe(4);
        expect(json.summary.highUrgency).toBe(2);
        // Only 'c' has a due_by in the past.
        expect(json.summary.dueNow).toBe(1);
        expect(json.leads.every((l: { type: string }) => l.type === 'call')).toBe(true);
    });

    it('merges open action items and maps priority to urgency', async () => {
        const { json } = await runGet({
            callRows: [],
            actionRows: [
                {
                    id: 'act-1', call_analysis_id: null, title: 'Call back customer',
                    description: 'wants a quote', action_type: 'callback', priority: 'high',
                    status: 'pending', customer_name: 'Jane', customer_phone: '+15550001111',
                    rd_ticket_id: 'T-9', created_at: 'now', updated_at: 'now',
                },
            ],
        });
        expect(json.leads).toHaveLength(1);
        const lead = json.leads[0];
        expect(lead.type).toBe('action');
        expect(lead.urgency).toBe('high');
        expect(lead.summary).toBe('Call back customer');
        expect(lead.followUpNotes).toBe('wants a quote');
        expect(lead.actionType).toBe('callback');
        expect(lead.dueBy).toBeNull();
        expect(json.summary.highUrgency).toBe(1);
    });

    it('dedupes action items already represented by a call lead', async () => {
        const { json } = await runGet({
            callRows: [{ id: 'call-1', urgency: 'high', due_by: null, callback_status: 'pending' }],
            actionRows: [
                { id: 'act-linked', call_analysis_id: 'call-1', title: 'dupe', priority: 'high', status: 'pending' },
                { id: 'act-standalone', call_analysis_id: null, title: 'keep', priority: 'medium', status: 'pending' },
            ],
        });
        const ids = json.leads.map((l: { id: string }) => l.id);
        expect(ids).toContain('call-1');
        expect(ids).toContain('act-standalone');
        expect(ids).not.toContain('act-linked');
        expect(json.summary.total).toBe(2);
    });

    it('reports bookedToday from the count query', async () => {
        const { json } = await runGet({ callRows: [], bookedCount: 5 });
        expect(json.summary.bookedToday).toBe(5);
    });

    it('degrades gracefully when the action_items table is missing', async () => {
        const { status, json } = await runGet({
            callRows: [{ id: 'call-1', urgency: 'high', due_by: null, callback_status: 'pending' }],
            actionError: { code: '42P01', message: 'relation "action_items" does not exist' },
        });
        expect(status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.leads).toHaveLength(1);
        expect(json.leads[0].id).toBe('call-1');
    });

    it('returns 500 when the primary call query errors', async () => {
        const { status, json } = await runGet({
            callError: { code: 'XYZ', message: 'boom' },
        });
        expect(status).toBe(500);
        expect(json.error).toBe('Failed to fetch hot leads');
    });
});
