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

vi.mock('@/lib/business-logic', () => ({
    isBusinessHours: vi.fn(() => true),
}));

vi.mock('@/lib/billing-guard', () => ({
    checkBillingStatus: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockMessagesCreate = vi.fn();
vi.mock('twilio', () => {
    const twiml = {
        VoiceResponse: class {
            private parts: string[] = [];
            say(optionsOrText: unknown, text?: string) {
                this.parts.push(`<Say>${text || optionsOrText}</Say>`);
            }
            record() {
                this.parts.push('<Record/>');
            }
            hangup() {
                this.parts.push('<Hangup/>');
            }
            toString() {
                return `<Response>${this.parts.join('')}</Response>`;
            }
        },
    };
    const twilioFn = () => ({
        messages: { create: mockMessagesCreate },
    });
    twilioFn.twiml = twiml;
    return { default: twilioFn };
});

import { POST } from '@/app/api/webhooks/twilio/voice/route';
import { validateTwilioRequest } from '@/lib/twilio-validator';

function createFormDataRequest(data: Record<string, string>) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
        formData.append(key, value);
    }
    return new Request('https://example.com/api/webhooks/twilio/voice', {
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
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
    };
}

describe('Voice Webhook Route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.TWILIO_ACCOUNT_SID = 'test-sid';
        process.env.TWILIO_AUTH_TOKEN = 'test-token';
        process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
        mockMessagesCreate.mockResolvedValue({});
    });

    it('returns 403 if Twilio signature is invalid', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(false);
        const req = createFormDataRequest({ Caller: '+15551234567', Called: '+15559876543' });
        const res = await POST(req);
        expect(res.status).toBe(403);
    });

    it('returns 400 if no caller in form data', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const req = createFormDataRequest({ Called: '+15559876543' });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it('returns error TwiML when no business is found', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        mockSupabaseFrom.mockReturnValue(
            mockSupabaseChain({ data: null, error: { message: 'not found' } })
        );
        const req = createFormDataRequest({ Caller: '+15551234567', Called: '+15559876543' });
        const res = await POST(req);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('not configured correctly');
        expect(res.headers.get('Content-Type')).toBe('text/xml');
    });

    it('sends SMS and returns recording TwiML on valid call', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const businessData = {
            id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz',
            business_hours: null, timezone: 'America/New_York', sms_template: null, verification_token: null,
        };
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });
        const req = createFormDataRequest({ Caller: '5551234567', Called: '5559876543' });
        const res = await POST(req);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Test Biz');
        expect(text).toContain('<Record/>');
        expect(mockMessagesCreate).toHaveBeenCalled();
    });

    it('skips SMS when user is opted out', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const businessData = {
            id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz',
            business_hours: null, timezone: 'America/New_York', sms_template: null, verification_token: null,
        };
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            if (table === 'opt_outs') return mockSupabaseChain({ data: { id: 'opt-1' }, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });
        const req = createFormDataRequest({ Caller: '5551234567', Called: '5559876543' });
        await POST(req);
        expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('returns error TwiML when NEXT_PUBLIC_APP_URL is missing', async () => {
        delete process.env.NEXT_PUBLIC_APP_URL;
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);
        const businessData = {
            id: 'biz-1', owner_phone: '+15550001111', name: 'Test Biz',
            business_hours: null, timezone: 'America/New_York', sms_template: null, verification_token: null,
        };
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return mockSupabaseChain({ data: businessData, error: null });
            if (table === 'opt_outs') return mockSupabaseChain({ data: null, error: null });
            return mockSupabaseChain({ data: null, error: null });
        });
        const req = createFormDataRequest({ Caller: '5551234567', Called: '5559876543' });
        const res = await POST(req);
        const text = await res.text();
        expect(text).toContain('technical difficulties');
    });

    it('skips duplicate CallSid via atomic claim (idempotency)', async () => {
        vi.mocked(validateTwilioRequest).mockResolvedValue(true);

        // Simulate the atomic claim returning null (duplicate — already claimed)
        const webhookChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
        };
        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'webhook_events') return webhookChain;
            return mockSupabaseChain({ data: null, error: null });
        });

        const req = createFormDataRequest({
            CallSid: 'CA123duplicate',
            Caller: '+15551234567',
            Called: '+15559876543',
        });
        const res = await POST(req);
        const text = await res.text();
        expect(text).toContain('Hangup');
        expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
});
