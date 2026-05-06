import { describe, it, expect, vi, beforeEach } from 'vitest';

const reviewExistingMaybe = vi.fn();
const reviewInsertSpy = vi.fn();
const optOutMaybe = vi.fn();

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
        from: (table: string) => {
            if (table === 'review_requests') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    maybeSingle: reviewExistingMaybe,
                    insert: reviewInsertSpy,
                };
            }
            if (table === 'opt_outs') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    maybeSingle: optOutMaybe,
                };
            }
            return {};
        },
    },
}));

import { sendReviewRequest } from '@/lib/review-request';
import { checkBillingStatus } from '@/lib/billing-guard';
import { checkSmsRateLimit } from '@/lib/sms-rate-limit';

const baseOpts = {
    businessId: 'biz-1',
    businessName: 'Acme',
    forwardingNumber: '+15550001111',
    googleReviewLink: 'https://g.page/r/acme',
    customerPhone: '+15559876543',
    customerName: 'Jane',
    ticketId: 42,
};

describe('sendReviewRequest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        reviewExistingMaybe.mockResolvedValue({ data: null, error: null });
        reviewInsertSpy.mockResolvedValue({ error: null });
        optOutMaybe.mockResolvedValue({ data: null, error: null });
        mockMessagesCreate.mockResolvedValue({});
        vi.mocked(checkBillingStatus).mockResolvedValue({ allowed: true });
        vi.mocked(checkSmsRateLimit).mockResolvedValue({ allowed: true });
    });

    it('sends one SMS and inserts a review_requests row when nothing blocks it', async () => {
        const sent = await sendReviewRequest(baseOpts);
        expect(sent).toBe(true);
        expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
        const sentCall = mockMessagesCreate.mock.calls[0][0];
        expect(sentCall.body).toContain('Acme');
        expect(sentCall.body).toContain('https://g.page/r/acme');
        expect(reviewInsertSpy).toHaveBeenCalledTimes(1);
    });

    it('dedupes — does NOT send a second time for the same ticket', async () => {
        reviewExistingMaybe.mockResolvedValue({ data: { id: 'existing' }, error: null });
        const sent = await sendReviewRequest(baseOpts);
        expect(sent).toBe(false);
        expect(mockMessagesCreate).not.toHaveBeenCalled();
        expect(reviewInsertSpy).not.toHaveBeenCalled();
    });

    it('skips when customer has opted out', async () => {
        optOutMaybe.mockResolvedValue({ data: { id: 'opt-1' }, error: null });
        const sent = await sendReviewRequest(baseOpts);
        expect(sent).toBe(false);
        expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('skips when billing is inactive', async () => {
        vi.mocked(checkBillingStatus).mockResolvedValue({ allowed: false, reason: 'inactive' });
        const sent = await sendReviewRequest(baseOpts);
        expect(sent).toBe(false);
        expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('skips when there is no google_review_link configured', async () => {
        const sent = await sendReviewRequest({ ...baseOpts, googleReviewLink: null });
        expect(sent).toBe(false);
        expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('skips when SMS rate limit is hit', async () => {
        vi.mocked(checkSmsRateLimit).mockResolvedValue({ allowed: false, reason: 'rate' });
        const sent = await sendReviewRequest(baseOpts);
        expect(sent).toBe(false);
        expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
});
