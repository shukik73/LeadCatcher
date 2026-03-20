# LeadCatcher Security & Code Quality Audit

**Date:** 2026-03-20
**Auditor:** Claude Code (Opus 4.6)
**Scope:** Full codebase — security, database, integrations, code quality, performance, reliability, deployment

---

## Category Scores

| Category | Score (1-10) | Notes |
|---|---|---|
| **1. Security** | 7.5 | Strong foundation (RLS, signature validation, PII redaction). Key gaps: billing guard fail-open, timing-unsafe cron auth, missing input validation on settings API. All fixed in this audit. |
| **2. Database & RLS** | 8.5 | RLS enabled on all tables with proper user scoping. Stripe column protection trigger. Minor gaps: no UPDATE/DELETE policy on messages, missing composite indexes. |
| **3. Twilio Integration** | 8.0 | Signature validation on all 3 webhooks. Idempotency via atomic INSERT. TCPA compliance with fail-closed opt-out. Transcription callback params validated with UUID/E.164 regex. |
| **4. Stripe Integration** | 8.5 | Signature verification, idempotency, monotonic ordering guard. Metadata validated. Minor: error message leaked Stripe internals (fixed). |
| **5. Code Quality** | 7.5 | TypeScript strict mode. Consistent patterns. Some `Record<string, unknown>` casts. No `any` types. Minor React dependency issues. |
| **6. Performance** | 7.0 | No N+1 queries. Real-time subscriptions use refs correctly. Missing composite indexes. `leads.length` in useCallback dep array. |
| **7. Reliability** | 7.5 | Webhook idempotency excellent. Fail-closed opt-out checks. Billing guard was fail-open (fixed). Error recovery adequate. |
| **8. Deployment & Config** | 7.5 | Security headers present (HSTS, X-Frame-Options, CSP). Env validation exists but doesn't throw. CSP had `unsafe-inline` for scripts (fixed). |

**Overall Score: 7.7 / 10**

---

## Critical Findings

### C1. Billing Guard Failed Open on DB Errors
- **Severity:** CRITICAL
- **File:** `src/lib/billing-guard.ts:22-26`
- **Description:** When the database was unreachable, `checkBillingStatus()` returned `{ allowed: true }`, allowing unlimited SMS sends without billing verification. During a Supabase outage, any business (including canceled/unpaid) could send SMS, causing uncontrolled Twilio spend.
- **Status:** **FIXED** — Now returns `{ allowed: false }` on DB errors (fail-closed).

### C2. Timing-Unsafe CRON_SECRET Comparison
- **Severity:** CRITICAL
- **Files:** `src/app/api/cron/cleanup/route.ts:14`, `src/app/api/repairdesk/poll/route.ts:29`
- **Description:** Both cron endpoints used `!==` string comparison for CRON_SECRET, vulnerable to timing attacks. An attacker could gradually determine the secret byte-by-byte by measuring response times.
- **Status:** **FIXED** — Now uses `crypto.timingSafeEqual()` with length pre-check.

### C3. Settings API Missing Input Validation
- **Severity:** CRITICAL
- **File:** `src/app/api/settings/route.ts`
- **Description:** The settings endpoint only checked field *names* via whitelist but accepted any *values* without validation. An attacker could inject:
  - Multi-megabyte `sms_template` strings (resource exhaustion)
  - Invalid `timezone` values causing runtime errors in `Intl.DateTimeFormat`
  - Malformed `business_hours` JSON breaking business hours logic
  - Additionally, the error response leaked internal Supabase error messages: `Failed to save: ${saveError.message}`
- **Status:** **FIXED** — Added Zod schema with type validation, length limits, and format constraints. Error messages now generic.

---

## High Findings

### H1. CSP Allowed `unsafe-inline` for Scripts
- **Severity:** HIGH
- **File:** `next.config.ts:34-35`
- **Description:** Content-Security-Policy included `script-src 'self' 'unsafe-inline'`, significantly weakening XSS protection. If any user-controlled content is rendered without escaping, inline scripts could execute. Also missing `base-uri`, `form-action`, and `object-src` directives.
- **Status:** **FIXED** — Removed `unsafe-inline` from `script-src`. Added `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`.

### H2. STRIPE_WEBHOOK_SECRET Marked as Optional
- **Severity:** HIGH
- **File:** `src/lib/env.ts:47`
- **Description:** `STRIPE_WEBHOOK_SECRET` was listed as optional in env validation. Without it, Stripe webhook signature verification fails silently, allowing forged webhook events to modify subscription status, granting free access or disrupting billing.
- **Status:** **FIXED** — Now listed as required in `validateEnv()`.

### H3. Transcription Callback Parameters Not Signed
- **Severity:** HIGH
- **File:** `src/app/api/webhooks/twilio/voice/route.ts:162`
- **Description:** The voice webhook constructs a transcription callback URL with `businessId`, `caller`, and `called` as query parameters. While the transcription webhook validates formats (UUID, E.164), these params are not HMAC-signed. If Twilio's callback URL is intercepted or the Twilio account is compromised, an attacker could inject leads into arbitrary businesses.
- **Mitigation:** Twilio signature validation on the transcription endpoint prevents external callers. Risk is limited to Twilio-side compromise.
- **Recommendation:** Add HMAC signature to callback URL params for defense-in-depth.

### H4. Settings API Falls Back to User Client
- **Severity:** HIGH
- **File:** `src/app/api/settings/route.ts:68-77`
- **Description:** If `SUPABASE_SERVICE_ROLE_KEY` is missing, the settings API falls back to the authenticated user's Supabase client. While RLS should protect against cross-user access, this creates a dependency on RLS correctness. If RLS policies are misconfigured, user A could update user B's business.
- **Recommendation:** Fail fast if admin client unavailable rather than falling back.

### H5. Weak Password Requirements
- **Severity:** HIGH
- **File:** `src/app/auth/reset-password/page.tsx:43-46`
- **Description:** Password reset only requires 6 characters minimum. Below NIST SP 800-63B recommendations (minimum 8, recommended 12+). No complexity requirements.
- **Recommendation:** Increase minimum to 12 characters. Consider blocklist of common passwords.

---

## Medium Findings

### M1. No Rate Limiting on Verification Calls
- **File:** `src/app/api/verify/route.ts`
- **Description:** POST `/api/verify` triggers a Twilio call with no per-user rate limiting. An authenticated user could repeatedly trigger calls, generating Twilio charges.
- **Recommendation:** Add rate limit (e.g., 3 calls per hour per user) via Upstash Redis.

### M2. Message Body Rendered Without Sanitization
- **File:** `src/app/dashboard/page.tsx:312`
- **Description:** `<p className="text-sm">{msg.body}</p>` renders SMS message bodies directly. While React escapes JSX expressions by default (preventing XSS), the content could contain misleading URLs or phishing text displayed as-is.
- **Risk:** Low (React auto-escapes), but defense-in-depth suggests sanitizing.

### M3. Missing Composite Database Indexes
- **Files:** `supabase/indexes.sql`
- **Description:** Missing indexes that would improve query performance:
  - `(business_id, status)` on `leads` — used in dashboard filtering
  - `(business_id, created_at DESC)` on `messages` — used in conversation views
  - `businesses.verification_token` — used in verification flow
- **Recommendation:** Add composite indexes to `indexes.sql`.

### M4. Phone Number Normalization Inconsistency Risk
- **File:** `src/lib/webhook-common.ts:106`
- **Description:** `checkOptOut()` accepts a `phoneNumber` parameter without verifying it's in E.164 format. If a caller passes an unnormalized number, the opt-out lookup won't match, potentially sending SMS to opted-out users (TCPA violation).
- **Recommendation:** Add `normalizePhoneNumber()` call inside `checkOptOut()`.

### M5. RepairDesk API Key Stored in Plaintext
- **File:** `src/app/api/settings/route.ts`
- **Description:** `repairdesk_api_key` is stored unencrypted in the `businesses` table. If the database is breached, all RepairDesk API keys are exposed.
- **Recommendation:** Encrypt at rest using a KMS or application-level encryption.

### M6. Env Validation Doesn't Throw
- **File:** `src/lib/env.ts:55-60`
- **Description:** `validateEnv()` logs missing required vars but doesn't throw. The server starts with partial configuration, causing cryptic errors at request time instead of clear startup failures.
- **Recommendation:** Throw in production (`NODE_ENV === 'production'`).

### M7. `leads.length` in useCallback Dependency
- **File:** `src/app/dashboard/page.tsx:119`
- **Description:** `loadMore` callback includes `leads.length` in its dependency array, causing unnecessary recreation on every lead change. This triggers re-renders in components that depend on `loadMore`.
- **Recommendation:** Use a ref for `leads.length` or restructure the callback.

### M8. No Request Size Limits on Webhook Endpoints
- **Files:** All webhook route handlers
- **Description:** No explicit request body size limits. A malicious actor could send very large payloads to webhook endpoints, causing memory pressure.
- **Recommendation:** Add body size validation (e.g., reject > 1MB).

---

## Low Findings

### L1. Incomplete STOP Keyword Matching
- **File:** `src/app/api/webhooks/twilio/sms/route.ts:77`
- **Description:** TCPA keyword matching checks `bodyUpper === keyword || bodyUpper === "${keyword}ALL"`. Doesn't handle variations like "STOP ALL" (with space) or "STOP." (with punctuation).
- **Recommendation:** Trim and strip punctuation before comparing.

### L2. Business Enumeration via Error Messages
- **Files:** `src/app/api/webhooks/twilio/sms/route.ts:68`, `src/app/api/webhooks/telnyx/sms/route.ts:108`
- **Description:** "No business found for number" responses allow probing which phone numbers are configured. Low risk since these endpoints are signature-validated.

### L3. Verification Token Stored in Plaintext
- **File:** `supabase/schema.sql`
- **Description:** `verification_token` in `businesses` table is unencrypted. Low risk since it's ephemeral (used only during onboarding) and not exposed externally.

### L4. No Audit Logging for Sensitive Operations
- **Description:** No structured audit trail for billing changes, lead deletion, or settings modifications. Makes forensic analysis difficult after an incident.
- **Recommendation:** Add an `audit_log` table for critical operations.

### L5. Twilio Client Re-created Per Request
- **Files:** `src/app/api/webhooks/twilio/transcription/route.ts:125,157`
- **Description:** `twilio()` client instantiated per request instead of being cached. Minor performance overhead.
- **Recommendation:** Lazy-initialize a module-level client (same pattern as Stripe).

### L6. Incomplete Event Type Handling in Stripe Webhook
- **File:** `src/app/api/stripe/webhook/route.ts:75-76`
- **Description:** Only 4 Stripe event types handled; all others silently ignored. Events like `customer.subscription.paused` or `invoice.payment_succeeded` are not processed.
- **Recommendation:** Log unhandled event types for monitoring.

### L7. No Pagination Safety on RepairDesk Sync
- **File:** `src/app/api/repairdesk/sync/route.ts`
- **Description:** Page limit of 10 exists but is hardcoded and undocumented. If RepairDesk returns infinite pages, the endpoint would loop 10 times before stopping.

### L8. CORS Empty String Origin
- **File:** `next.config.ts:43`
- **Description:** `Access-Control-Allow-Origin: ''` (empty string) is not a valid CORS value. Should be omitted entirely or set to a specific origin.
- **Recommendation:** Remove the header or set to the application's origin.

---

## Summary of Changes Made

| File | Change | Severity Fixed |
|---|---|---|
| `src/lib/billing-guard.ts` | Changed fail-open to fail-closed on DB errors | CRITICAL |
| `src/app/api/cron/cleanup/route.ts` | Added timing-safe CRON_SECRET comparison | CRITICAL |
| `src/app/api/repairdesk/poll/route.ts` | Added timing-safe CRON_SECRET comparison | CRITICAL |
| `src/app/api/settings/route.ts` | Added Zod schema validation, fixed error message leakage | CRITICAL |
| `next.config.ts` | Removed `unsafe-inline` from script-src, added `base-uri`, `form-action`, `object-src` | HIGH |
| `src/lib/env.ts` | Made `STRIPE_WEBHOOK_SECRET` a required env var | HIGH |

---

## Architecture Strengths

1. **Row-Level Security**: Properly implemented on all tables with user-scoped policies
2. **Webhook Idempotency**: Atomic INSERT with unique constraint — industry best practice
3. **TCPA Compliance**: Fail-closed opt-out checks, STOP/START keyword handling, confirmation messages
4. **PII Redaction**: Phone numbers masked in structured logger output
5. **Twilio Signature Validation**: Present on all 3 webhook endpoints with proxy/ngrok support
6. **Stripe Monotonic Ordering**: Prevents out-of-order event processing
7. **Protect Stripe Columns Trigger**: Database-level guard against client-side billing manipulation
8. **Redirect Validation**: `getSafeRedirectPath()` blocks open redirect attacks in auth callback

---

## Recommendations (Priority Order)

1. **Add HMAC to transcription callback URL params** (H3) — defense-in-depth
2. **Remove admin client fallback in settings API** (H4) — fail fast
3. **Increase password minimum to 12 characters** (H5) — compliance
4. **Add rate limiting to verification endpoint** (M1) — cost control
5. **Add composite database indexes** (M3) — performance
6. **Normalize phone in checkOptOut()** (M4) — TCPA safety
7. **Encrypt RepairDesk API keys at rest** (M5) — data protection
8. **Make validateEnv() throw in production** (M6) — startup safety
9. **Fix useCallback dependency** (M7) — React performance
10. **Add audit logging table** (L4) — incident response
