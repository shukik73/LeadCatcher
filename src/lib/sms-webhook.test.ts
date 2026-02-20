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
        upsert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
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
