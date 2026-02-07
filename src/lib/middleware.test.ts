import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase SSR
const mockGetUser = vi.fn();
vi.mock('@supabase/ssr', () => ({
    createServerClient: vi.fn(() => ({
        auth: {
            getUser: mockGetUser,
        },
    })),
}));

// Mock Upstash
const mockLimit = vi.fn();
vi.mock('@upstash/ratelimit', () => ({
    Ratelimit: class {
        limit = mockLimit;
        static slidingWindow() { return {}; }
    },
}));

vi.mock('@upstash/redis', () => ({
    Redis: class {},
}));

vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// We need to mock NextResponse and NextRequest for the middleware
// Since middleware uses next/server, we mock the necessary parts
vi.mock('next/server', () => {
    class MockNextResponse {
        status: number;
        headers: Map<string, string>;
        body: string | null;

        constructor(body?: string | null, init?: { status?: number; headers?: Record<string, string> }) {
            this.status = init?.status || 200;
            this.body = body || null;
            this.headers = new Map(Object.entries(init?.headers || {}));
        }

        static next(opts?: { request?: { headers?: Headers } }) {
            const res = new MockNextResponse(null, { status: 200 });
            (res as Record<string, unknown>)._isNext = true;
            // Add cookies mock
            (res as Record<string, unknown>).cookies = {
                set: vi.fn(),
            };
            if (opts?.request?.headers) {
                (res as Record<string, unknown>)._requestHeaders = opts.request.headers;
            }
            return res;
        }

        static redirect(url: URL) {
            const res = new MockNextResponse(null, { status: 307 });
            (res as Record<string, unknown>)._redirectUrl = url.toString();
            return res;
        }
    }

    return {
        NextResponse: MockNextResponse,
    };
});

describe('Middleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Set env vars for Supabase
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
        // Set env vars for rate limiting
        process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io';
        process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

        mockGetUser.mockResolvedValue({ data: { user: null } });
        mockLimit.mockResolvedValue({ success: true, limit: 10, reset: Date.now(), remaining: 9 });
    });

    function createMockRequest(pathname: string, options: {
        searchParams?: Record<string, string>;
        headers?: Record<string, string>;
    } = {}) {
        const url = new URL(`https://example.com${pathname}`);
        if (options.searchParams) {
            for (const [key, value] of Object.entries(options.searchParams)) {
                url.searchParams.set(key, value);
            }
        }

        const headers = new Headers(options.headers || {});

        return {
            headers,
            nextUrl: url,
            url: url.toString(),
            cookies: {
                get: vi.fn(),
                set: vi.fn(),
            },
        };
    }

    it('redirects root with auth code to /auth/callback', async () => {
        // Need to import fresh for each test with proper env
        vi.resetModules();
        const { middleware } = await import('@/middleware');

        const req = createMockRequest('/', { searchParams: { code: 'abc123' } });
        const res = await middleware(req as never);

        expect((res as Record<string, unknown>)._redirectUrl).toContain('/auth/callback');
        expect((res as Record<string, unknown>)._redirectUrl).toContain('code=abc123');
    });

    it('redirects unauthenticated users from /dashboard to /login', async () => {
        vi.resetModules();
        mockGetUser.mockResolvedValue({ data: { user: null } });

        const { middleware } = await import('@/middleware');
        const req = createMockRequest('/dashboard');
        const res = await middleware(req as never);

        expect((res as Record<string, unknown>)._redirectUrl).toContain('/login');
    });

    it('redirects unauthenticated users from /onboarding to /login', async () => {
        vi.resetModules();
        mockGetUser.mockResolvedValue({ data: { user: null } });

        const { middleware } = await import('@/middleware');
        const req = createMockRequest('/onboarding');
        const res = await middleware(req as never);

        expect((res as Record<string, unknown>)._redirectUrl).toContain('/login');
    });

    it('allows authenticated users to access /dashboard', async () => {
        vi.resetModules();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

        const { middleware } = await import('@/middleware');
        const req = createMockRequest('/dashboard');
        const res = await middleware(req as never);

        // Should be a "next" response, not a redirect
        expect((res as Record<string, unknown>)._isNext).toBe(true);
    });

    it('redirects authenticated users from /login to /dashboard', async () => {
        vi.resetModules();
        mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

        const { middleware } = await import('@/middleware');
        const req = createMockRequest('/login');
        const res = await middleware(req as never);

        expect((res as Record<string, unknown>)._redirectUrl).toContain('/dashboard');
    });

    it('allows unauthenticated users to access /login', async () => {
        vi.resetModules();
        mockGetUser.mockResolvedValue({ data: { user: null } });

        const { middleware } = await import('@/middleware');
        const req = createMockRequest('/login');
        const res = await middleware(req as never);

        expect((res as Record<string, unknown>)._isNext).toBe(true);
    });

    it('returns 429 when rate limit is exceeded on API routes', async () => {
        vi.resetModules();
        mockLimit.mockResolvedValue({ success: false, limit: 10, reset: Date.now(), remaining: 0 });

        const { middleware } = await import('@/middleware');
        const req = createMockRequest('/api/some-endpoint', {
            headers: { 'x-forwarded-for': '1.2.3.4' },
        });
        const res = await middleware(req as never);

        expect(res.status).toBe(429);
    });

    it('allows API requests within rate limit', async () => {
        vi.resetModules();
        mockLimit.mockResolvedValue({ success: true, limit: 10, reset: Date.now(), remaining: 9 });
        mockGetUser.mockResolvedValue({ data: { user: null } });

        const { middleware } = await import('@/middleware');
        const req = createMockRequest('/api/some-endpoint', {
            headers: { 'x-forwarded-for': '1.2.3.4' },
        });
        const res = await middleware(req as never);

        // Should not be 429
        expect(res.status).not.toBe(429);
    });

    it('uses x-forwarded-for header for rate limiting IP', async () => {
        vi.resetModules();
        mockLimit.mockResolvedValue({ success: true, limit: 10, reset: Date.now(), remaining: 9 });
        mockGetUser.mockResolvedValue({ data: { user: null } });

        const { middleware } = await import('@/middleware');
        const req = createMockRequest('/api/endpoint', {
            headers: { 'x-forwarded-for': '5.6.7.8, 1.2.3.4' },
        });
        await middleware(req as never);

        // Rate limit should use first IP from x-forwarded-for
        expect(mockLimit).toHaveBeenCalledWith('5.6.7.8');
    });

    it('exports correct matcher config', async () => {
        vi.resetModules();
        const mod = await import('@/middleware');
        expect(mod.config).toBeDefined();
        expect(mod.config.matcher).toBeDefined();
    });
});
