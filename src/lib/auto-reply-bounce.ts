/**
 * Detect carrier / device auto-replies that are NOT a real customer reply.
 *
 * When LeadCatcher texts a number that can't receive SMS (landline, spam
 * dialer, "text-to-landline" gateway), the carrier often bounces back an
 * automated message like:
 *   "Undelivered: SMS to this number is not monitored. Please try calling."
 * Treating those as a customer reply spams the owner and falsely marks the
 * lead as engaged. Match the well-known auto-reply signatures conservatively
 * so a genuine reply that merely mentions "call" is never suppressed.
 */
const AUTO_REPLY_SIGNATURES: RegExp[] = [
    /not monitored/i,
    /unable to receive (?:text|sms|messages)/i,
    /(?:cannot|can't|does not|doesn't|do not) (?:receive|accept) (?:text|sms|messages)/i,
    /could not be delivered/i,
    /was not delivered/i,
    /^undelivered\b/i,
    /message (?:delivery )?failed/i,
];

export function isCarrierAutoReply(body: string): boolean {
    const text = body.trim();
    if (!text) return false;
    return AUTO_REPLY_SIGNATURES.some((re) => re.test(text));
}
