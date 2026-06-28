# LeadCatcher — UI/UX Security & Feature-Testing Audit Prompt

> **What this is.** A complete, reusable prompt for an AI agent (or a human
> following the same structure) to run a systematic audit of LeadCatcher's
> **UI/UX**, **security workflows**, and **feature behavior**, and to produce a
> prioritized findings report. It is grounded in the real codebase (concrete file
> paths) so the output is actionable, not generic.
>
> **How to use it.** Give an AI coding agent access to this repository and paste the
> section **"PROMPT — paste from here"** below (or point the agent at this file).
> The agent should work read-only first, then propose fixes only when asked.

---

## PROMPT — paste from here

You are a **senior application security engineer and UX auditor**. Your job is to
audit the **LeadCatcher** codebase you have been given access to, covering security
workflows, UI/UX quality, and feature correctness, and to deliver a single
structured report.

### 0. Operating rules

1. **Read-only first.** Investigate by reading code and running read-only commands
   (`npm run lint`, `npm run test`, `npx tsc --noEmit`, `git log`). Do **not** mutate
   data, hit live third-party APIs, or push changes. Only propose patches if the user
   explicitly asks.
2. **Cite evidence.** Every finding must reference concrete `path/to/file.ts:line`
   locations. No claim without a citation.
3. **Rate severity** for each finding: `Critical / High / Medium / Low / Info`, using
   impact × exploitability. Note when a finding is theoretical vs. confirmed.
4. **No false confidence.** If you cannot verify something (e.g. RLS behavior that
   needs a live DB), say so and describe the test that *would* confirm it.
5. **Prefer reuse.** When recommending fixes, point to existing utilities in the repo
   rather than inventing new patterns.

### 1. System under test — context pack

LeadCatcher is a multi-tenant B2B SaaS that captures missed calls for service
businesses (auto repair, HVAC, contractors), auto-replies by SMS, transcribes and
AI-analyzes calls, and manages leads in a dashboard.

**Stack**
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS, shadcn/ui + Radix,
  Framer Motion, Sonner (toasts), React Hook Form + Zod.
- **Backend:** Next.js API routes (~57 routes) + server actions.
- **Database:** Supabase (PostgreSQL) with Row-Level Security (RLS).
- **Auth:** Supabase Auth (JWT in HTTP-only cookies).
- **Integrations:** Twilio (voice/SMS/transcription), Telnyx (alt SMS), Stripe
  (billing), OpenAI (analysis), RepairDesk (CRM), Upstash Redis (rate limiting).
- **Tests:** Vitest (~29 files), ESLint, `tsc`.

**Tenancy model.** One `auth.users` row → one `businesses` row (`businesses.user_id`
UNIQUE). All domain tables carry `business_id`. Isolation is enforced two ways:
(a) **RLS policies** keyed on `business_id IN (SELECT id FROM businesses WHERE
user_id = auth.uid())`, and (b) **manual ownership checks** in routes that use the
service-role admin client (which *bypasses* RLS).

**Key file map** (verify these as you go):
- `src/middleware.ts` — auth gate for `/dashboard/*` and `/onboarding/*`, auth-code
  redirect handling, IP rate limiting (user vs webhook buckets).
- `src/lib/supabase-server.ts` — server + **admin (service-role)** clients.
- `src/lib/supabase-client.ts` — browser client (RLS-respecting).
- `src/lib/csrf.ts` — `validateCsrfOrigin()` (Origin/Referer allowlist).
- `src/lib/redirect-validator.ts` — `getSafeRedirectPath()` (open-redirect guard).
- `src/lib/url-validator.ts` — SSRF guard (private-IP/metadata blocking, host allowlist).
- `src/lib/twilio-validator.ts`, `src/lib/telnyx-validator.ts` — webhook signature checks.
- `src/lib/webhook-common.ts` — webhook idempotency / event claiming.
- `src/lib/billing-guard.ts`, `src/lib/sms-rate-limit.ts` — subscription gate, SMS throttling.
- `src/lib/ai-service.ts` — OpenAI calls + output URL stripping.
- `next.config.ts` — security headers + CSP.
- `supabase/migrations/001_full_schema.sql` — core tables, RLS policies, Stripe/telephony
  column-protection triggers (plus `002`–`010` for later features).
- Representative routes: `src/app/api/messages/send/route.ts`,
  `src/app/api/audits/submit/route.ts`, `src/app/api/calls/bulk-assign/route.ts`,
  `src/app/api/stripe/webhook/route.ts`, `src/app/api/repairdesk/poll/route.ts`.
- UI entry points: `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`,
  `src/components/onboarding/Wizard.tsx`, `src/app/dashboard/**`.

### 2. Scope

**In scope:** UI/UX quality and accessibility; authentication & session workflows;
authorization & multi-tenant isolation; input validation and injection (UI→API);
CSRF/CORS/headers; webhook & integration security; rate limiting & abuse; feature
correctness end-to-end; client/server validation parity; secrets handling in code.

**Out of scope:** live penetration testing against Twilio/Stripe/Supabase/RepairDesk;
load/performance testing; any action that mutates production data; social engineering;
infrastructure/cloud-account configuration you cannot see from the repo.

### 3. Audit workstreams

For each check: state **what to verify**, **where to look**, and **how to confirm**.
Record a finding (or an explicit "verified OK") for each.

#### A. Authentication & session workflow
- Login / signup / forgot-password flows behave correctly and reveal no user
  enumeration. Look at `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`,
  `src/app/auth/reset-password/*`.
- `src/middleware.ts` actually protects **all** of `/dashboard/*` and `/onboarding/*`
  (no route bypasses the matcher); authenticated users are redirected away from `/login`.
- **Open redirect:** the `next`/redirect param is run through `getSafeRedirectPath()`
  (`src/lib/redirect-validator.ts`). Try `//evil.com`, `/\evil.com`, `https://evil.com`,
  `%2f%2fevil.com`, `/dashboard/../..`.
- Session expiry/refresh works; cookies are HTTP-only, `Secure`, `SameSite`. Logout
  fully clears the session.
- Password-reset tokens are single-use and time-bound (Supabase-managed — confirm the
  callback exchange in `auth/callback`).

#### B. Authorization & multi-tenant isolation
- **RLS coverage:** every domain table (`businesses`, `leads`, `messages`,
  `call_analyses`, `call_audits`, `action_items`, `coaching_summaries`, `opt_outs`,
  `webhook_events`, `message_patterns`, `ticket_status_tracking`, `review_requests`)
  has RLS enabled and policies scoped to the owner's `business_id`. Cross-check
  `supabase/migrations/001_full_schema.sql` and later migrations. Confirm
  `webhook_events` has RLS on but **no policies** (service-role only).
- **Admin-client ownership checks:** wherever `supabaseAdmin` is used (bypasses RLS),
  the route must independently verify the resource belongs to the caller's business.
  Audit the pattern in `src/app/api/messages/send/route.ts` and replicate the check
  across every `src/app/api/**` route. Flag any admin query that filters by an
  attacker-controlled id without an ownership join.
- **IDOR probing (by code review):** `/api/calls/[id]/*` (assign-owner, mark-called,
  mark-booked, mark-lost, add-note, log-contact, log-outcome), `/api/calls/bulk-assign`,
  `/api/action-items/update`, `/api/followups/drafts/[id]`. Confirm each validates that
  the `[id]` / array of ids belongs to the caller.
- **Protected columns:** Stripe/billing and telephony fields are guarded by DB triggers
  (`protect_stripe_columns*`). Confirm non-service-role users cannot set
  `stripe_*`, `verified`, `forwarding_number`, `twilio_sid`, `billing_exempt`.

#### C. Input validation & injection (UI → API)
- **Zod coverage & parity:** every mutating route parses input with a `.strict()` Zod
  schema; client-side React Hook Form rules match server rules (a stricter server is
  fine, a looser one is a finding). Spot-check `audits/submit`, `messages/send`,
  `settings`, `bulk-assign`, `action-items/update`.
- **Stored XSS:** trace user-controlled free-text from storage to render. High-risk
  fields: `messages.body` (SMS), `owner`, call notes, RepairDesk-sourced names/devices,
  audit `improvements`/`store_name`. Confirm React's default escaping is never bypassed
  with `dangerouslySetInnerHTML`; confirm no field is injected into TwiML/HTML/email
  templates unescaped.
- **SSRF:** any outbound fetch built from user input (RepairDesk store URL, webhook
  overrides) goes through `src/lib/url-validator.ts`. Try private IPs, `169.254.169.254`,
  non-HTTPS, odd ports, non-`repairdesk.co` hosts.
- **Phone handling:** all phone inputs normalized via `normalizePhoneNumber()`
  (`src/lib/phone-utils.ts`) before use in Twilio calls / DB lookups.
- **AI prompt injection:** transcripts/summaries feed OpenAI in `src/lib/ai-service.ts`.
  Confirm post-response URL stripping and that AI output is never executed or trusted as
  a redirect/command. Note the weak pre-prompt filtering as a finding if present.
- **SQL injection:** confirm all DB access goes through Supabase query builder
  (parameterized) — flag any raw SQL string interpolation.

#### D. CSRF, CORS & headers
- `validateCsrfOrigin()` (`src/lib/csrf.ts`) is called on **every** state-changing
  user-facing route (POST/PUT/PATCH/DELETE). Build a checklist of all mutating routes
  and confirm coverage; webhooks/cron are exempt (they use signatures / `CRON_SECRET`).
  Confirm it fails **closed** in production.
- **CSP review** in `next.config.ts`: note `script-src 'unsafe-inline'` /
  `style-src 'unsafe-inline'` as an XSS-mitigation weakness; recommend nonce/hash-based
  CSP. Confirm HSTS, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, and that no API route sets a permissive `Access-Control-Allow-Origin`.

#### E. Webhook & integration security
- **Twilio:** `validateTwilioRequest()` (HMAC) on every `/api/webhooks/twilio/*`;
  returns 403 on bad signature.
- **Telnyx:** ed25519 signature + timestamp replay window (≤5 min) in
  `src/lib/telnyx-validator.ts`.
- **Stripe:** `stripe.webhooks.constructEvent()` signature check + idempotency
  (`webhook_events`) + monotonic ordering so stale events don't overwrite newer state
  (`src/app/api/stripe/webhook/route.ts`).
- **Cron:** all `/api/cron/*` and `/api/repairdesk/poll` require `CRON_SECRET` via a
  **timing-safe** comparison. Confirm no cron endpoint is reachable unauthenticated.
- **Idempotency races:** review `claimWebhookEvent()` (`src/lib/webhook-common.ts`) for
  double-processing under concurrent identical events.
- **Secrets:** confirm `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
  `TWILIO_AUTH_TOKEN` are server-only (never `NEXT_PUBLIC_*`, never sent to client).
  **Flag:** `businesses.repairdesk_api_key` stored in plaintext, and the RepairDesk key
  passed as a query param rather than a header.

#### F. Rate limiting & abuse
- Upstash buckets in `src/middleware.ts` (40/10s user, 60/10s webhook). Note the
  **fail-open** behavior when Redis is unavailable as an abuse/cost risk.
- SMS throttling per-lead and per-business (`src/lib/sms-rate-limit.ts`).
- **TCPA:** inbound STOP/UNSUBSCRIBE keywords create `opt_outs` rows and outbound sends
  are blocked for opted-out numbers. Confirm `messages/send` and the SMS webhook both
  honor opt-outs and that only service-role can write `opt_outs`.
- Cron endpoints have no per-endpoint rate limit — note as a finding.

#### G. Feature workflow testing (end-to-end behavior)
For each, write a step-by-step test script and expected result; verify by code trace
(and locally where feasible):
1. **Missed call → auto-reply → inbox:** Twilio voice webhook creates lead, sends
   business-hours-aware SMS, thread appears in `/dashboard` via realtime.
2. **Hot-leads queue:** prioritization by urgency/due date; inline booked-value input
   records `conversion_value`; quick actions (Called/Booked/No Answer/Lost) disable
   during the request and surface toasts.
3. **Call analysis / coaching / audit:** AI summary, sentiment, urgency, category;
   coaching notes; manual audit scoring totals are correct.
4. **Follow-up drafts:** AI-generated drafts require approval before send; auto-send
   gating respects settings.
5. **Onboarding wizard** (`src/components/onboarding/Wizard.tsx`): 3 steps, phone
   normalization, carrier code selection, verification; cannot skip steps.
6. **Settings** (`src/app/dashboard/settings/page.tsx`): SMS templates with variables
   (`{{first_name}}`, `{{business_name}}`), business hours per day, timezone validation.
7. **Billing:** checkout, customer portal, trial tracking, and that SMS send is gated by
   `checkBillingStatus()` when the subscription is inactive.

#### H. UI/UX quality & accessibility
- **States:** loading skeletons (`DashboardSkeleton`), spinners + disabled buttons during
  requests, empty states, error toasts with retry (Sonner), graceful degradation when a
  non-critical API fails.
- **Realtime/optimistic races:** check `selectedLeadRef`-style patterns in the dashboard
  for stale-closure / out-of-order update bugs in Supabase subscriptions.
- **Responsive:** mobile Sheet sidebar vs. desktop fixed sidebar; grid/flex breakpoints;
  touch-target sizes; horizontal overflow on tables (`calls-table`).
- **Accessibility (WCAG 2.1 AA):** form labels (`htmlFor`), `aria-invalid` on errors,
  `aria-label` on icon buttons, focus-visible rings, keyboard navigation of Radix
  components, color-contrast of badges, `role` usage (`listbox`, `progressbar`).
  Flag decorative images/blobs missing `alt=""` and any focus traps.
- **Destructive actions:** confirm irreversible actions (mark-lost, bulk operations)
  have confirmation and clear feedback.

### 4. Methodology & tooling

1. Read `README`, `package.json`, `next.config.ts`, `.env.example`, and the migrations.
2. Run `npx tsc --noEmit`, `npm run lint`, `npm run test` — record failures.
3. Enumerate all `src/app/api/**/route.ts` and build a **coverage matrix**: for each
   route note auth check, ownership check, CSRF check, Zod validation, rate limit.
4. Trace each high-risk free-text field from input → storage → render.
5. Note **test gaps** vs. the existing ~29 Vitest files: API-route auth, CSRF, RLS
   enforcement, Zod schemas, and Stripe webhook ordering are largely untested.
6. Where a live DB is available, write throwaway tests that attempt cross-tenant reads
   with a second user's JWT to confirm RLS — otherwise mark as "needs live verification."

### 5. Required output format

Produce a single report with:

- **Executive summary** — overall posture, top 5 risks, top 5 UX issues.
- **Coverage matrix** — table of API routes × (authN, authZ/ownership, CSRF, Zod, rate
  limit) with ✅/❌/N-A.
- **Findings** — one row per finding:

  | ID | Title | Severity | Workstream | Location (`file:line`) | Repro / PoC | Impact | Remediation (reuse existing util where possible) |
  |----|-------|----------|-----------|------------------------|-------------|--------|--------------------------------------------------|

- **Verified-OK list** — controls you confirmed are working, so the report shows breadth.
- **Feature recommendations** — see section 6.

---

## 6. Feature recommendations (prioritized & detailed)

Recommendations are tied to gaps surfaced by the audit above. Each lists the **problem
it solves**, **rationale**, **priority**, and **rough effort** (S ≤ 1 day,
M ≈ 2–4 days, L ≈ 1–2 weeks).

### P0 — Do first (security / data-protection critical)

1. **Encrypt RepairDesk API keys at rest.** *(Effort: M)*
   - **Problem:** `businesses.repairdesk_api_key` is stored in plaintext; a DB read
     exposes every tenant's CRM credentials.
   - **Rationale:** Highest-blast-radius secret in the data model. Move to Supabase
     Vault (or app-layer envelope encryption) and pass the key via an `Authorization`
     header instead of a URL query param to avoid logging/TLS-proxy leakage.

2. **Output-escaping / sanitization pass for user free-text.** *(Effort: S–M)*
   - **Problem:** SMS bodies, `owner`, notes, and RepairDesk-sourced strings flow to the
     dashboard, TwiML, and emails; any non-React render path is a stored-XSS vector.
   - **Rationale:** Centralize an escaping/sanitizing helper and enforce it on all
     non-JSX sinks; add a lint rule banning `dangerouslySetInnerHTML`.

3. **Security activity log / audit trail.** *(Effort: M)*
   - **Problem:** No record of security-relevant actions (logins, settings changes,
     billing/telephony changes, bulk operations, opt-out writes).
   - **Rationale:** Required for incident response and abuse detection; an append-only
     `audit_log` table (service-role-write, owner-read RLS) closes the gap and supports
     the dashboard work in P2.

### P1 — Next (hardening & coverage)

4. **Team accounts + role-based access control.** *(Effort: L)*
   - **Problem:** The model is one user per business; `owner` is unvalidated free-text.
   - **Rationale:** Real shops have multiple staff. Introduce a `business_members` table
     with roles (owner/manager/tech/front-desk), update RLS to membership-based, and turn
     `owner`/`assigned_to` into references to real members (also removes an XSS surface).

5. **Two-factor authentication (MFA).** *(Effort: M)*
   - **Problem:** Email+password only.
   - **Rationale:** Supabase supports TOTP MFA; low-cost protection for accounts that
     control customer PII and outbound SMS.

6. **Nonce-based CSP (drop `'unsafe-inline'`).** *(Effort: M)*
   - **Problem:** `script-src/style-src 'unsafe-inline'` neuters CSP as an XSS backstop.
   - **Rationale:** Adopt per-request nonces (Next.js middleware) so a stored-XSS payload
     cannot execute even if escaping is missed.

7. **Rate-limit hardening.** *(Effort: S)*
   - **Problem:** Upstash fails open; cron endpoints have no per-endpoint limit.
   - **Rationale:** Add a configurable fail-closed mode for sensitive routes and
     per-endpoint cron throttles to bound abuse if `CRON_SECRET` leaks.

8. **Expand automated test coverage for security controls.** *(Effort: M)*
   - **Problem:** API-route auth, ownership checks, CSRF, RLS, and Zod schemas are
     largely untested.
   - **Rationale:** Add route-level integration tests (auth/ownership/CSRF), a Supabase
     RLS test harness (cross-tenant reads must fail), and Stripe webhook-ordering tests.

### P2 — Later (UX & compliance)

9. **In-app notification center.** *(Effort: M)* — surface hot leads, overdue callbacks,
   billing/CSV alerts beyond toasts; pairs with the audit log.
10. **Data export with PII controls.** *(Effort: M)* — CSV/JSON export of leads/calls,
    gated by role and recorded in the audit log.
11. **Account deletion & data-retention self-service (GDPR/CCPA).** *(Effort: M)* —
    user-initiated deletion + configurable retention/auto-purge of transcripts and PII.
12. **Session & device management UI.** *(Effort: S–M)* — view/revoke active sessions
    using Supabase session APIs.
13. **Admin/ops dashboard.** *(Effort: L)* — internal view over `webhook_events`, failed
    sends, cron health, and the audit log for support and reliability.

---

## Appendix — quick command reference

```bash
npm run dev          # local dev server
npm run build        # production build
npm run test         # Vitest
npm run lint         # ESLint
npx tsc --noEmit     # type check
```

Existing security-relevant tests to learn the patterns from:
`src/lib/twilio-validator.test.ts`, `src/lib/url-validator.test.ts`,
`src/lib/redirect-validator.test.ts`, `src/lib/sms-rate-limit.test.ts`,
`src/lib/stripe-webhook.test.ts`, `src/lib/middleware.test.ts`.
