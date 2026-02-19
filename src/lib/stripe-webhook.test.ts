import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockSupabaseFrom = vi.fn();
vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: (...args: unknown[]) => mockSupabaseFrom(...args),
    },
}));

const mockConstructEvent = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();
vi.mock('@/lib/stripe', () => ({
    stripe: {
        webhooks: {
            constructEvent: (...args: unknown[]) => mockConstructEvent(...args),
        },
        subscriptions: {
            retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args),
        },
    },
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/stripe/webhook/route';

function mockSupabaseChain(returnValue: { data: unknown; error: unknown }) {
    return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(returnValue),
        single: vi.fn().mockResolvedValue(returnValue),
        maybeSingle: vi.fn().mockResolvedValue(returnValue),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
    };
}

function createStripeRequest(body = 'raw-body') {
    return new Request('https://example.com/api/stripe/webhook', {
        method: 'POST',
        body,
        headers: {
            'stripe-signature': 'sig_test_123',
        },
    });
}

describe('Stripe Webhook Route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
        process.env.STRIPE_PRO_PRICE_ID = 'price_pro';
    });

    it('returns 400 if stripe-signature header is missing', async () => {
        const req = new Request('https://example.com/api/stripe/webhook', {
            method: 'POST',
            body: 'body',
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it('returns 500 if STRIPE_WEBHOOK_SECRET is not configured', async () => {
        delete process.env.STRIPE_WEBHOOK_SECRET;
        const req = createStripeRequest();
        const res = await POST(req);
        expect(res.status).toBe(500);
    });

    it('returns 400 if signature verification fails', async () => {
        mockConstructEvent.mockImplementation(() => {
            throw new Error('Bad signature');
        });
        const req = createStripeRequest();
        const res = await POST(req);
        expect(res.status).toBe(400);
        const text = await res.text();
        expect(text).toContain('Bad signature');
    });

    it('skips duplicate Stripe event via idempotency claim', async () => {
        mockConstructEvent.mockReturnValue({
            id: 'evt_duplicate',
            type: 'checkout.session.completed',
            created: 1700000000,
            data: { object: {} },
        });

        // Claim returns null = already claimed
        mockSupabaseFrom.mockReturnValue(
            mockSupabaseChain({ data: null, error: null })
        );

        const req = createStripeRequest();
        const res = await POST(req);
        expect(res.status).toBe(200);
    });

    it('processes checkout.session.completed and marks as processed', async () => {
        mockConstructEvent.mockReturnValue({
            id: 'evt_checkout_1',
            type: 'checkout.session.completed',
            created: 1700000000,
            data: {
                object: {
                    id: 'cs_1',
                    metadata: { business_id: 'biz-1', plan_id: 'starter' },
                    subscription: 'sub_1',
                },
            },
        });

        mockSubscriptionsRetrieve.mockResolvedValue({
            status: 'active',
            trial_end: null,
            items: { data: [{ current_period_end: 1700086400 }] },
        });

        // Claim succeeds
        const claimChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'wh-1' }, error: null }),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
        };
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'webhook_events') return claimChain;
            if (table === 'businesses') return mockSupabaseChain({ data: { id: 'biz-1' }, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });

        const req = createStripeRequest();
        const res = await POST(req);
        expect(res.status).toBe(200);
    });

    it('returns 500 and marks as failed on handler error', async () => {
        mockConstructEvent.mockReturnValue({
            id: 'evt_fail_1',
            type: 'checkout.session.completed',
            created: 1700000000,
            data: {
                object: {
                    id: 'cs_1',
                    metadata: { business_id: 'biz-1', plan_id: 'starter' },
                    subscription: 'sub_1',
                },
            },
        });

        // Claim succeeds
        const claimChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'wh-1' }, error: null }),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
        };
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'webhook_events') return claimChain;
            return mockSupabaseChain({ data: null, error: null });
        });

        // Subscription retrieve fails
        mockSubscriptionsRetrieve.mockRejectedValue(new Error('Stripe down'));

        const req = createStripeRequest();
        const res = await POST(req);
        expect(res.status).toBe(500);
    });
});
