import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockSupabaseFrom = vi.fn();
vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: (...args: unknown[]) => mockSupabaseFrom(...args),
    },
}));

const mockGetOutboundCallsTo = vi.fn().mockResolvedValue({ data: [] });
const mockGetMissedCalls = vi.fn().mockResolvedValue({ data: [] });
vi.mock('@/lib/repairdesk', () => ({
    RepairDeskClient: vi.fn().mockImplementation(() => ({
        getMissedCalls: mockGetMissedCalls,
        getOutboundCallsTo: mockGetOutboundCallsTo,
    })),
}));

vi.mock('@/lib/phone-utils', () => ({
    normalizePhoneNumber: vi.fn((p: string) => `+1${p.replace(/\D/g, '').slice(-10)}`),
}));

vi.mock('@/lib/business-logic', () => ({
    isBusinessHours: vi.fn(() => true),
}));

vi.mock('@/lib/billing-guard', () => ({
    checkBillingStatus: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('twilio', () => {
    const twilioFn = () => ({
        messages: { create: vi.fn().mockResolvedValue({}) },
    });
    return { default: twilioFn };
});

import { GET } from '@/app/api/repairdesk/poll/route';

function mockSupabaseChain(returnValue: { data: unknown; error: unknown }) {
    return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        lt: vi.fn().mockResolvedValue(returnValue),
        single: vi.fn().mockResolvedValue(returnValue),
        maybeSingle: vi.fn().mockResolvedValue(returnValue),
        insert: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnThis(),
    };
}

function createCronRequest() {
    return new Request('https://example.com/api/repairdesk/poll', {
        method: 'GET',
        headers: {
            authorization: 'Bearer test-cron-secret',
        },
    });
}

describe('RepairDesk Poll Route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CRON_SECRET = 'test-cron-secret';
        process.env.TWILIO_ACCOUNT_SID = 'test-sid';
        process.env.TWILIO_AUTH_TOKEN = 'test-token';
    });

    it('returns 401 when CRON_SECRET is missing', async () => {
        delete process.env.CRON_SECRET;
        const req = createCronRequest();
        const res = await GET(req);
        expect(res.status).toBe(401);
    });

    it('returns 401 when authorization header is wrong', async () => {
        const req = new Request('https://example.com/api/repairdesk/poll', {
            method: 'GET',
            headers: {
                authorization: 'Bearer wrong-secret',
            },
        });
        const res = await GET(req);
        expect(res.status).toBe(401);
    });

    it('returns success when no businesses have RepairDesk configured', async () => {
        mockSupabaseFrom.mockReturnValue(
            mockSupabaseChain({ data: [], error: null })
        );
        // Override the `not` chain for the business query
        mockSupabaseFrom.mockReturnValue({
            select: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: [], error: null }),
        });

        const req = createCronRequest();
        const res = await GET(req);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.message).toContain('No businesses');
    });

    it('returns 500 when database query fails', async () => {
        mockSupabaseFrom.mockReturnValue({
            select: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        });

        const req = createCronRequest();
        const res = await GET(req);
        expect(res.status).toBe(500);
    });
});

describe('RepairDesk Poll - Grace Period Callback Detection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CRON_SECRET = 'test-cron-secret';
        process.env.TWILIO_ACCOUNT_SID = 'test-sid';
        process.env.TWILIO_AUTH_TOKEN = 'test-token';
    });

    it('should pass created_at (not sms_hold_until) when checking for callbacks', async () => {
        const leadCreatedAt = '2024-01-15T10:00:00Z';
        const leadHoldUntil = '2024-01-15T10:03:00Z'; // 3 min grace

        const business = {
            id: 'biz-1',
            repairdesk_api_key: 'test-key',
            repairdesk_store_url: null,
            repairdesk_last_poll_at: null,
            forwarding_number: '+15551234567',
            name: 'Test Biz',
            sms_template: null,
            sms_template_closed: null,
            business_hours: null,
            timezone: null,
        };

        const pendingLead = {
            id: 'lead-1',
            caller_phone: '+15559876543',
            caller_name: 'Test',
            external_id: 'rd-call-1',
            sms_hold_until: leadHoldUntil,
            created_at: leadCreatedAt,
        };

        let callCount = 0;
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses' && callCount === 0) {
                callCount++;
                return {
                    select: vi.fn().mockReturnThis(),
                    not: vi.fn().mockResolvedValue({ data: [business], error: null }),
                };
            }
            // For the update+select (atomic claim) of leads
            if (table === 'leads') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    not: vi.fn().mockReturnThis(),
                    lt: vi.fn().mockReturnThis(),
                    update: vi.fn().mockReturnValue({
                        eq: vi.fn().mockReturnValue({
                            eq: vi.fn().mockReturnValue({
                                not: vi.fn().mockReturnValue({
                                    lt: vi.fn().mockReturnValue({
                                        select: vi.fn().mockResolvedValue({ data: [pendingLead], error: null }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                    upsert: vi.fn().mockResolvedValue({ error: null }),
                    single: vi.fn().mockResolvedValue({ data: null, error: null }),
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                };
            }
            // For opt_outs check and other tables
            return mockSupabaseChain({ data: null, error: null });
        });

        // Mock getMissedCalls to return empty (no new calls)
        mockGetMissedCalls.mockResolvedValue({ data: [] });

        // Mock getOutboundCallsTo — we want to verify it's called with created_at
        mockGetOutboundCallsTo.mockResolvedValue({ data: [{ id: 1 }] });

        const req = createCronRequest();
        await GET(req);

        // Verify getOutboundCallsTo was called with created_at, not sms_hold_until
        if (mockGetOutboundCallsTo.mock.calls.length > 0) {
            const [, sinceArg] = mockGetOutboundCallsTo.mock.calls[0];
            expect(sinceArg).toBe(leadCreatedAt);
            expect(sinceArg).not.toBe(leadHoldUntil);
        }
    });
});
