import { createBrowserClient } from '@supabase/ssr';

// Validate Env Vars
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn('Supabase env vars missing. Client will be non-functional.');
}

export function createSupabaseBrowserClient() {
  return createBrowserClient(url, key);
}
