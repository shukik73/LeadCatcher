import { createBrowserClient } from '@supabase/ssr';

let cachedClient: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Create (or return cached) Supabase browser client.
 *
 * During build/prerender the NEXT_PUBLIC_* env vars may be absent.
 * We surface a clear error only at runtime (in the browser) to avoid
 * crashing `next build` on pages that import this module at the top level.
 */
export function createSupabaseBrowserClient() {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // During SSR/build, bail with a placeholder that will error on first use
    // rather than crashing the build itself.
    if (typeof window === 'undefined') {
      throw new Error(
        'Missing Supabase environment variables during server render. ' +
        'Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
      );
    }
    throw new Error(
      'Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }

  cachedClient = createBrowserClient(url, key);
  return cachedClient;
}
