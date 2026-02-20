import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { logger } from './lib/logger';

// Paths that receive signed provider webhooks or cron requests.
// These get a higher rate limit to avoid dropping legitimate traffic.
const WEBHOOK_PATHS = [
    '/api/webhooks/twilio/',
    '/api/stripe/webhook',
    '/api/repairdesk/poll',
];

function isWebhookPath(pathname: string): boolean {
    return WEBHOOK_PATHS.some(prefix => pathname.startsWith(prefix));
}

// Initialize Redis and Ratelimits (separate buckets per route class)
let userRatelimit: Ratelimit | null = null;
let webhookRatelimit: Ratelimit | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    // Standard user API routes: 10 requests / 10s
    userRatelimit = new Ratelimit({
        redis: redis,
        limiter: Ratelimit.slidingWindow(10, '10 s'),
        analytics: true,
        prefix: 'rl:user',
    });

    // Webhook/cron routes: 60 requests / 10s (providers send bursts)
    webhookRatelimit = new Ratelimit({
        redis: redis,
        limiter: Ratelimit.slidingWindow(60, '10 s'),
        analytics: true,
        prefix: 'rl:webhook',
    });
}

export async function middleware(request: NextRequest) {
    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    });

    // -------------------------------------------------------------------------
    // 0. HANDLE AUTH CODE AT ROOT (Password Reset, Email Verification)
    // -------------------------------------------------------------------------
    // Supabase sends auth codes to the Site URL root. Redirect to auth callback.
    const code = request.nextUrl.searchParams.get('code');
    if (code && request.nextUrl.pathname === '/') {
        const callbackUrl = new URL('/auth/callback', request.url);
        callbackUrl.searchParams.set('code', code);
        // Check if this might be a password reset (add marker for callback)
        callbackUrl.searchParams.set('next', '/auth/reset-password');
        return NextResponse.redirect(callbackUrl);
    }

    // -------------------------------------------------------------------------
    // 1. RATE LIMITING (API Routes Only)
    // -------------------------------------------------------------------------
    if (request.nextUrl.pathname.startsWith('/api')) {
        // Use the appropriate rate limiter based on route class
        const limiter = isWebhookPath(request.nextUrl.pathname)
            ? webhookRatelimit
            : userRatelimit;

        if (limiter) {
            // Get IP from headers (Vercel/Next.js sets this)
            const forwarded = request.headers.get('x-forwarded-for');
            const realIp = request.headers.get('x-real-ip');
            const ip = forwarded?.split(',')[0] || realIp || request.headers.get('cf-connecting-ip') || '127.0.0.1';
            try {
                const { success, limit, reset, remaining } = await limiter.limit(ip);

                if (!success) {
                    logger.warn(`Rate limit exceeded for IP: ${ip}`, { path: request.nextUrl.pathname });
                    return new NextResponse('Too Many Requests', {
                        status: 429,
                        headers: {
                            'X-RateLimit-Limit': limit.toString(),
                            'X-RateLimit-Remaining': remaining.toString(),
                            'X-RateLimit-Reset': reset.toString(),
                        },
                    });
                }
                // Add headers to successful response too
                response.headers.set('X-RateLimit-Limit', limit.toString());
                response.headers.set('X-RateLimit-Remaining', remaining.toString());
                response.headers.set('X-RateLimit-Reset', reset.toString());
            } catch (error) {
                logger.error('Rate Limit Middleware Error', error);
                // Fail open
            }
        }
    }

    // -------------------------------------------------------------------------
    // 2. AUTHENTICATION (Dashboard & Onboarding)
    // -------------------------------------------------------------------------

    // Only create Supabase client and check auth for routes that need it.
    // This avoids a ~100-300ms Supabase round-trip on every page load
    // (e.g. landing page, static pages) that don't need auth at all.
    const pathname = request.nextUrl.pathname;
    const needsAuth = pathname.startsWith('/dashboard') ||
                      pathname.startsWith('/onboarding') ||
                      pathname === '/login';

    if (!needsAuth) {
        return response;
    }

    // Create Supabase Client
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) {
                    return request.cookies.get(name)?.value
                },
                set(name: string, value: string, options: CookieOptions) {
                    request.cookies.set({
                        name,
                        value,
                        ...options,
                    })
                    response = NextResponse.next({
                        request: {
                            headers: request.headers,
                        },
                    })
                    response.cookies.set({
                        name,
                        value,
                        ...options,
                    })
                },
                remove(name: string, options: CookieOptions) {
                    request.cookies.set({
                        name,
                        value: '',
                        ...options,
                    })
                    response = NextResponse.next({
                        request: {
                            headers: request.headers,
                        },
                    })
                    response.cookies.set({
                        name,
                        value: '',
                        ...options,
                    })
                },
            },
        }
    );

    // Refresh Session
    const { data: { user } } = await supabase.auth.getUser();

    // Protect Dashboard & Onboarding
    if (pathname.startsWith('/dashboard') || pathname.startsWith('/onboarding')) {
        if (!user) {
            return NextResponse.redirect(new URL('/login', request.url));
        }
    }

    // Redirect /login if authenticated
    if (pathname === '/login') {
        if (user) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }
    }

    return response;
}

export const config = {
    matcher: [
        /*
         * Match only routes that need auth or rate limiting:
         * - /api/* routes (rate limiting + webhook auth)
         * - /dashboard/* (auth required)
         * - /onboarding/* (auth required)
         * - /login (redirect if authenticated)
         * - / (auth code redirect)
         *
         * Excludes static assets, images, fonts, and file extensions
         * to avoid unnecessary middleware overhead.
         */
        '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)$).*)',
    ],
};
