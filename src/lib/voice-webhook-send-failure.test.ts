import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabaseFrom = vi.fn();
const messagesInsertSpy = vi.fn().mockResolvedValue({ error: null });
const followUpUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

vi.mock('@/lib/supabase-server', () => ({
    supabaseAdmin: {
        from: (...args: unknown[]) => mockSupabaseFrom(...args),
    },
}));

vi.mock('@/lib/twilio-validator', () => ({
    validateTwilioRequest: vi.fn().mockResolvedValue(true),
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

vi.mock('@/lib/sms-rate-limit', () => ({
    checkSmsRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/lib/callback-signature', () => ({
    signCallbackParams: vi.fn().mockReturnValue('sig'),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockMessagesCreate = vi.fn();
vi.mock('twilio', () => {
    const twiml = {
        VoiceResponse: class {
            private parts: string[] = [];
            say(_o: unknown, t?: string) { this.parts.push(`<Say>${t || _o}</Say>`); }
            record() { this.parts.push('<Record/>'); }
            hangup() { this.parts.push('<Hangup/>'); }
            toString() { return `<Response>${this.parts.join('')}</Response>`; }
        },
    };
    const twilioFn = () => ({ messages: { create: mockMessagesCreate } });
    twilioFn.twiml = twiml;
    return { default: twilioFn };
});

import { POST } from '@/app/api/webhooks/twilio/voice/route';

function makeRequest(data: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(data)) fd.append(k, v);
    return new Request('https://example.com/api/webhooks/twilio/voice', {
        method: 'POST', body: fd,
    });
}

function chain(value: { data: unknown; error: unknown }) {
    return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(value),
        maybeSingle: vi.fn().mockResolvedValue(value),
        insert: messagesInsertSpy,
        upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'lead-1', follow_up_count: 0 }, error: null }),
            }),
        }),
        update: followUpUpdateSpy,
    };
}

describe('Voice webhook - failed Twilio sends are NOT logged as sent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        messagesInsertSpy.mockClear();
        messagesInsertSpy.mockResolvedValue({ error: null });
        followUpUpdateSpy.mockClear();
        followUpUpdateSpy.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
        process.env.TWILIO_ACCOUNT_SID = 'sid';
        process.env.TWILIO_AUTH_TOKEN = 'tok';
        process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    });

    it('skips outbound message log AND follow-up scheduling when Twilio rejects the auto-reply', async () => {
        // Twilio rejects the auto-reply
        mockMessagesCreate.mockRejectedValue(new Error('Twilio: invalid number'));

        const businessData = {
            id: 'biz-1',
            owner_phone: '+15550001111',
            name: 'Acme',
            business_hours: null,
            timezone: 'America/New_York',
            sms_template: null,
            sms_template_closed: null,
            booking_url: null,
            verification_token: null,
        };

        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return chain({ data: businessData, error: null });
            if (table === 'opt_outs') return chain({ data: null, error: null });
            return chain({ data: null, error: null });
        });

        const res = await POST(makeRequest({ Caller: '5551234567', Called: '5559876543' }));
        expect(res.status).toBe(200);

        // Twilio create was attempted but rejected.
        expect(mockMessagesCreate).toHaveBeenCalled();

        // CRITICAL: outbound message must NOT be inserted into the messages table.
        const messageInserts = messagesInsertSpy.mock.calls.filter(c => {
            const [payload] = c;
            return payload && (payload as Record<string, unknown>).direction === 'outbound';
        });
        expect(messageInserts).toHaveLength(0);

        // CRITICAL: follow_up_due_at must NOT be scheduled.
        const followUpUpdates = followUpUpdateSpy.mock.calls.filter(c => {
            const [payload] = c;
            return payload && 'follow_up_due_at' in (payload as Record<string, unknown>);
        });
        expect(followUpUpdates).toHaveLength(0);
    });

    it('inserts outbound message and schedules follow-up only when Twilio accepts the send', async () => {
        mockMessagesCreate.mockResolvedValue({ sid: 'SM123' });

        const businessData = {
            id: 'biz-1',
            owner_phone: '+15550001111',
            name: 'Acme',
            business_hours: null,
            timezone: 'America/New_York',
            sms_template: null,
            sms_template_closed: null,
            booking_url: null,
            verification_token: null,
        };

        mockSupabaseFrom.mockImplementation((table: string) => {
            if (table === 'businesses') return chain({ data: businessData, error: null });
            if (table === 'opt_outs') return chain({ data: null, error: null });
            return chain({ data: null, error: null });
        });

        const res = await POST(makeRequest({ Caller: '5551234567', Called: '5559876543' }));
        expect(res.status).toBe(200);

        const messageInserts = messagesInsertSpy.mock.calls.filter(c => {
            const [payload] = c;
            return payload && (payload as Record<string, unknown>).direction === 'outbound';
        });
        expect(messageInserts).toHaveLength(1);

        const followUpUpdates = followUpUpdateSpy.mock.calls.filter(c => {
            const [payload] = c;
            return payload && 'follow_up_due_at' in (payload as Record<string, unknown>);
        });
        expect(followUpUpdates).toHaveLength(1);
    });
});
