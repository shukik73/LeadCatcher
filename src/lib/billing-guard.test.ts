import { describe, it, expect, vi, beforeEach } from 'vitest';

const singleSpy = vi.fn();

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: () => ({
            select: () => ({
                eq: () => ({
                    single: singleSpy,
                }),
            }),
        }),
    },
}));

import { checkBillingStatus } from '@/lib/billing-guard';

const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

describe('checkBillingStatus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('allows an internal (billing_exempt) business even with no subscription and expired grace', async () => {
        singleSpy.mockResolvedValue({
            data: { billing_exempt: true, stripe_status: null, stripe_trial_ends_at: null, created_at: longAgo },
            error: null,
        });
        const result = await checkBillingStatus('biz-internal');
        expect(result.allowed).toBe(true);
    });

    it('still blocks a non-exempt business whose trial expired', async () => {
        singleSpy.mockResolvedValue({
            data: { billing_exempt: false, stripe_status: 'trialing', stripe_trial_ends_at: longAgo, created_at: longAgo },
            error: null,
        });
        const result = await checkBillingStatus('biz-expired');
        expect(result.allowed).toBe(false);
    });

    it('still allows a non-exempt business with an active subscription', async () => {
        singleSpy.mockResolvedValue({
            data: { billing_exempt: false, stripe_status: 'active', stripe_trial_ends_at: null, created_at: longAgo },
            error: null,
        });
        const result = await checkBillingStatus('biz-active');
        expect(result.allowed).toBe(true);
    });
});
