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

describe('GET /api/hot-leads (route handler)', () => {
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

    it('returns merged call + action-item leads with a sourceType discriminator', async () => {
        const callRows = [
            {
                id: 'call-1', source_call_id: 'CA-1', urgency: 'low', due_by: '2099-01-01T10:00:00Z',
                callback_status: 'pending', customer_name: 'Caller', customer_phone: '+1',
                summary: 'call summary', follow_up_notes: null, coaching_note: null,
                rd_ticket_id: null, created_at: '2026-06-08T08:00:00Z', updated_at: '2026-06-08T08:00:00Z',
            },
        ];
        const actionRows = [
            {
                id: 'act-1', call_analysis_id: null, title: 'Send quote', description: 'iPhone screen',
                action_type: 'quote_needed', priority: 'high', status: 'pending',
                customer_name: 'Jane', customer_phone: '+2', rd_ticket_id: 'RD-9',
                created_at: '2026-06-08T09:00:00Z', updated_at: '2026-06-08T09:00:00Z',
            },
        ];
        const { status, json } = await runGet({ callRows, actionRows, bookedCount: 0 });
        expect(status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.summary.total).toBe(2);
        expect(json.summary.highUrgency).toBe(1);
        // High-urgency action item sorts ahead of the low-urgency call.
        expect(json.leads.map((l: { id: string }) => l.id)).toEqual(['act-1', 'call-1']);
        expect(json.leads[0]).toMatchObject({
            sourceType: 'action_item',
            urgency: 'high',
            summary: 'Send quote',
            followUpNotes: 'iPhone screen',
        });
        expect(json.leads[1].sourceType).toBe('call_analysis');
    });

    it('includes action items linked to a call, annotated with the linked call id', async () => {
        const { json } = await runGet({
            callRows: [],
            actionRows: [
                { id: 'act-linked', call_analysis_id: 'call-7', title: 'Follow up', priority: 'medium', status: 'pending' },
            ],
        });
        expect(json.summary.total).toBe(1);
        expect(json.leads[0]).toMatchObject({
            id: 'act-linked',
            sourceType: 'action_item',
            sourceCallId: 'call-7',
            coachingNote: 'Linked call: call-7',
        });
    });

    it('reports bookedToday from the count query', async () => {
        const { json } = await runGet({ callRows: [], bookedCount: 5 });
        expect(json.summary.bookedToday).toBe(5);
    });

    it('returns 500 when the primary call query errors', async () => {
        const { status, json } = await runGet({ callError: { code: 'XYZ', message: 'boom' } });
        expect(status).toBe(500);
        expect(json.error).toBe('Failed to fetch hot leads');
    });

    it('returns 500 when the action-items query errors', async () => {
        const { status, json } = await runGet({
            callRows: [{ id: 'call-1', urgency: 'high', due_by: null, callback_status: 'pending' }],
            actionError: { code: '42P01', message: 'relation "action_items" does not exist' },
        });
        expect(status).toBe(500);
        expect(json.error).toBe('Failed to fetch hot leads');
    });
});
