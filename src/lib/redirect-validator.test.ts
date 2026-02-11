import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getSafeRedirectPath } from './redirect-validator';
import { logger } from '@/lib/logger';

describe('getSafeRedirectPath', () => {
    describe('valid paths', () => {
        it('allows simple relative paths', () => {
            expect(getSafeRedirectPath('/dashboard')).toBe('/dashboard');
        });

        it('allows nested relative paths', () => {
            expect(getSafeRedirectPath('/dashboard/settings')).toBe('/dashboard/settings');
        });

        it('allows paths with query strings', () => {
            expect(getSafeRedirectPath('/dashboard?tab=leads')).toBe('/dashboard?tab=leads');
        });

        it('allows root path', () => {
            expect(getSafeRedirectPath('/')).toBe('/');
        });
    });

    describe('null/empty input', () => {
        it('returns /dashboard for null', () => {
            expect(getSafeRedirectPath(null)).toBe('/dashboard');
        });

        it('returns /dashboard for empty string (no leading slash)', () => {
            expect(getSafeRedirectPath('')).toBe('/dashboard');
        });
    });

    describe('blocks open redirect attacks', () => {
        it('blocks absolute URLs to external sites', () => {
            expect(getSafeRedirectPath('https://evil.com')).toBe('/dashboard');
        });

        it('blocks protocol-relative URLs (//evil.com)', () => {
            expect(getSafeRedirectPath('//evil.com')).toBe('/dashboard');
            expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
                expect.stringContaining('protocol-relative'),
                expect.any(Object)
            );
        });

        it('blocks URLs with http in path', () => {
            expect(getSafeRedirectPath('/redirect?url=http://evil.com')).toBe('/dashboard');
        });

        it('blocks paths with colon (protocol indicators)', () => {
            expect(getSafeRedirectPath('javascript:alert(1)')).toBe('/dashboard');
        });

        it('blocks data: URI scheme', () => {
            expect(getSafeRedirectPath('data:text/html,<script>alert(1)</script>')).toBe('/dashboard');
        });

        it('blocks paths without leading slash', () => {
            expect(getSafeRedirectPath('evil.com/steal')).toBe('/dashboard');
        });
    });

    describe('blocks encoded bypass attempts', () => {
        it('blocks encoded forward slash %2f', () => {
            expect(getSafeRedirectPath('/..%2f..%2fetc/passwd')).toBe('/dashboard');
        });

        it('blocks encoded forward slash %2F (uppercase)', () => {
            expect(getSafeRedirectPath('/..%2F..%2Fetc/passwd')).toBe('/dashboard');
        });

        it('blocks encoded backslash %5c', () => {
            expect(getSafeRedirectPath('/..%5c..%5cetc/passwd')).toBe('/dashboard');
        });

        it('blocks encoded backslash %5C (uppercase)', () => {
            expect(getSafeRedirectPath('/..%5C..%5Cetc/passwd')).toBe('/dashboard');
        });
    });

    describe('logs security events', () => {
        it('logs warning when redirect is blocked', () => {
            vi.mocked(logger.warn).mockClear();
            getSafeRedirectPath('//evil.com/phishing');
            expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
        });

        it('does not log for valid paths', () => {
            vi.mocked(logger.warn).mockClear();
            getSafeRedirectPath('/dashboard');
            expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
        });

        it('does not log for null input', () => {
            vi.mocked(logger.warn).mockClear();
            getSafeRedirectPath(null);
            expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
        });
    });
});
