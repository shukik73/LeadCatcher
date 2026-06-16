import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Pure decision logic: should we ping the owner to call this lead? ----
import { shouldAlertOwner } from '@/lib/owner-no-reply-alert';

const NOW = new Date('2026-06-16T18:00:00Z');
const fortyMinAgo = new Date(NOW.getTime() - 40 * 60 * 1000).toISOString();
const fiveMinAgo = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();

const base = {
    status: 'Contacted',
    ownerAlertedAt: null as string | null,
    ownerPhone: '+15613344650',
    forwardingNumber: '+17545294518',
    lastOutboundAt: fortyMinAgo as string | null,
    inboundExists: false,
    now: NOW,
    thresholdMinutes: 30,
};

describe('shouldAlertOwner', () => {
    it('alerts when we texted, no reply, and the threshold has passed', () => {
        expect(shouldAlertOwner(base)).toBe(true);
    });

    it('does not alert when the customer already replied', () => {
        expect(shouldAlertOwner({ ...base, inboundExists: true })).toBe(false);
    });

    it('does not alert before the threshold has elapsed', () => {
        expect(shouldAlertOwner({ ...base, lastOutboundAt: fiveMinAgo })).toBe(false);
    });

    it('does not alert twice (owner already alerted)', () => {
        expect(shouldAlertOwner({ ...base, ownerAlertedAt: fiveMinAgo })).toBe(false);
    });

    it('does not alert when the business has no owner phone', () => {
        expect(shouldAlertOwner({ ...base, ownerPhone: null })).toBe(false);
    });

    it('does not alert when the lead was never texted (status still New)', () => {
        expect(shouldAlertOwner({ ...base, status: 'New', lastOutboundAt: null })).toBe(false);
    });
});

// ---- Send helper: atomic claim + billing + rate limit + Twilio ----
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

import { sendOwnerNoReplyAlert } from '@/lib/owner-no-reply-alert';

const sendBase = {
    leadId: 'lead-1',
    businessId: 'biz-1',
    ownerPhone: '+15613344650',
    forwardingNumber: '+17545294518',
    callerPhone: '+19545551234',
    callerName: 'King Everett',
};

describe('sendOwnerNoReplyAlert', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        claimSpy.mockResolvedValue({ data: [{ id: 'lead-1' }], error: null });
        mockMessagesCreate.mockResolvedValue({});
    });

    it('texts the owner once with the caller name and number', async () => {
        const sent = await sendOwnerNoReplyAlert(sendBase);
        expect(sent).toBe(true);
        expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
        const call = mockMessagesCreate.mock.calls[0][0];
        expect(call.to).toBe('+15613344650');
        expect(call.from).toBe('+17545294518');
        expect(call.body).toContain('King Everett');
        expect(call.body).toContain('+19545551234');
    });

    it('dedupes — if the claim is already taken, does not re-send', async () => {
        claimSpy.mockResolvedValue({ data: [], error: null });
        const sent = await sendOwnerNoReplyAlert(sendBase);
        expect(sent).toBe(true);
        expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
});
