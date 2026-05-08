# LeadCatcher — Complete Feature & Functional Audit Prompt

> Paste this entire prompt into Claude (or any capable coding agent with repo + browser access) to perform an end-to-end **functional audit** of LeadCatcher. The goal is NOT static code review — it is to **walk every feature like a real user**, identify what is broken, what is missing, and what is incomplete, then produce a prioritized fix list.
>
> A separate prompt (`AUDIT_PROMPT.md`) covers security and code-quality auditing. This prompt covers **does the product actually work end-to-end**.

---

## Your Role

You are a **senior QA engineer + product manager** auditing a production B2B SaaS. You will:

1. Read the codebase to map every advertised feature.
2. Boot the app locally (or against a staging Supabase project) and exercise each feature as a real user would.
3. Trigger every webhook, cron, and integration with realistic payloads.
4. Verify happy paths, error paths, empty states, edge cases, and integration boundaries.
5. Capture every bug, broken flow, missing piece, and confusing behavior with reproducible steps.
6. Deliver a prioritized fix list with concrete code-level fixes.

You must distinguish between three classes of finding:

- **BROKEN** — the feature exists in code/UI but errors, hangs, returns wrong data, or silently fails.
- **MISSING** — the feature is implied (button visible, copy promises it, docs reference it) but no implementation exists.
- **INCOMPLETE** — the feature partially works but has obvious gaps (no empty state, no error handling, no mobile layout, no loading state, no validation, etc.).

---

## Product Context

**LeadCatcher** is a SaaS for small service businesses (repair shops, contractors, HVAC, auto). It captures missed phone calls via Twilio, sends instant SMS responses, transcribes voicemails with OpenAI, and helps owners manage leads, follow-ups, audits, and coaching.

**Primary users:** Non-technical small business owners. Things must "just work."

**Tech stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase (Postgres + Auth + Realtime + RLS), Twilio (Voice/SMS/Transcription), OpenAI GPT-4o, Stripe (subscriptions), RepairDesk (CRM integration), Upstash Redis (rate limiting), Tailwind v4 + shadcn/ui, Vercel.

---

## Feature Inventory — Audit Every One

For each feature below, perform: **(a) happy-path test, (b) error-path test, (c) empty-state test, (d) mobile/responsive test, (e) accessibility quick-check (keyboard nav + screen reader labels).**

### A. Authentication & Onboarding
- [ ] Magic-link / OTP login (`/login`, `src/app/auth/callback/route.ts`)
- [ ] Logout flow + session expiry behavior
- [ ] Auth callback redirect handling (does `?next=` work? does it block open redirects?)
- [ ] Protected-route gate (does `/dashboard/*` actually redirect when logged out?)
- [ ] Onboarding wizard (`src/app/onboarding/`, `src/components/onboarding/Wizard.tsx`) — every step
  - Business info entry
  - Carrier selection + carrier-specific call-forwarding instructions
  - Twilio number linking
  - Call-forwarding setup instructions
  - **Verification test call** (`/api/verify`, `/api/verify/webhook`) ← *user reported this errors today*
  - "Back" navigation between steps
  - Resume onboarding after refresh
  - What happens if user partially completes then logs in again

### B. Phone & Call Flow (HIGH PRIORITY — user reported error)
- [ ] Inbound call to Twilio number → voice webhook fires (`src/app/api/webhooks/twilio/voice/route.ts`)
- [ ] Missed call → instant auto-SMS fires
- [ ] Voicemail recording → transcription webhook fires (`src/app/api/webhooks/twilio/transcription/route.ts`)
- [ ] AI analysis runs on transcript and populates `call_analyses`
- [ ] Call appears in `/dashboard/calls` list in real time (Supabase Realtime)
- [ ] Call detail panel opens with transcript, recording playback, summary
- [ ] **Verification test call from onboarding actually rings the user's phone** ← reproduce the reported error, capture exact error message, console logs, network response, and TwiML returned
- [ ] Test call from settings page (if one exists)
- [ ] Click-to-call / outbound dialing — is there a button? Does it work? If not, is it advertised anywhere?
- [ ] International phone numbers (E.164) — do they break anything?
- [ ] Phone normalization (`src/lib/phone-utils.ts`) — round-trip a few formats

### C. SMS / Messaging
- [ ] Inbound SMS webhook (`src/app/api/webhooks/twilio/sms/route.ts`)
- [ ] Outbound SMS from dashboard (`src/app/api/messages/send/route.ts`)
- [ ] AI-generated reply suggestions
- [ ] SMS templates (business hours + after hours presets) — do all 4+4 presets render correctly?
- [ ] `{{business_name}}` variable substitution
- [ ] Character counter in compose box
- [ ] Long messages (>160 chars) — segmenting, cost, truncation
- [ ] Special characters / emoji / non-ASCII
- [ ] TCPA opt-out keywords: STOP, UNSUBSCRIBE, CANCEL, END, QUIT — each one
- [ ] STOP confirmation message + opt-out persisted in `opt_outs` table
- [ ] Sending SMS to opted-out number is **blocked** (fail-closed)
- [ ] Telnyx fallback path (`/api/webhooks/telnyx/sms`)
- [ ] Rate limiting on send endpoint

### D. Lead Management & Dashboard
- [ ] `/dashboard` main view loads, shows widgets, no errors in console
- [ ] `/dashboard/calls` — list, filter, search, pagination
- [ ] Call detail panel actions: add note, assign owner, log contact, log outcome, mark booked, mark called, mark lost
- [ ] Bulk assign (`/api/calls/bulk-assign`)
- [ ] Real-time updates when a new call arrives during active session
- [ ] Empty state when user has zero leads
- [ ] `/dashboard/customer` — customer timeline, message history
- [ ] `/dashboard/actions` — action items / callbacks queue
- [ ] `/dashboard/followups` — smart follow-up scheduling
- [ ] `/dashboard/audit` — call audit tool, scoring, coaching notes submission (`/api/audits/submit`)
- [ ] `/dashboard/coaching` — per-employee coaching summaries
- [ ] `/dashboard/analytics` — funnel + recovery dashboards (`/api/analytics/funnel`, `/api/analytics/recovery`)
- [ ] Daily report generation (`/api/calls/daily-report`)

### E. Settings
- [ ] `/dashboard/settings` page loads (known issue: `fetchSettings` accessed-before-declaration — verify if fixed)
- [ ] SMS template editor — save business-hours + after-hours separately
- [ ] Business hours editor — every weekday, closed days, timezone selector
- [ ] DST boundary behavior
- [ ] RepairDesk API key entry + Test Connection button (`/api/repairdesk/test-connection`)
- [ ] Twilio webhook auto-configuration (`/api/twilio/configure-webhooks`)
- [ ] Per-section save buttons + success/error toasts
- [ ] Field validation (empty templates, invalid timezone, etc.)

### F. Billing (Stripe)
- [ ] `/dashboard/billing` page renders current plan + next billing date
- [ ] "Start free trial" → Stripe Checkout (`/api/stripe/checkout`)
- [ ] Successful subscription returns to billing page with active state
- [ ] "Manage billing" → Stripe portal (`/api/stripe/portal`)
- [ ] Stripe webhook (`/api/stripe/webhook`) — simulate `customer.subscription.created/updated/deleted`, `invoice.payment_failed`, `customer.subscription.trial_will_end`
- [ ] Trial-expired state — dashboard becomes read-only / blocks SMS sends
- [ ] Past-due banner appears + grace period behavior
- [ ] Billing-guard (`src/lib/billing-guard.ts`) blocks outbound SMS when subscription inactive
- [ ] Plan upgrade / downgrade flow
- [ ] Cancel + reactivation

### G. RepairDesk Integration
- [ ] Test connection with valid + invalid API key
- [ ] Customer sync (`/api/repairdesk/sync`) — pagination, large datasets, dedupe vs phone-based leads
- [ ] Missed-call polling cron (`/api/repairdesk/poll` + `/api/cron/repair-status`)
- [ ] 3-minute callback grace period
- [ ] Lookup ticket by phone (`/api/repairdesk/lookup-ticket`)
- [ ] Create customer (`/api/repairdesk/create-customer`)
- [ ] Add note + sync call (`/api/repairdesk/add-note`, `/sync-call`)
- [ ] Behavior when RepairDesk API is down or returns 5xx

### H. Cron Jobs (Vercel Cron)
Trigger each manually with proper `CRON_SECRET` and verify behavior + logs:
- [ ] `/api/cron/followup` — sends scheduled SMS, respects opt-outs, respects business hours
- [ ] `/api/cron/ai-audit` — batch scores pending calls
- [ ] `/api/cron/call-review` — pushes coaching notes to RepairDesk
- [ ] `/api/cron/daily-digest` — generates + emails digest
- [ ] `/api/cron/end-of-day` — cleanup/summaries
- [ ] `/api/cron/missed-call-watchdog` — alerts on missed follow-ups
- [ ] `/api/cron/repair-status` — polls RD ticket status
- [ ] `/api/cron/cleanup` — verify what it cleans
- [ ] Behavior with invalid / missing `CRON_SECRET` (must 401)

### I. Public / Marketing
- [ ] `/` landing page — Hero, HowItWorks, Pricing, FAQ all render
- [ ] All landing CTAs route correctly
- [ ] `/privacy`, `/terms` exist and render
- [ ] Footer links — flag any placeholder `#` links
- [ ] SEO basics: `<title>`, meta description, OG tags
- [ ] Mobile layout

### J. Cross-Cutting
- [ ] Console errors / warnings on every page (zero tolerance for red errors)
- [ ] Network tab — any 4xx/5xx, any failing fetches
- [ ] React hydration mismatches
- [ ] Loading states present for every async action
- [ ] Error states present for every async action
- [ ] Toast notifications fire correctly (success + error)
- [ ] Keyboard navigation works on every interactive element
- [ ] `aria-*` labels on icon-only buttons
- [ ] Focus management in dialogs, sheets, drawers
- [ ] Color contrast WCAG 2.1 AA
- [ ] Mobile breakpoints (375px, 768px, 1024px)
- [ ] Dark mode (if implemented) — no broken contrast

---

## Methodology — How To Actually Test

1. **Set up the environment.** Read `.env.example`. Confirm a working Supabase project, Twilio test creds, Stripe test mode keys, OpenAI key, Upstash creds. List any missing required env vars as a finding.

2. **Boot the app.** `npm install && npm run dev`. Capture any install warnings, build errors, type errors, or lint errors as findings.

3. **Run automated checks first** so you know the baseline:
   - `npm run typecheck` (or `tsc --noEmit`)
   - `npm run lint`
   - `npm test` — note any failing or skipped tests
   - `npm run build` — note any build warnings

4. **Walk every feature in the inventory above.** For each one:
   - Open the page / trigger the endpoint.
   - Capture screenshot or exact error if it breaks.
   - Open DevTools → Console + Network tab. Note any errors.
   - Try the empty state (no data).
   - Try the error path (invalid input, network offline, expired token).
   - Try mobile width.
   - Tab through with keyboard only.

5. **Webhooks — simulate real Twilio/Stripe payloads.** Use `twilio-cli`, `stripe trigger`, or signed `curl` requests. Verify:
   - Signature validation rejects unsigned requests with 403.
   - Idempotent replays don't double-charge or double-send.
   - Long voicemails / large transcripts don't time out (Twilio 15s limit).

6. **For the user-reported phone-call error specifically**:
   - Reproduce by clicking the verification test call in onboarding (and any other "call my phone" affordance you find).
   - Capture: exact UI error message, browser console output, server logs (`logger.ts` output), Twilio Debugger logs, the TwiML returned, the HTTP status.
   - Trace through `/api/verify/route.ts` → `/api/verify/webhook/route.ts` → `src/lib/twilio-validator.ts` → Twilio client config in `src/lib/env.ts`.
   - Common root causes to check: missing/invalid `TWILIO_PHONE_NUMBER`, wrong `APP_BASE_URL` (Twilio can't reach localhost without ngrok), missing webhook signature validation env, business record missing `twilio_phone_sid`, unverified Twilio caller ID on trial accounts, RLS blocking `businesses` row read.

7. **Cross-reference advertised features vs implemented features.** Read the landing page copy (`src/components/landing/`), pricing page, and any marketing claims. For every promise made to a customer, confirm the feature exists and works. Anything advertised but missing is a P0 trust issue.

8. **Database integrity.** Open Supabase. For each table verify: RLS enabled, policies exist, indexes present on filtered columns, no orphaned rows after a typical user flow, no PII leaking via public views.

---

## Output Format

Produce a single markdown report with this exact structure.

```markdown
# LeadCatcher Feature & Functional Audit Report
**Date:** YYYY-MM-DD
**Auditor:** [name/model]
**Commit SHA:** [git rev-parse HEAD]
**Environment:** local / staging / prod

## Executive Summary
- Features fully working: X / Y
- Features broken: X
- Features missing (advertised but unimplemented): X
- Features incomplete: X
- Top 5 user-impacting issues:
  1. ...
  2. ...

## Section 1: BROKEN Features
For each:
### B-01: [Short title]
- **Feature:** [name from inventory]
- **Severity:** P0 / P1 / P2 / P3
- **Repro steps:**
  1. ...
  2. ...
- **Expected:** ...
- **Actual:** ...
- **Error message / console output / network response:**
  ```
  [paste exact text]
  ```
- **Root cause:** [trace through code with file:line refs]
- **Suggested fix:**
  ```ts
  // file: src/path/to/file.ts:LN
  // before
  ...
  // after
  ...
  ```
- **Verification:** how to confirm fix works

## Section 2: MISSING Features
### M-01: [Short title]
- **Where it's referenced / advertised:** [URL or file:line]
- **What's expected to exist:** ...
- **What's actually there:** [nothing / placeholder / "Coming soon" / dead link]
- **User impact:** ...
- **Suggested implementation:** [scoped down to MVP]
- **Effort estimate:** S / M / L

## Section 3: INCOMPLETE Features
### I-01: [Short title]
- **Feature:** ...
- **What works:** ...
- **What's missing:** [no empty state / no error toast / no mobile layout / no validation / no loading state / accessibility gaps]
- **Suggested completion:** ...

## Section 4: Cross-Cutting Issues
- Console errors per page (table)
- Failing tests
- Build / typecheck / lint warnings
- Performance observations (slow pages, large bundles, N+1 queries)
- Accessibility violations

## Section 5: Prioritized Fix List
### P0 — Ship-blocking (fix today)
1. ...
### P1 — Fix this week
1. ...
### P2 — Fix this sprint
1. ...
### P3 — Backlog
1. ...

## Section 6: What Works Well
[Honest list of features that are solid — for morale and to avoid regressions]

## Appendix A: Reproduction Environment
- Node version, npm version, OS, browser
- Env vars set (names only, never values)
- Supabase project ref / region
- Twilio account type (trial / paid)
- Stripe mode (test / live)
```

---

## Guardrails

1. **Never invent issues.** Every finding must have a reproducible repro path or a code reference.
2. **Never guess fixes.** If you can't trace the root cause, say "needs investigation" rather than fabricate a fix.
3. **Use real payloads.** Test webhooks with realistic Twilio/Stripe samples, not empty bodies.
4. **Respect production data.** Run against a staging Supabase or branch DB. Never test billing flows against live Stripe.
5. **Don't fix while auditing.** This pass is read-only. Fixes happen after triage.
6. **Cite file:line for every code reference.**
7. **Distinguish "doesn't work in my environment" from "doesn't work for anyone."** Confirm env-var setup before flagging a feature broken.
8. **Assume nothing about the user.** If the onboarding wizard has a step they can't complete without external help, that's a P1.
9. **Don't duplicate `AUDIT_REPORT.md`.** Read it first; mark known issues as "previously documented" rather than re-reporting.
10. **Be ruthless about advertised-but-missing features.** A landing page that promises something the product can't do is a trust-destroying bug, not a content issue.

---

## Specific Investigation: The Phone-Call Error

The product owner reports: *"now when calling to the phone there is an error message."*

Treat this as **P0 finding #1**. Before submitting the audit:

1. Identify exactly which UI affordance triggers the call (verification test in onboarding? a button in `/dashboard/settings`? a click-to-call in the call detail panel?). Document where it lives.
2. Reproduce the error. Capture screenshot, exact text, browser console, server log line, and Twilio Debugger entry.
3. Trace the request: UI handler → API route → Twilio client → webhook callback. Identify where it fails.
4. Check the most common causes in order:
   a. `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` env present and valid
   b. `APP_BASE_URL` is publicly reachable (Twilio cannot hit localhost — needs ngrok or deployed URL)
   c. The verify webhook URL returns valid TwiML, not HTML/JSON
   d. Twilio signature validation isn't rejecting the callback (`src/lib/twilio-validator.ts`)
   e. The phone number being called is verified on the Twilio account (trial accounts only allow verified caller IDs)
   f. The `businesses` row has the expected `twilio_phone_sid` / `twilio_phone_number` columns populated
   g. RLS policy isn't blocking the server from reading the business record
   h. The TwiML response contains a valid `<Say>` or `<Dial>` element with a usable voice/number
5. Provide a one-line fix if obvious, or a diagnostic checklist for the engineer if not.

---

## Final Deliverable

A single file: `FEATURE_AUDIT_REPORT_<YYYY-MM-DD>.md` at the repo root, following the output format above. No extra files. No partial reports. If you cannot complete a section, note "blocked: [reason]" rather than skipping silently.
