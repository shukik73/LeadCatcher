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

vi.mock('@/lib/ai-service', () => ({
    analyzeIntent: vi.fn().mockResolvedValue({
        intent: 'booking_request',
        summary: 'Wants to book an appointment',
        suggestedReply: 'We can schedule you for tomorrow.',
        priority: 'high',
    }),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockMessagesCreate = vi.fn();
vi.mock('twilio', () => {
    const twilioFn = () => ({
        messages: { create: mockMessagesCreate },
    });
    return { default: twilioFn };
});

import { POST } from '@/app/api/webhooks/twilio/transcription/route';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { analyzeIntent } from '@/lib/ai-service';

function createFormDataRequest(
    data: Record<string, string>,
    params: Record<string, string> = {}
) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
        formData.append(key, value);
    }
    const url = new URL('https://example.com/api/webhooks/twilio/transcription');
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return new Request(url.toString(), { method: 'POST', body: formData });
}

function mockSupabaseChain(returnValue: { data: unknown; error: unknown }) {
    return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(returnValue),
        maybeSingle: vi.fn().mockResolvedValue(returnValue),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnThis(),
    };
}

describe('Transcription Webhook Route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.TWILIO_ACCOUNT_SID = 'test-sid';
        process.env.TWILIO_AUTH_TOKEN = 'test-token';
        mockMessagesCreate.mockResolvedValue({});
    });

    it('returns 403 if Twilio signature is invalid', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(false);
        const req = createFormDataRequest(
            { TranscriptionText: 'Hello', TranscriptionStatus: 'completed' },
            { businessId: 'biz-1', caller: '+15551234567', called: '+15559876543' }
        );
        const res = await POST(req);
        expect(res.status).toBe(403);
    });

    it('returns 400 if required params are missing', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const req = createFormDataRequest(
            { TranscriptionText: 'Hello', TranscriptionStatus: 'completed' },
            {} // no businessId, caller, called
        );
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it('returns OK without processing if transcription not completed', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const req = createFormDataRequest(
            { TranscriptionText: '', TranscriptionStatus: 'failed' },
            { businessId: 'biz-1', caller: '+15551234567', called: '+15559876543' }
        );
        const res = await POST(req);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('OK');
        expect(vi.mocked(analyzeIntent)).not.toHaveBeenCalled();
    });

    it('analyzes transcription and updates lead', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);

        const updateMock = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
        });

        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'leads') {
                const chain = mockSupabaseChain({ data: { id: 'lead-1' }, error: null });
                chain.update = updateMock;
                return chain;
            }
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            if (table === 'businesses') return mockSupabaseChain({ data: { owner_phone: '+15550001111' }, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });

        const req = createFormDataRequest(
            { TranscriptionText: 'I want to book an appointment', TranscriptionStatus: 'completed' },
            { businessId: 'biz-1', caller: '+15551234567', called: '+15559876543' }
        );
        const res = await POST(req);
        expect(res.status).toBe(200);
        expect(vi.mocked(analyzeIntent)).toHaveBeenCalledWith(
            'I want to book an appointment',
            'Voicemail Transcript'
        );
    });

    it('sends smart reply SMS when not opted out', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);

        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'leads') {
                const chain = mockSupabaseChain({ data: { id: 'lead-1' }, error: null });
                chain.update = vi.fn().mockReturnValue({
                    eq: vi.fn().mockResolvedValue({ error: null }),
                });
                return chain;
            }
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            if (table === 'businesses') return mockSupabaseChain({ data: { owner_phone: '+15550001111' }, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });

        const req = createFormDataRequest(
            { TranscriptionText: 'Book me in', TranscriptionStatus: 'completed' },
            { businessId: 'biz-1', caller: '+15551234567', called: '+15559876543' }
        );
        await POST(req);

        // Smart reply + owner notification = 2 calls
        expect(mockMessagesCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                to: '+15551234567',
                body: 'We can schedule you for tomorrow.',
            })
        );
    });

    it('skips smart reply when user is opted out', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);

        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'leads') {
                const chain = mockSupabaseChain({ data: { id: 'lead-1' }, error: null });
                chain.update = vi.fn().mockReturnValue({
                    eq: vi.fn().mockResolvedValue({ error: null }),
                });
                return chain;
            }
            if (table === 'opt_outs') return mockSupabaseChain({ data: { id: 'opt-1' }, error: null });
            if (table === 'businesses') return mockSupabaseChain({ data: { owner_phone: '+15550001111' }, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });

        const req = createFormDataRequest(
            { TranscriptionText: 'Book me in', TranscriptionStatus: 'completed' },
            { businessId: 'biz-1', caller: '+15551234567', called: '+15559876543' }
        );
        await POST(req);

        // Should only send owner notification, not smart reply to opted-out user
        const callerCalls = mockMessagesCreate.mock.calls.filter(
            (call: unknown[]) => (call[0] as { to: string }).to === '+15551234567'
        );
        expect(callerCalls).toHaveLength(0);
    });

    it('notifies owner with voicemail summary', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);

        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'leads') {
                const chain = mockSupabaseChain({ data: { id: 'lead-1' }, error: null });
                chain.update = vi.fn().mockReturnValue({
                    eq: vi.fn().mockResolvedValue({ error: null }),
                });
                return chain;
            }
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            if (table === 'businesses') return mockSupabaseChain({ data: { owner_phone: '+15550001111' }, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });

        const req = createFormDataRequest(
            { TranscriptionText: 'I want to book', TranscriptionStatus: 'completed' },
            { businessId: 'biz-1', caller: '+15551234567', called: '+15559876543' }
        );
        await POST(req);

        expect(mockMessagesCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                to: '+15550001111',
                body: expect.stringContaining('Voicemail'),
            })
        );
    });
});
