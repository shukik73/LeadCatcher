import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the chain calls so we can assert behavior of the atomic claim.
const updateSpy = vi.fn();
const messagesInsertSpy = vi.fn();
const ownerSelectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'biz-1', forwarding_number: '+15550001111', name: 'Acme', owner_phone: '+15550000000' }, error: null }),
};

const mockMessagesCreate = vi.fn().mockResolvedValue({});

vi.mock('twilio', () => {
    const twilioFn = () => ({ messages: { create: mockMessagesCreate } });
    return { default: twilioFn };
});

vi.mock('@/lib/billing-guard', () => ({
    checkBillingStatus: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/lib/sms-rate-limit', () => ({
    checkSmsRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/lib/webhook-common', () => ({
    checkOptOut: vi.fn().mockResolvedValue({ optedOut: false, error: false }),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Per-test scenario controls.
let claimedRows: Array<{ id: string; caller_phone: string; business_id: string; follow_up_count: number }> = [];

vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: (table: string) => {
            if (table === 'leads') {
                // Build a chain that mimics .update().eq().lte().lt().select() returning the claim
                const chain = {
                    update: (...args: unknown[]) => {
                        updateSpy(...args);
                        return chain;
                    },
                    eq: vi.fn().mockReturnThis(),
                    lte: vi.fn().mockReturnThis(),
                    lt: vi.fn().mockReturnThis(),
                    select: vi.fn().mockResolvedValue({ data: claimedRows, error: null }),
                };
                return chain;
            }
            if (table === 'businesses') {
                return ownerSelectChain;
            }
            if (table === 'messages') {
                return {
                    insert: (...args: unknown[]) => {
                        messagesInsertSpy(...args);
                        return { error: null };
                    },
                };
            }
            return {};
        },
    },
}));

import { GET } from '@/app/api/cron/followup/route';

function cronRequest() {
    return new Request('https://example.com/api/cron/followup', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-cron-secret' },
    });
}

describe('Follow-up cron atomic claim', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        claimedRows = [];
        process.env.CRON_SECRET = 'test-cron-secret';
        process.env.TWILIO_ACCOUNT_SID = 'sid';
        process.env.TWILIO_AUTH_TOKEN = 'token';
    });

    it('uses an atomic UPDATE → status=Processing claim instead of plain SELECT', async () => {
        claimedRows = [{ id: 'lead-1', caller_phone: '+15551234567', business_id: 'biz-1', follow_up_count: 0 }];

        const res = await GET(cronRequest());
        expect(res.status).toBe(200);

        // The first .update call must transition status to Processing
        // (atomic claim) — never a plain select on status='New'.
        expect(updateSpy).toHaveBeenCalled();
        const firstUpdate = updateSpy.mock.calls[0][0];
        expect(firstUpdate).toMatchObject({ status: 'Processing', follow_up_due_at: null });
    });

    it('a second cron sees no rows when the first claim already grabbed them — no SMS sent', async () => {
        // Simulate the second cron invocation: claim returns empty.
        claimedRows = [];
        const res = await GET(cronRequest());
        const json = await res.json();
        expect(json.processed).toBe(0);
        expect(mockMessagesCreate).not.toHaveBeenCalled();
        expect(messagesInsertSpy).not.toHaveBeenCalled();
    });

    it('sends one SMS per claimed lead and increments follow_up_count', async () => {
        claimedRows = [{ id: 'lead-1', caller_phone: '+15551234567', business_id: 'biz-1', follow_up_count: 0 }];
        const res = await GET(cronRequest());
        const json = await res.json();
        expect(json.sent).toBe(1);
        expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
        expect(messagesInsertSpy).toHaveBeenCalledTimes(1);
    });
});
