import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the upsert payload + onConflict so we can assert behavior.
const upsertSpy = vi.fn().mockResolvedValue({ error: null });

const mockGetMissedCalls = vi.fn();
const mockGetOutboundCallsTo = vi.fn().mockResolvedValue({ data: [] });

vi.mock('@/lib/repairdesk', () => ({
    RepairDeskClient: vi.fn(function () {
        return {
            getMissedCalls: mockGetMissedCalls,
            getOutboundCallsTo: mockGetOutboundCallsTo,
        };
    }),
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

vi.mock('@/lib/sms-rate-limit', () => ({
    checkSmsRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
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

vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: (table: string) => {
            if (table === 'businesses') {
                return {
                    select: vi.fn().mockReturnThis(),
                    not: vi.fn().mockResolvedValue({
                        data: [{
                            id: 'biz-1',
                            repairdesk_api_key: 'k',
                            repairdesk_store_url: null,
                            repairdesk_last_poll_at: null,
                            forwarding_number: '+15550001111',
                            name: 'Acme',
                            sms_template: null,
                            sms_template_closed: null,
                            business_hours: null,
                            timezone: null,
                            booking_url: null,
                        }],
                        error: null,
                    }),
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
                };
            }
            if (table === 'leads') {
                return {
                    upsert: upsertSpy,
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    not: vi.fn().mockReturnThis(),
                    lt: vi.fn().mockReturnThis(),
                    select: vi.fn().mockResolvedValue({ data: [], error: null }),
                };
            }
            return {};
        },
    },
}));

import { GET } from '@/app/api/repairdesk/poll/route';

function cronRequest() {
    return new Request('https://example.com/api/repairdesk/poll', {
        method: 'GET',
        headers: { authorization: 'Bearer test-cron-secret' },
    });
}

describe('RepairDesk poll - repeat caller', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        upsertSpy.mockClear();
        upsertSpy.mockResolvedValue({ error: null });
        process.env.CRON_SECRET = 'test-cron-secret';
        process.env.TWILIO_ACCOUNT_SID = 'sid';
        process.env.TWILIO_AUTH_TOKEN = 'token';
    });

    it('upserts on (business_id, caller_phone) so a new RD call id from a repeat caller does not conflict', async () => {
        // Simulate two missed calls from the same repeat caller with different RD call IDs.
        mockGetMissedCalls.mockResolvedValue({
            data: [
                { id: 1001, phone: '+15559876543', customer_name: 'Jane', created_at: '2024-01-01T10:00:00Z' },
                { id: 1002, phone: '+15559876543', customer_name: 'Jane', created_at: '2024-01-02T10:00:00Z' },
            ],
            meta: { current_page: 1, last_page: 1, per_page: 50, total: 2 },
        });

        const res = await GET(cronRequest());
        expect(res.status).toBe(200);

        // Both upsert calls must use the (business_id, caller_phone) conflict key
        // and ignoreDuplicates: false so the second one updates the row instead of dropping it.
        expect(upsertSpy).toHaveBeenCalledTimes(2);
        for (const call of upsertSpy.mock.calls) {
            const [, options] = call;
            expect(options).toMatchObject({
                onConflict: 'business_id,caller_phone',
                ignoreDuplicates: false,
            });
        }

        // Both upsert payloads must reference the new RD external IDs (no skipping).
        const externalIds = upsertSpy.mock.calls.map(c => c[0].external_id).sort();
        expect(externalIds).toEqual(['rd-call-1001', 'rd-call-1002']);
    });

    it('does not throw if upsert returns an error for one row — keeps processing', async () => {
        mockGetMissedCalls.mockResolvedValue({
            data: [{ id: 999, phone: '+15559876543', customer_name: 'Jane', created_at: '2024-01-01T10:00:00Z' }],
            meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 },
        });
        upsertSpy.mockResolvedValueOnce({ error: { message: 'simulated' } });

        const res = await GET(cronRequest());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
    });
});
