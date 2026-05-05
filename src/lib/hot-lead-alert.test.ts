import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimSpy = vi.fn();

vi.mock('@/lib/billing-guard', () => ({
    checkBillingStatus: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/lib/sms-rate-limit', () => ({
    checkSmsRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockMessagesCreate = vi.fn();
vi.mock('twilio', () => {
    const twilioFn = () => ({ messages: { create: mockMessagesCreate } });
    return { default: twilioFn };
});

vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: () => ({
            update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    is: vi.fn().mockReturnValue({
                        select: claimSpy,
                    }),
                }),
            }),
        }),
    },
}));

import { maybeSendHotLeadAlert } from '@/lib/hot-lead-alert';

const base = {
    leadId: 'lead-1',
    businessId: 'biz-1',
    ownerPhone: '+15550000000',
    forwardingNumber: '+15550001111',
    summary: 'New high-urgency lead',
    urgency: 'high' as const,
};

describe('maybeSendHotLeadAlert', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        claimSpy.mockResolvedValue({ data: [{ id: 'lead-1' }], error: null });
        mockMessagesCreate.mockResolvedValue({});
    });

    it('does nothing when urgency is not high', async () => {
        const sent = await maybeSendHotLeadAlert({ ...base, urgency: 'low' });
        expect(sent).toBe(false);
        expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('sends owner SMS once when urgency is high', async () => {
        const sent = await maybeSendHotLeadAlert(base);
        expect(sent).toBe(true);
        expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
        const call = mockMessagesCreate.mock.calls[0][0];
        expect(call.to).toBe('+15550000000');
        expect(call.body).toContain('HOT LEAD');
        expect(call.body).toContain('New high-urgency');
    });

    it('dedupes — second call with same lead returns true but does not re-send', async () => {
        // Simulate the atomic claim returning empty (already claimed earlier).
        claimSpy.mockResolvedValue({ data: [], error: null });
        const sent = await maybeSendHotLeadAlert(base);
        expect(sent).toBe(true); // already-sent path returns true (idempotent)
        expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('returns false when owner phone is missing', async () => {
        const sent = await maybeSendHotLeadAlert({ ...base, ownerPhone: null });
        expect(sent).toBe(false);
        expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
});
