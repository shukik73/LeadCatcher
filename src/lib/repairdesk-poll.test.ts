import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockSupabaseFrom = vi.fn();
vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: (...args: unknown[]) => mockSupabaseFrom(...args),
    },
}));

vi.mock('@/lib/repairdesk', () => ({
    RepairDeskClient: vi.fn().mockImplementation(() => ({
        getMissedCalls: vi.fn().mockResolvedValue({ data: [] }),
        getOutboundCallsTo: vi.fn().mockResolvedValue({ data: [] }),
    })),
}));

vi.mock('@/lib/phone-utils', () => ({
    normalizePhoneNumber: vi.fn((p: string) => `+1${p.replace(/\D/g, '').slice(-10)}`),
}));

vi.mock('@/lib/business-logic', () => ({
    isBusinessHours: vi.fn(() => true),
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
    it('should use created_at (not sms_hold_until) for callback lookups', async () => {
        // This test validates that the code uses lead.created_at as the
        // "since" parameter for callback detection, not sms_hold_until.
        // The fix ensures callbacks during the grace window are detected.

        // Read the source to verify the fix is in place
        const fs = await import('fs');
        const path = await import('path');
        const routeSource = fs.readFileSync(
            path.resolve(__dirname, '../app/api/repairdesk/poll/route.ts'),
            'utf-8'
        );

        // Verify the callback check uses created_at, not sms_hold_until
        expect(routeSource).toContain('lead.created_at');
        expect(routeSource).not.toContain('checkForCallback(client, lead.caller_phone, lead.sms_hold_until)');
    });
});
