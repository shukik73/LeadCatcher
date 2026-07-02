import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockSupabaseFrom = vi.fn();
vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: (...args: unknown[]) => mockSupabaseFrom(...args),
    },
}));

vi.mock('@/lib/twilio-validator', () => ({
    validateTwilioRequest: vi.fn(),
}));

vi.mock('@/lib/phone-utils', () => ({
    normalizePhoneNumber: vi.fn((p: string) => `+1${p.replace(/\D/g, '').slice(-10)}`),
}));

vi.mock('@/lib/billing-guard', () => ({
    checkBillingStatus: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/lib/sms-rate-limit', () => ({
    checkSmsRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/lib/lead-qualification', () => ({
    buildOwnerSummary: vi.fn().mockReturnValue(''),
    MAX_QUALIFICATION_QUESTIONS: 3,
}));

vi.mock('@/lib/ai-receptionist', () => ({
    // Default: a reply that doesn't qualify, so the baseline tests don't pick up
    // extra owner-summary traffic.
    generateReceptionistReply: vi.fn().mockResolvedValue({
        reply: '', should_reply: false, qualified: false, extracted: {}, confidence: 'low',
    }),
}));

vi.mock('@/lib/business-hours', () => ({
    summarizeHours: vi.fn().mockReturnValue({ isOpenNow: false, todayLine: '' }),
}));

vi.mock('@/lib/hot-lead-alert', () => ({
    maybeSendHotLeadAlert: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/ai-service', () => ({
    analyzeIntent: vi.fn().mockResolvedValue({
        intent: 'general_inquiry',
        summary: 'General question',
        priority: 'medium',
    }),
}));

const mockMessagesCreate = vi.fn();
vi.mock('twilio', () => {
    const twilioFn = () => ({
        messages: { create: mockMessagesCreate },
    });
    return { default: twilioFn };
});

import { POST } from '@/app/api/webhooks/twilio/sms/route';
import { validateTwilioRequest } from '@/lib/twilio-validator';

function createFormDataRequest(data: Record<string, string>) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
        formData.append(key, value);
    }
    return new Request('https://example.com/api/webhooks/twilio/sms', {
        method: 'POST',
        body: formData,
    });
}

function mockSupabaseChain(returnValue: { data: unknown; error: unknown }) {
    return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(returnValue),
        maybeSingle: vi.fn().mockResolvedValue(returnValue),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        upsert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
    };
}

describe('SMS Webhook Route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.TWILIO_ACCOUNT_SID = 'test-sid';
        process.env.TWILIO_AUTH_TOKEN = 'test-token';
        mockMessagesCreate.mockResolvedValue({});
    });

    it('returns 403 if Twilio signature is invalid', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(false);
        const req = createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'Hello' });
        const res = await POST(req);
        expect(res.status).toBe(403);
    });

    it('returns 400 if From or Body is missing', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const req = createFormDataRequest({ To: '+15559876543' });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it('returns empty TwiML when no business found', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        mockSupabaseFrom.mockReturnValue(
            mockSupabaseChain({ data: null, error: null })
        );
        const req = createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'Hello' });
        const res = await POST(req);
        const text = await res.text();
        expect(text).toBe('<Response></Response>');
    });

    it('handles STOP keyword for opt-out', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const businessData = { id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz' };

        const upsertMock = vi.fn().mockResolvedValue({ error: null });
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            const chain = mockSupabaseChain({ data: null, error: null });
            chain.upsert = upsertMock;
            return chain;
        });

        const req = createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'STOP' });
        const res = await POST(req);
        const text = await res.text();
        expect(text).toBe('<Response></Response>');
        expect(upsertMock).toHaveBeenCalled();
        expect(mockMessagesCreate).toHaveBeenCalledWith(
            expect.objectContaining({ body: expect.stringContaining('unsubscribed') })
        );
    });

    it('fails closed when the opt-out write fails — no false "unsubscribed" confirmation', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const businessData = { id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz' };

        // The opt_outs upsert returns an error (DB blip). We must NOT tell the caller
        // they're unsubscribed, and we must return 500 so Twilio retries the event.
        const upsertMock = vi.fn().mockResolvedValue({ error: { message: 'db down' } });
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            const chain = mockSupabaseChain({ data: null, error: null });
            chain.upsert = upsertMock;
            return chain;
        });

        const req = createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'STOP' });
        const res = await POST(req);

        expect(res.status).toBe(500);
        expect(upsertMock).toHaveBeenCalled();
        // No "unsubscribed" confirmation may go out on a failed persist.
        const confirmation = mockMessagesCreate.mock.calls.find(c =>
            typeof (c[0] as Record<string, string>).body === 'string' &&
            (c[0] as Record<string, string>).body.includes('unsubscribed'),
        );
        expect(confirmation).toBeUndefined();
    });

    it('handles UNSUBSCRIBE keyword for opt-out', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const businessData = { id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz' };

        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });

        const req = createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'UNSUBSCRIBE' });
        const res = await POST(req);
        expect(res.status).toBe(200);
    });

    it('handles START keyword for re-subscription', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const businessData = { id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz' };

        const deleteMock = vi.fn().mockReturnThis();
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            const chain = mockSupabaseChain({ data: null, error: null });
            chain.delete = deleteMock;
            return chain;
        });

        const req = createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'START' });
        const res = await POST(req);
        expect(res.status).toBe(200);
        expect(mockMessagesCreate).toHaveBeenCalledWith(
            expect.objectContaining({ body: expect.stringContaining('resubscribed') })
        );
    });

    it('ignores messages from opted-out users', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const businessData = { id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz' };

        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            if (table === 'opt_outs') return mockSupabaseChain({ data: { id: 'opt-1' }, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });

        const req = createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'Hello there' });
        const res = await POST(req);
        const text = await res.text();
        expect(text).toBe('<Response></Response>');
    });

    it('processes normal message, creates lead and logs message', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const businessData = { id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz' };
        const insertMock = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'new-lead-1' }, error: null }),
            }),
        });

        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            if (table === 'leads') {
                const chain = mockSupabaseChain({ data: null, error: { code: 'PGRST116' } });
                chain.insert = insertMock;
                return chain;
            }
            if (table === 'messages') {
                return mockSupabaseChain({ data: null, error: null });
            }
            return mockSupabaseChain({ data: null, error: null });
        });

        const req = createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'I need help' });
        const res = await POST(req);
        expect(res.status).toBe(200);
    });

    it('ignores a carrier auto-reply bounce — does not notify the owner', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const businessData = { id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz' };

        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            if (table === 'leads') return mockSupabaseChain({ data: { id: 'lead-1' }, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });

        const req = createFormDataRequest({
            From: '+13059307585',
            To: '+15559876543',
            Body: 'Undelivered: SMS to this number is not monitored. Please try calling.',
        });
        const res = await POST(req);
        const text = await res.text();
        expect(text).toBe('<Response></Response>');

        // A carrier bounce is not a real reply — the owner must NOT be pinged.
        const ownerCall = mockMessagesCreate.mock.calls.find(c =>
            (c[0] as Record<string, string>).to === '+15550001111',
        );
        expect(ownerCall).toBeUndefined();
    });

    it('notifies owner when message is received', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const businessData = { id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz' };

        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            if (table === 'leads') return mockSupabaseChain({ data: { id: 'lead-1' }, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });

        const req = createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'Hello' });
        await POST(req);

        // Owner notification should be sent
        expect(mockMessagesCreate).toHaveBeenCalledWith(
            expect.objectContaining({ to: '+15550001111' })
        );
    });
});

describe('SMS Webhook - AI receptionist', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        process.env.TWILIO_ACCOUNT_SID = 'sid';
        process.env.TWILIO_AUTH_TOKEN = 'tok';
        mockMessagesCreate.mockResolvedValue({});
        const recMod = await import('@/lib/ai-receptionist');
        vi.mocked(recMod.generateReceptionistReply).mockResolvedValue({
            reply: '', should_reply: false, qualified: false, extracted: {}, confidence: 'low',
        });
        const qualMod = await import('@/lib/lead-qualification');
        vi.mocked(qualMod.buildOwnerSummary).mockReturnValue('');
    });

    it('answers the customer with the receptionist reply when auto-reply is on', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const recMod = await import('@/lib/ai-receptionist');
        vi.mocked(recMod.generateReceptionistReply).mockResolvedValue({
            reply: 'Yes! We fix PS5 HDMI ports. Swing by 123 Main St — first check is free.',
            should_reply: true,
            qualified: false,
            extracted: { device: 'ps5', issue: 'hdmi' },
            confidence: 'high',
        });

        const businessData = {
            id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz', auto_reply_enabled: true,
            forwarding_number: '+15559876543', address: '123 Main St', services: 'consoles', business_hours: null, timezone: 'America/New_York',
        };
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            if (table === 'leads') return mockSupabaseChain({
                data: { id: 'lead-1', caller_name: null, qualification_status: 'none', qualification_data: {}, qualification_step: 0, qualification_summary_sent_at: null },
                error: null,
            });
            return mockSupabaseChain({ data: null, error: null });
        });

        await POST(createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'do you fix ps5 hdmi?' }));

        // The receptionist's actual answer must go BACK to the customer.
        expect(mockMessagesCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                to: '+15551234567',
                body: expect.stringContaining('PS5 HDMI'),
            }),
        );
    });

    it('still replies when the auto-reply claim errors (degrade open — never go silent)', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const recMod = await import('@/lib/ai-receptionist');
        vi.mocked(recMod.generateReceptionistReply).mockResolvedValue({
            reply: 'Yes, we fix that! Swing by and the first check is free.',
            should_reply: true, qualified: false, extracted: { device: 'ps5' }, confidence: 'high',
        });

        const businessData = {
            id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz', auto_reply_enabled: true,
            forwarding_number: '+15559876543', address: '123 Main St', services: 'consoles', business_hours: null, timezone: 'America/New_York',
        };
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            if (table === 'leads') {
                // Lead lookup (.single) succeeds; the claim (.maybeSingle) errors.
                const chain = mockSupabaseChain({
                    data: { id: 'lead-1', caller_name: null, qualification_status: 'none', qualification_data: {}, qualification_step: 0, qualification_summary_sent_at: null },
                    error: null,
                });
                chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'claim boom' } });
                return chain;
            }
            return mockSupabaseChain({ data: null, error: null });
        });

        await POST(createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'do you fix ps5?' }));

        // The claim failed, but the customer must STILL get an answer.
        expect(mockMessagesCreate).toHaveBeenCalledWith(
            expect.objectContaining({ to: '+15551234567', body: expect.stringContaining('first check is free') }),
        );
    });

    it('does not reply to the customer when auto-reply is off', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);

        const businessData = {
            id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz', auto_reply_enabled: false,
            forwarding_number: '+15559876543', address: null, services: null, business_hours: null, timezone: 'America/New_York',
        };
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            if (table === 'leads') return mockSupabaseChain({
                data: { id: 'lead-1', caller_name: null, qualification_status: 'none', qualification_data: {}, qualification_step: 0, qualification_summary_sent_at: null },
                error: null,
            });
            return mockSupabaseChain({ data: null, error: null });
        });

        await POST(createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'do you fix ps5?' }));

        // No AI reply to the customer; only the raw owner notification fires.
        const customerCall = mockMessagesCreate.mock.calls.find(c =>
            (c[0] as Record<string, string>).to === '+15551234567',
        );
        expect(customerCall).toBeUndefined();
    });

    it('forwards a structured summary to the owner once the lead is qualified', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const recMod = await import('@/lib/ai-receptionist');
        vi.mocked(recMod.generateReceptionistReply).mockResolvedValue({
            reply: 'Great — bring it by and we\'ll take a look!',
            should_reply: true,
            qualified: true,
            extracted: { device: 'iphone', issue: 'screen', urgency: 'medium' },
            confidence: 'high',
        });
        const qualMod = await import('@/lib/lead-qualification');
        vi.mocked(qualMod.buildOwnerSummary).mockReturnValue(
            'New qualified lead (+15551234567) — Device: iphone | Issue: screen | Urgency: medium',
        );

        const businessData = {
            id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz', auto_reply_enabled: true,
            forwarding_number: '+15559876543', address: '123 Main St', services: 'phones', business_hours: null, timezone: 'America/New_York',
        };
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            if (table === 'leads') return mockSupabaseChain({
                data: { id: 'lead-1', caller_name: null, qualification_status: 'in_progress', qualification_data: {}, qualification_step: 2, qualification_summary_sent_at: null },
                error: null,
            });
            return mockSupabaseChain({ data: null, error: null });
        });

        await POST(createFormDataRequest({ From: '+15551234567', To: '+15559876543', Body: 'iphone cracked screen' }));

        // The structured summary must reach the owner.
        const ownerCall = mockMessagesCreate.mock.calls.find(c =>
            (c[0] as Record<string, string>).to === '+15550001111',
        );
        expect(ownerCall).toBeTruthy();
        expect((ownerCall![0] as { body: string }).body).toContain('Device: iphone');
    });
});
