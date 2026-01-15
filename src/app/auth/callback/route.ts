
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Validates the redirect path to prevent open redirect attacks.
 * Only allows relative paths that start with / and don't contain protocol indicators.
 */
function getSafeRedirectPath(path: string | null): string {
    const defaultPath = '/dashboard';

    if (!path) {
        return defaultPath;
    }

    // Must start with a single forward slash (relative path)
    if (!path.startsWith('/')) {
        return defaultPath;
    }

    // Reject protocol-relative URLs (//evil.com)
    if (path.startsWith('//')) {
        return defaultPath;
    }

    // Reject paths containing protocol indicators
    if (path.includes(':') || path.includes('http')) {
        return defaultPath;
    }

    // Reject paths with encoded characters that could bypass validation
    if (path.includes('%2f') || path.includes('%2F') || path.includes('%5c') || path.includes('%5C')) {
        return defaultPath;
    }

    return path;
}

export async function GET(request: NextRequest) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = getSafeRedirectPath(searchParams.get('next'))

    if (code) {
        const cookieStore = request.cookies
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value
                    },
                    set(name: string, value: string, options: CookieOptions) {
                        cookieStore.set({ name, value, ...options })
                    },
                    remove(name: string, options: CookieOptions) {
                        cookieStore.delete(name)
                    },
                },
            }
        )
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return NextResponse.redirect(`${origin}${next}`)
        }
    }

    // return the user to an error page with instructions
    return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
