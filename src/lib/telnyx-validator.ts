import crypto from 'crypto';
import { logger } from '@/lib/logger';

/**
 * Validates Telnyx webhook signatures using ed25519.
 *
 * Telnyx signs each webhook with:
 *   - Header `telnyx-signature-ed25519`: base64-encoded ed25519 signature
 *   - Header `telnyx-timestamp`: Unix timestamp string
 *
 * The signed payload is: `${timestamp}|${rawBody}`
 */
export async function validateTelnyxRequest(
    request: Request,
): Promise<{ valid: boolean; body: string }> {
    const publicKeyHex = process.env.TELNYX_PUBLIC_KEY;
    if (!publicKeyHex) {
        logger.error('TELNYX_PUBLIC_KEY environment variable is not set', null);
        return { valid: false, body: '' };
    }

    const signature = request.headers.get('telnyx-signature-ed25519');
    const timestamp = request.headers.get('telnyx-timestamp');

    if (!signature || !timestamp) {
        logger.warn('Missing Telnyx signature or timestamp header');
        return { valid: false, body: '' };
    }

    // Reject timestamps older than 5 minutes to prevent replay attacks
    const timestampAge = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (timestampAge > 300) {
        logger.warn('Telnyx webhook timestamp too old', { timestampAge });
        return { valid: false, body: '' };
    }

    const rawBody = await request.text();
    const signedPayload = `${timestamp}|${rawBody}`;

    try {
        const publicKey = crypto.createPublicKey({
            key: Buffer.from(publicKeyHex, 'hex'),
            format: 'der',
            type: 'spki',
        });

        const isValid = crypto.verify(
            null, // ed25519 doesn't use a separate hash algorithm
            Buffer.from(signedPayload),
            publicKey,
            Buffer.from(signature, 'base64'),
        );

        if (!isValid) {
            logger.warn('Invalid Telnyx webhook signature');
        }

        return { valid: isValid, body: rawBody };
    } catch (error) {
        logger.error('Telnyx signature verification error', error);
        return { valid: false, body: '' };
    }
}
