/**
 * SMS template helpers shared across missed-call SMS paths
 * (Twilio voice webhook, RepairDesk poll, watchdog, etc.).
 */

const BOOKING_LINK_TOKEN = /\{\{\s*booking_link\s*\}\}/g;
const BUSINESS_NAME_TOKEN = /\{\{\s*business_name\s*\}\}/g;

/**
 * Apply booking-link logic to a templated SMS body:
 *  - If a {{booking_link}} placeholder exists in the template, substitute the URL
 *    (or remove the placeholder if no URL is configured).
 *  - Otherwise, if a URL is configured, append a short booking sentence so
 *    customers can self-serve a slot.
 *
 * If `bookingUrl` is null/empty, the body is returned unchanged (placeholder removed).
 */
export function appendBookingLink(body: string, bookingUrl: string | null | undefined): string {
    const url = (bookingUrl || '').trim();
    const hasPlaceholder = BOOKING_LINK_TOKEN.test(body);
    // Reset regex lastIndex since the global flag retains it between tests.
    BOOKING_LINK_TOKEN.lastIndex = 0;

    if (hasPlaceholder) {
        // Always replace the placeholder, even when URL is empty (drop it cleanly).
        const replaced = body.replace(BOOKING_LINK_TOKEN, url || '').replace(/\s+$/, '');
        return replaced;
    }

    if (!url) return body;

    const trimmed = body.replace(/\s+$/, '');
    return `${trimmed} You can also book here: ${url}`;
}

/** Replace the {{business_name}} token in a template with the business's name. */
export function replaceBusinessName(body: string, name: string | null | undefined): string {
    return body.replace(BUSINESS_NAME_TOKEN, name || 'our business');
}

/** One-shot helper that applies both business_name and booking_link substitutions. */
export function renderMissedCallSms(
    template: string,
    business: { name: string | null; booking_url: string | null | undefined },
): string {
    const withName = replaceBusinessName(template, business.name);
    return appendBookingLink(withName, business.booking_url);
}
