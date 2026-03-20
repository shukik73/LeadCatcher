import crypto from 'crypto';

/**
 * HMAC-based signature for transcription callback URLs.
 * Prevents IDOR attacks by ensuring the businessId/caller/called
 * parameters in the callback URL were genuinely created by our voice webhook.
 *
 * Uses TWILIO_AUTH_TOKEN as the signing key (always available when Twilio is configured).
 */

function getSigningKey(): string {
    const key = process.env.TWILIO_AUTH_TOKEN;
    if (!key) throw new Error('TWILIO_AUTH_TOKEN required for callback signatures');
    return key;
}

/** Sign businessId + caller + called into a hex HMAC. */
export function signCallbackParams(businessId: string, caller: string, called: string): string {
    const payload = `${businessId}:${caller}:${called}`;
    return crypto.createHmac('sha256', getSigningKey()).update(payload).digest('hex');
}

/** Verify the HMAC signature from a transcription callback URL. */
export function verifyCallbackSignature(businessId: string, caller: string, called: string, sig: string): boolean {
    const expected = signCallbackParams(businessId, caller, called);
    if (expected.length !== sig.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
