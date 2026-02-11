import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock next/headers
const mockGet = vi.fn();
vi.mock('next/headers', () => ({
    headers: vi.fn().mockResolvedValue({
        get: (name: string) => mockGet(name),
    }),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock twilio's validateRequest
const mockValidateRequest = vi.fn();
vi.mock('twilio', () => ({
    validateRequest: (...args: unknown[]) => mockValidateRequest(...args),
}));

import { validateTwilioRequest } from './twilio-validator';
import { logger } from '@/lib/logger';

function createMockRequest(body: Record<string, string>, url = 'https://example.com/api/webhooks/twilio/sms') {
    const formData = new FormData();
    for (const [key, value] of Object.entries(body)) {
        formData.append(key, value);
    }
    return new Request(url, { method: 'POST', body: formData });
}

describe('validateTwilioRequest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    });

    it('returns false and logs warning when signature header is missing', async () => {
        mockGet.mockReturnValue(null);

        const req = createMockRequest({ Body: 'Hello' });
        const result = await validateTwilioRequest(req);

        expect(result).toBe(false);
        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith('Missing X-Twilio-Signature header');
    });

    it('calls twilio validateRequest with correct params when signature is present', async () => {
        mockGet.mockReturnValue('valid-signature');
        mockValidateRequest.mockReturnValue(true);

        const req = createMockRequest({ Body: 'Hello', From: '+15551234567' });
        const result = await validateTwilioRequest(req);

        expect(result).toBe(true);
        expect(mockValidateRequest).toHaveBeenCalledWith(
            'test-auth-token',
            'valid-signature',
            expect.any(String),
            expect.objectContaining({ Body: 'Hello', From: '+15551234567' })
        );
    });

    it('returns false when twilio validateRequest rejects signature', async () => {
        mockGet.mockReturnValue('invalid-signature');
        mockValidateRequest.mockReturnValue(false);

        const req = createMockRequest({ Body: 'Hello' });
        const result = await validateTwilioRequest(req);

        expect(result).toBe(false);
    });

    it('uses TWILIO_WEBHOOK_URL env var when set', async () => {
        process.env.TWILIO_WEBHOOK_URL = 'https://production.example.com/api/webhooks/twilio/sms';
        mockGet.mockReturnValue('some-signature');
        mockValidateRequest.mockReturnValue(true);

        const req = createMockRequest({ Body: 'Hello' }, 'https://localhost:3000/api/webhooks/twilio/sms');
        await validateTwilioRequest(req);

        // Should use env var URL, not the request URL
        expect(mockValidateRequest).toHaveBeenCalledWith(
            'test-auth-token',
            'some-signature',
            'https://production.example.com/api/webhooks/twilio/sms',
            expect.any(Object)
        );

        delete process.env.TWILIO_WEBHOOK_URL;
    });

    it('falls back to request URL when TWILIO_WEBHOOK_URL is not set', async () => {
        delete process.env.TWILIO_WEBHOOK_URL;
        mockGet.mockReturnValue('some-signature');
        mockValidateRequest.mockReturnValue(true);

        const reqUrl = 'https://example.com/api/webhooks/twilio/sms';
        const req = createMockRequest({ Body: 'Hello' }, reqUrl);
        await validateTwilioRequest(req);

        expect(mockValidateRequest).toHaveBeenCalledWith(
            'test-auth-token',
            'some-signature',
            reqUrl,
            expect.any(Object)
        );
    });

    it('parses form data params correctly for signature validation', async () => {
        mockGet.mockReturnValue('valid-signature');
        mockValidateRequest.mockReturnValue(true);

        const req = createMockRequest({
            CallSid: 'CA123',
            From: '+15551234567',
            To: '+15559876543',
            Body: 'Test message',
        });
        await validateTwilioRequest(req);

        expect(mockValidateRequest).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            expect.any(String),
            {
                CallSid: 'CA123',
                From: '+15551234567',
                To: '+15559876543',
                Body: 'Test message',
            }
        );
    });
});
