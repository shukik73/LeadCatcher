import { logger } from '@/lib/logger';

/**
 * Validates the redirect path to prevent open redirect attacks.
 * Only allows relative paths that start with / and don't contain protocol indicators.
 */
export function getSafeRedirectPath(path: string | null): string {
    const defaultPath = '/dashboard';

    if (!path) {
        return defaultPath;
    }

    // Must start with a single forward slash (relative path)
    if (!path.startsWith('/')) {
        logger.warn('[Auth Callback] Blocked redirect — path missing leading slash', { path });
        return defaultPath;
    }

    // Reject protocol-relative URLs (//evil.com)
    if (path.startsWith('//')) {
        logger.warn('[Auth Callback] Blocked open redirect attempt (protocol-relative URL)', { path });
        return defaultPath;
    }

    // Reject paths containing protocol indicators
    if (path.includes(':') || path.includes('http')) {
        logger.warn('[Auth Callback] Blocked open redirect attempt (protocol in path)', { path });
        return defaultPath;
    }

    // Reject paths with encoded characters that could bypass validation
    if (path.includes('%2f') || path.includes('%2F') || path.includes('%5c') || path.includes('%5C')) {
        logger.warn('[Auth Callback] Blocked open redirect attempt (encoded traversal)', { path });
        return defaultPath;
    }

    return path;
}
