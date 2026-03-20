/**
 * CSRF protection via Origin header validation.
 *
 * Cookie-based auth (Supabase SSR) is vulnerable to CSRF if there's no
 * Origin/Referer check. This validates that requests to authenticated
 * API routes come from the same origin as the app.
 *
 * Webhook routes are excluded — they use their own signature validation.
 */

import { logger } from '@/lib/logger';

/**
 * Validates that the request Origin matches the app's origin.
 * Returns true if the request is safe, false if it should be blocked.
 */
export function validateCsrfOrigin(request: Request): boolean {
    const origin = request.headers.get('Origin');
    const referer = request.headers.get('Referer');

    // If neither header is present, the request is likely from a non-browser
    // context (curl, server-to-server). Allow it — Supabase auth will still
    // gate access. Browsers always send Origin on POST/PUT/DELETE.
    if (!origin && !referer) {
        return true;
    }

    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.length === 0) {
        // No origins configured — skip CSRF check rather than breaking
        return true;
    }

    // Check Origin header first (most reliable)
    if (origin) {
        if (allowedOrigins.includes(origin)) return true;
        logger.warn('[CSRF] Origin mismatch', { origin, allowed: allowedOrigins.join(',') });
        return false;
    }

    // Fall back to Referer header
    if (referer) {
        try {
            const refererOrigin = new URL(referer).origin;
            if (allowedOrigins.includes(refererOrigin)) return true;
        } catch {
            // Invalid referer URL
        }
        logger.warn('[CSRF] Referer mismatch', { referer, allowed: allowedOrigins.join(',') });
        return false;
    }

    return false;
}

function getAllowedOrigins(): string[] {
    const origins: string[] = [];

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) {
        try {
            origins.push(new URL(appUrl).origin);
        } catch {
            // Invalid URL
        }
    }

    const baseUrl = process.env.APP_BASE_URL;
    if (baseUrl) {
        try {
            origins.push(new URL(baseUrl).origin);
        } catch {
            // Invalid URL
        }
    }

    // Always allow localhost in development
    if (process.env.NODE_ENV === 'development') {
        origins.push('http://localhost:3000');
    }

    return [...new Set(origins)];
}
