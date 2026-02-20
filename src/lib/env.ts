/**
 * Environment variable validation — fail-fast pattern.
 *
 * Import this module early (e.g., from instrumentation.ts) to surface
 * missing configuration at startup rather than at first request time.
 *
 * Required vars throw on server startup; optional vars log a warning.
 */

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function optionalEnv(name: string, fallback?: string): string | undefined {
    const value = process.env[name];
    if (!value && !fallback) {
        console.warn(`[env] Optional variable ${name} is not set`);
    }
    return value || fallback;
}

/** Validate all required env vars at startup. Call once from instrumentation.ts. */
export function validateEnv() {
    // Core infrastructure
    requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    requireEnv('SUPABASE_SERVICE_ROLE_KEY');

    // Twilio (required for webhook handling)
    requireEnv('TWILIO_ACCOUNT_SID');
    requireEnv('TWILIO_AUTH_TOKEN');

    // Stripe (required for billing)
    requireEnv('STRIPE_SECRET_KEY');

    // Optional but important — warn if missing
    optionalEnv('NEXT_PUBLIC_APP_URL');
    optionalEnv('STRIPE_WEBHOOK_SECRET');
    optionalEnv('OPENAI_API_KEY');
    optionalEnv('CRON_SECRET');
    optionalEnv('UPSTASH_REDIS_REST_URL');
    optionalEnv('UPSTASH_REDIS_REST_TOKEN');
}
