import { createBrowserClient } from '@supabase/ssr';

let cachedClient: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Create (or return cached) Supabase browser client.
 *
 * During `next build` prerender, NEXT_PUBLIC_* env vars may be absent.
 * "use client" components are still SSR-rendered at build time, so calling
 * this function must NOT throw — otherwise the build crashes.
 *
 * We use placeholder values during SSR/build when env vars are missing.
 * The client won't make real requests during prerender (all data-fetching
 * happens inside useEffect/event handlers, which don't run during SSR).
 * At runtime in the browser the real env vars will be present.
 */
export function createSupabaseBrowserClient() {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (typeof window !== 'undefined') {
      // In the browser, missing env vars is a real error
      throw new Error(
        'Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
      );
    }
    // During SSR/build: return a client with placeholder values.
    // This client is never used for real requests during prerender —
    // all Supabase calls happen inside useEffect or event handlers.
    return createBrowserClient(
      'https://placeholder.supabase.co',
      'placeholder-anon-key'
    );
  }

  cachedClient = createBrowserClient(url, key);
  return cachedClient;
}
