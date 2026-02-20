/**
 * Environment variable validation — fail-fast pattern.
 *
 * Import this module early (e.g., from instrumentation.ts) to surface
 * missing configuration at startup rather than at first request time.
 *
 * Logs errors for missing required vars and warnings for missing optional vars.
 * Does NOT throw — the server still starts so non-affected routes keep working.
 */

const missing: string[] = [];

function requireEnv(name: string): string | undefined {
    const value = process.env[name];
    if (!value) {
        missing.push(name);
    }
    return value;
}

function optionalEnv(name: string): string | undefined {
    const value = process.env[name];
    if (!value) {
        console.warn(`[env] Optional variable ${name} is not set`);
    }
    return value;
}

/** Validate all required env vars at startup. Call once from instrumentation.ts. */
export function validateEnv() {
    missing.length = 0;

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

    if (missing.length > 0) {
        console.error(
            `[env] MISSING REQUIRED ENV VARS: ${missing.join(', ')}. ` +
            `Some features will not work until these are configured.`
        );
    }
}
