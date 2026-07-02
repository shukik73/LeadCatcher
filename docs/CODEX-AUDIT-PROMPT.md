# LeadCatcher — Codex Audit Prompt (Simplicity · UI/UX · Security · Improvements)

> **How to use:** Give Codex access to this repository, then paste everything below
> the line into the task. Codex should work **read-only** and deliver a report —
> no code changes unless explicitly asked afterward.

---

You are a **principal engineer performing a holistic audit** of LeadCatcher, a
multi-tenant B2B SaaS that recovers missed calls for service businesses
(auto repair, HVAC, contractors): it texts back missed callers, transcribes and
AI-analyzes voicemails, and manages leads in a dashboard.

Audit the app across **four dimensions — Simplicity, UI/UX, Security, and
Improvements** — and produce one prioritized report.

## Operating rules

1. **Read-only.** Investigate via code reading and safe commands only
   (`npm run lint`, `npm run test`, `npx tsc --noEmit`, `git log`). Do not push
   changes, mutate data, or call live third-party APIs.
2. **Cite evidence.** Every finding must reference a concrete `path/file.ts:line`.
   No citation → the finding doesn't go in the report.
3. **Rate every finding** `Critical / High / Medium / Low / Info` (impact ×
   likelihood), and mark it **Confirmed** (verified in code/tests) or
   **Theoretical** (needs a live environment to prove — describe the test that would confirm it).
4. **Respect existing patterns.** When recommending a fix, point to an existing
   utility in `src/lib/` before inventing a new abstraction.
5. Follow the conventions in `AGENTS.md`.

## System context

- **Stack:** Next.js 16 App Router + React 19, Tailwind 4 + shadcn/ui (Radix),
  Supabase (Postgres + RLS + Auth + Realtime), Twilio/Telnyx (voice + SMS),
  Stripe (billing), OpenAI (call analysis), Upstash Redis (rate limiting).
- **Scale:** ~27k LOC in `src/`, **57 API routes** (`src/app/api/`), **19 pages**
  (`src/app/`), **38 components** (`src/components/`), ~46 lib modules
  (`src/lib/`), 33 test files (Vitest).
- **Key surfaces:**
  - Inbound webhooks: `src/app/api/webhooks/twilio/`, `src/app/api/webhooks/telnyx/`,
    `src/app/api/stripe/webhook/`, `src/app/api/verify/webhook/`
  - 10 cron jobs: `src/app/api/cron/*`
  - RepairDesk CRM integration: `src/app/api/repairdesk/*`, `src/lib/repairdesk.ts`
  - Security utilities: `src/lib/twilio-validator.ts`, `telnyx-validator.ts`,
    `csrf.ts`, `sms-rate-limit.ts`, `billing-guard.ts`, `redirect-validator.ts`,
    `url-validator.ts`, `webhook-common.ts`, `env.ts`, `src/middleware.ts`
  - Database: `supabase/migrations/` (11+ migrations), RLS policies in `supabase/schema.sql`
  - Dashboard pages: today, calls, hot-leads, followups, analytics, coaching,
    audit, settings, billing, customer (`src/app/dashboard/*`)

---

## Dimension 1 — Simplicity (can this app be smaller and clearer?)

The app has grown feature-by-feature (see `git log`). Hunt for accumulated
complexity that a rewrite-from-today would not include:

- **Route sprawl:** 57 API routes for a single-tenant-per-user CRM is a lot.
  Which routes are near-duplicates that could merge (e.g. the eight
  `api/calls/[id]/mark-*` / `log-*` / `add-note` action routes — could they be one
  `PATCH` endpoint or server actions)? Which routes are dead (no client caller —
  grep the frontend for each route path)?
- **Parallel implementations:** Twilio *and* Telnyx paths, `schema.sql` vs
  `schema-enhanced.sql` vs `supabase/migrations/` — is there one source of truth?
  Flag drift between them.
- **Dead code and stale flags:** unused lib modules, components no page imports,
  features gated off and never re-enabled, root-level audit artifacts
  (`AUDIT_*.md`, `tmpclaude-*` directories) that should be deleted or moved.
- **Over-abstraction / under-abstraction:** repeated auth+tenant-lookup+error
  boilerplate across API routes that belongs in one wrapper; conversely,
  wrappers that only one caller uses.
- **Cron consolidation:** 10 cron routes — do any share 80% of their logic or
  run on schedules that could be one job?
- For each finding, estimate deletable LOC. End with a table:
  **"Top 10 simplifications ranked by LOC removed × risk of change."**

## Dimension 2 — UI/UX (does the dashboard serve a busy shop owner?)

The user is a repair-shop owner glancing at a phone between customers. Audit
`src/app/dashboard/*` and `src/components/**` against that persona:

- **Information hierarchy:** is "Today" (`dashboard/today`) actually the fastest
  path to "which lead do I call back right now"? Count clicks-to-action for the
  top 3 jobs: return a missed call, reply to an SMS, mark a lead booked.
- **Navigation load:** 10 dashboard sections (today, calls, hot-leads, followups,
  analytics, coaching, audit, settings, billing, customer) — which overlap enough
  to merge? Is there a clear primary screen?
- **States:** for every page, verify loading, empty, and error states exist and
  are helpful (check for skeletons vs spinners vs nothing; empty states that
  explain the next step).
- **Mobile:** flag layouts that break under 400px width, tap targets < 44px,
  tables that don't collapse.
- **Feedback:** are mutations optimistic or do they block? Are errors surfaced
  via Sonner toasts consistently or silently swallowed (`catch {}` in components)?
- **Accessibility:** keyboard navigation on the inbox/call list, focus management
  in Radix dialogs, color-only status indicators (hot-lead badges), missing
  `aria-label`s on icon buttons (`lucide-react` usage).
- **Consistency:** date formats (`date-fns` usage), phone-number formatting
  (`src/lib/phone-utils.ts` used everywhere?), dark theme coverage after the
  recent dark-theme PR (#100), landing vs dashboard visual language.

## Dimension 3 — Security (multi-tenant SMS/billing app = high stakes)

Assume a hostile internet and a curious co-tenant. Verify, don't trust:

- **Tenant isolation:** for *each* of the 57 API routes, confirm the tenant
  scoping chain: session → business_id → query filter. Flag any route that
  accepts an ID (`calls/[id]/*`, `customer/timeline`, `audits/*`) and trusts it
  without verifying ownership. Cross-check RLS policies in
  `supabase/migrations/` — does any route use the service-role client
  (`supabase-server.ts`) where RLS would be bypassed?
- **Webhook authenticity:** Twilio signature validation (`twilio-validator.ts`)
  applied on *every* Twilio-facing route including status callbacks and
  transcription callbacks? Telnyx (`telnyx-validator.ts`) and Stripe
  (`stripe/webhook`) equivalents? Any webhook that returns data or mutates state
  before validation? Replay protection (`supabase/webhook-idempotency.sql` —
  actually enforced in code?).
- **Cron authentication:** how are `api/cron/*` routes protected (Vercel cron
  secret? `env.ts`)? Can an outsider trigger `followup` or `daily-digest` and
  cause SMS sends (= real money + TCPA exposure)?
- **SMS abuse & TCPA:** can a request loop force outbound SMS to an arbitrary
  number (toll fraud)? Is `sms-rate-limit.ts` enforced on every send path
  including `messages/send`, followup autosend, and review requests? STOP/opt-out
  respected on *all* send paths (`tcpa-compliance.sql`)?
- **Billing integrity:** can API access continue after subscription lapse
  (`billing-guard.ts` — applied to all paid routes)? Stripe webhook spoofing →
  free plan upgrade?
- **Injection & SSRF:** prompt injection from voicemail transcripts into OpenAI
  calls (`prompts.ts`, `ai-*.ts`) — can a caller's speech alter AI-drafted SMS
  content sent to the owner or lead? SSRF via RepairDesk URL config
  (`url-validator.ts` coverage). Open redirects (`redirect-validator.ts` applied
  at `auth/callback`?).
- **Secrets & headers:** secrets in client bundles (`NEXT_PUBLIC_*` misuse),
  missing security headers (`next.config.ts`, `vercel.json`), CSRF on server
  actions and state-changing routes (`csrf.ts` coverage), rate limiting on
  login/auth flows.
- Run `npm audit --omit=dev` and flag exploitable-in-context dependency issues only.

## Dimension 4 — Improvements (highest-leverage next steps)

Based on what you find, propose a ranked improvement plan:

- **Reliability:** what happens when Twilio/OpenAI/Upstash/RepairDesk is down or
  slow? Which webhooks lose data permanently vs retry (idempotency + queue)?
  Which cron failures are silent (`logger.ts` — does anything alert)?
- **Testing gaps:** 33 test files vs 57 routes — which *money-touching* paths
  (Stripe webhook, SMS send, billing guard) lack tests? Name the 5 tests to
  write first.
- **Performance:** N+1 query patterns in dashboard pages, missing pagination on
  list endpoints (`calls/list`), missing DB indexes for the hottest queries
  (compare against `supabase/indexes.sql`), client bundle weight (framer-motion
  on the dashboard?).
- **DX/Ops:** schema source-of-truth cleanup, typed Supabase client generation,
  environment validation completeness (`env.ts`), removal of root-level clutter.

Keep this section to the **10 highest-leverage items**, each with effort
(S/M/L) and expected payoff.

---

## Deliverable

A single markdown report — `CODEX_AUDIT_REPORT_<date>.md` — structured as:

1. **Executive summary** — ≤10 bullets, lead with the worst finding.
2. **Scorecard** — table: dimension | grade (A–F) | one-line justification.
3. **Findings** — grouped by dimension, each with: severity, confirmed/theoretical,
   evidence (`file:line`), impact, and recommended fix (pointing to existing
   utilities where possible).
4. **Top 10 action list** — cross-dimension, ordered by (severity × effort⁻¹),
   suitable for turning directly into GitHub issues.
5. **What was NOT verified** — anything requiring live credentials, a real
   Twilio number, or a production database, with the exact test to run.

Do not pad the report. A short, correct report beats a long, hedged one.
