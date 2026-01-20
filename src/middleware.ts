import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { logger } from './lib/logger';

// Initialize Redis and Ratelimit
let ratelimit: Ratelimit | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    ratelimit = new Ratelimit({
        redis: redis,
        limiter: Ratelimit.slidingWindow(10, '10 s'),
        analytics: true,
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
        // Skip for internal Next.js requests if any leak through
        if (ratelimit) {
            // Get IP from headers (Vercel/Next.js sets this)
            const forwarded = request.headers.get('x-forwarded-for');
            const realIp = request.headers.get('x-real-ip');
            const ip = forwarded?.split(',')[0] || realIp || request.headers.get('cf-connecting-ip') || '127.0.0.1';
            try {
                const { success, limit, reset, remaining } = await ratelimit.limit(ip);

                if (!success) {
                    logger.warn(`Rate limit exceeded for IP: ${ip}`);
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
    // calling getUser() or getSession() triggers the cookie refresh mechanism in createServerClient
    const { data: { user } } = await supabase.auth.getUser();
    // const user = { id: 'preview-user' };

    // Protect Dashboard & Onboarding
    if (request.nextUrl.pathname.startsWith('/dashboard') || request.nextUrl.pathname.startsWith('/onboarding')) {
        if (!user) {
            return NextResponse.redirect(new URL('/login', request.url));
        }
    }

    // Redirect /login if authenticated
    if (request.nextUrl.pathname === '/login') {
        if (user) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }
    }

    return response;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - api/webhooks (public webhooks - optional exclude from auth but keep for rate limit)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
