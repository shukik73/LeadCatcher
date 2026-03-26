import { logger } from '@/lib/logger';

/**
 * Returns the canonical public base URL for this app.
 * Used for both Twilio webhook validation and callback URL generation
 * to ensure they always match.
 *
 * Priority: APP_BASE_URL > NEXT_PUBLIC_APP_URL
 */
export function getWebhookBaseUrl(): string | null {
    const url = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (!url) {
        logger.error('[webhook-url] Neither APP_BASE_URL nor NEXT_PUBLIC_APP_URL is set');
        return null;
    }
    // Strip trailing slash for consistent URL building
    return url.replace(/\/$/, '');
}
