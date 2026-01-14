/**
 * @deprecated This file is kept for backward compatibility.
 * 
 * For new code:
 * - Use `supabase-client.ts` in client components
 * - Use `supabase-server.ts` in API routes and server components
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Note: Use Service Role Key for backend admin tasks (webhooks) to bypass RLS if needed.
export const supabase = createClient(supabaseUrl, supabaseKey);
