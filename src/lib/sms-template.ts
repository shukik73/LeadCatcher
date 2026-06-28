/**
 * SMS template helpers shared across missed-call SMS paths
 * (Twilio voice webhook, RepairDesk poll, watchdog, etc.).
 */

const BOOKING_LINK_TOKEN = /\{\{\s*booking_link\s*\}\}/g;
const BUSINESS_NAME_TOKEN = /\{\{\s*business_name\s*\}\}/g;
const FIRST_NAME_TOKEN = /\{\{\s*first_name\s*\}\}/g;
/** Any remaining {{token}} after known substitutions — must never reach a customer. */
const ANY_TOKEN = /\{\{\s*\w+\s*\}\}/g;

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

/**
 * Replace the {{first_name}} token with the caller's first name. Missed-call SMS
 * usually fires before the caller is known, so an empty/missing name falls back to
 * a friendly generic ("there") rather than leaving a blank or a raw token.
 */
export function replaceFirstName(body: string, firstName: string | null | undefined): string {
    const name = (firstName || '').trim();
    return body.replace(FIRST_NAME_TOKEN, name || 'there');
}

/**
 * Strip any unresolved {{token}} placeholders so a raw token can never be texted to
 * a customer (e.g. a template using an unsupported variable). Tidies the whitespace
 * and dangling punctuation a removed token leaves behind.
 */
export function stripUnknownTokens(body: string): string {
    return body
        .replace(ANY_TOKEN, '')
        .replace(/\s+([,.!?;:])/g, '$1') // " ," -> ","
        .replace(/[ \t]{2,}/g, ' ')      // collapse runs of spaces
        .trim();
}

/**
 * One-shot helper that renders a missed-call SMS template: substitutes
 * business_name, first_name and booking_link, then strips any leftover token so no
 * unresolved placeholder ever reaches the customer.
 */
export function renderMissedCallSms(
    template: string,
    business: { name: string | null; booking_url: string | null | undefined },
    firstName?: string | null,
): string {
    let body = replaceBusinessName(template, business.name);
    body = replaceFirstName(body, firstName);
    body = appendBookingLink(body, business.booking_url);
    return stripUnknownTokens(body);
}
