import twilio from 'twilio';
import { validateTwilioRequest } from '@/lib/twilio-validator';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * TwiML webhook for verification calls.
 * This is invoked when the user answers the verification call.
 * Plays a brief message and hangs up.
 */
export async function POST(request: Request) {
    // Validate Twilio signature
    const isValid = await validateTwilioRequest(request);
    if (!isValid) {
        logger.warn('[Verify Webhook] Invalid Twilio signature - rejecting request');
        return new Response('Unauthorized', { status: 403 });
    }

    const response = new twilio.twiml.VoiceResponse();
    response.say(
        { voice: 'alice' },
        'This is a verification call from LeadCatcher. Your phone is working correctly. You may hang up now.'
    );
    response.pause({ length: 2 });
    response.hangup();

    return new Response(response.toString(), {
        headers: { 'Content-Type': 'text/xml' }
    });
}
