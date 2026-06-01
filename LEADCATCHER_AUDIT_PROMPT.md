# LeadCatcher Full-Stack Audit Prompt

## About This App
LeadCatcher is a Next.js 16 App Router SaaS for phone repair shops (franchise model).

**Core workflow:** Missed phone call → auto-SMS to customer → customer replies → AI qualifies lead (device, issue, urgency) → owner/tech notified → RepairDesk updated → end-of-day report → Google review request after repair.

**Tech stack:** Next.js 16 (App Router, Turbopack), Supabase (Postgres, RLS, Auth), Twilio (SMS + Voice), OpenAI (GPT-4o + Whisper), Stripe (billing), RepairDesk (POS/ticketing), Vercel (hosting + cron), shadcn/ui + Tailwind CSS.

**Live URL:** https://www.leadcatcher.app
**Repo:** https://github.com/shukik73/LeadCatcher

---

## Audit Scope

Perform a comprehensive audit across ALL of the following categories. For each finding, provide:
- **Severity:** P0 (critical/data loss), P1 (high/broken workflow), P2 (medium/degraded UX), P3 (low/polish)
- **File + line number**
- **Problem description** (what's wrong and why it matters)
- **Recommended fix** (specific, not vague)

---

## 1. SECURITY AUDIT

### 1.1 Authentication & Authorization
- Verify every API route checks auth (`supabase.auth.getUser()`) before accessing data
- Verify business_id is always derived server-side from `user_id`, never accepted from client
- Check middleware.ts for proper route protection (dashboard/* requires auth)
- Check for any routes that expose data cross-tenant (business A seeing business B's data)
- Verify RLS policies on all tables (businesses, leads, messages, call_analyses, action_items, call_audits, ticket_status_tracking, review_requests, opt_outs, webhook_events, coaching_summaries, message_patterns)

### 1.2 Input Validation
- Every POST route should use Zod `.strict()` schemas
- Check for SQL injection vectors (raw string interpolation in queries)
- Check for XSS in any user-generated content rendered in React
- Verify phone numbers are normalized via `normalizePhoneNumber()` before DB storage
- Check that RepairDesk subdomain validation prevents SSRF (`url-validator.ts`)

### 1.3 Webhook Security
- Twilio webhooks validate signature via `validateTwilioRequest()`
- Stripe webhooks validate signature
- Telnyx webhooks validate Ed25519 signature
- Cron endpoints verify `CRON_SECRET` with timing-safe comparison
- Check if any webhook can be replayed (idempotency via `webhook_events` table)

### 1.4 Secrets & PII
- No API keys, tokens, or secrets hardcoded in source
- Phone numbers masked in logs (`logger.ts` PII redaction)
- RepairDesk API key not logged (only endpoint logged)
- No sensitive data in client-side bundles
- `.env.example` doesn't contain real values

### 1.5 CSRF Protection
- All POST routes from dashboard check `validateCsrfOrigin(request)`
- Webhooks are exempt (they have their own signature validation)

### 1.6 Rate Limiting & Abuse
- SMS rate limiting via `sms-rate-limit.ts` (per phone, per business)
- Check if any API route is missing rate limiting that could be abused
- Billing guard blocks SMS when subscription inactive

---

## 2. WORKFLOW & BUSINESS LOGIC AUDIT

### 2.1 Missed Call → SMS Flow
- Voice webhook (`/api/webhooks/twilio/voice`): creates lead, sends auto-reply, records voicemail, creates call_analyses record
- RepairDesk poll (`/api/repairdesk/poll`): backup path when Twilio forwarding fails. 15-min grace period, checks for return calls before sending SMS
- Verify: SMS only sent after Twilio confirms delivery (not logged before send)
- Verify: follow-up scheduled only after successful SMS send
- Verify: opted-out customers never receive SMS (fail-closed)
- Verify: billing-inactive businesses don't send SMS

### 2.2 Inbound SMS → AI Qualification
- SMS webhook (`/api/webhooks/twilio/sms`): receives customer reply, cancels follow-up, runs AI intent analysis
- AI auto-reply (`ai-auto-reply.ts`): generates context-aware reply when `auto_reply_enabled`
- Lead qualification (`lead-qualification.ts`): asks 2-3 qualifying questions (device, issue, urgency), forwards structured summary to owner
- Verify: STOP/START/CANCEL keywords handled before any processing (TCPA)
- Verify: qualification doesn't exceed 3 questions
- Verify: already-qualified leads don't get re-qualified

### 2.3 AI Call Audit
- AI audit cron (`/api/cron/ai-audit`): polls RepairDesk for all calls, transcribes via Whisper, scores quality (9 criteria), creates action items
- Call review cron (`/api/cron/call-review`): focused on device-specific RepairDesk notes
- Verify: watermark only advances when backlog fully drained
- Verify: deduplication prevents re-processing same call
- Verify: adaptive schedule works correctly (10min business hours, 30min evening, 90min overnight)

### 2.4 Follow-Up Cron
- Follow-up cron (`/api/cron/followup`): sends scheduled follow-up SMS
- Verify: atomic claim prevents double-send on concurrent cron runs
- Verify: max 1 follow-up per lead
- Verify: follow-up cancelled when customer replies

### 2.5 RepairDesk Integration
- Sync flow: calls → transcribe → AI audit → write notes to RD tickets
- Repair status updates (`/api/cron/repair-status`): polls ticket status changes, auto-SMS customers ("Your device is ready for pickup")
- Google review requests (`review-request.ts`): sends review SMS after repair completion, deduped per ticket
- Verify: RepairDesk API errors don't crash the app (non-blocking)
- Verify: customer/ticket lookups work correctly

### 2.6 Reports & Notifications
- Daily digest (`/api/cron/daily-digest`): 7 AM morning briefing SMS
- End-of-day report (`/api/cron/end-of-day`): pending items summary SMS
- Hot lead alerts (`hot-lead-alert.ts`): immediate owner SMS for high-urgency leads, deduped
- Verify: reports contain actionable info (device + issue + customer name)
- Verify: timezone handling is correct

### 2.7 Booking & Conversion
- Booking URL in SMS templates (`{{booking_link}}`)
- Recovery score API (`/api/analytics/recovery`): missed calls → SMS → replies → booked → revenue
- Analytics funnel (`/api/analytics/funnel`): conversion rates, employee leaderboard

---

## 3. UI/UX AUDIT

### 3.1 Dashboard Pages
Audit each page for completeness, usability, and mobile responsiveness:
- `/dashboard` — Inbox (missed calls list + conversation view)
- `/dashboard/calls` — Call Review (filters, detail panel, bulk assign)
- `/dashboard/followups` — Follow-Up Queue
- `/dashboard/coaching` — Coaching Dashboard
- `/dashboard/actions` — Action Items List (AI-generated tasks)
- `/dashboard/analytics` — Lead Conversion Funnel + Employee Leaderboard
- `/dashboard/customer` — Customer Timeline (unified history by phone)
- `/dashboard/audit` — Manual Phone Call Audit Form
- `/dashboard/settings` — Phone, SMS templates, business hours, RepairDesk, AI features, booking URL, Google review link
- `/dashboard/billing` — Stripe subscription management

### 3.2 Navigation
- Sidebar shows labels: Inbox, Calls, Follow-Ups, Coaching, Actions, Analytics, Customer, Audit, Settings, Billing
- Check: is 10 items too many? Should some be grouped?
- Mobile nav: hamburger menu works correctly
- Active state highlighting works for all routes

### 3.3 Onboarding
- 3-step wizard: business info → carrier → Twilio number linking → verification
- Check: can a new user complete onboarding without getting stuck?
- Check: error states are clear and recoverable

### 3.4 Landing Page
- `/` — Hero, How It Works, Pricing, FAQ, Footer
- Check: CTA is clear, pricing is visible, mobile layout works

### 3.5 Forms & Interactions
- Settings save correctly (per-section saves)
- Audit form: live score counter, quality switches
- Action items: start/complete/cancel buttons work
- Call detail panel: all actions (log contact, assign owner, add note, mark booked/lost, audit this call)
- Toast notifications for success/error states
- Loading skeletons/spinners during data fetches

### 3.6 Error Handling
- `/dashboard/error.tsx` error boundary exists
- API errors show user-friendly messages (not raw errors)
- Empty states: each page shows helpful message when no data
- Network failures handled gracefully

---

## 4. PERFORMANCE AUDIT

### 4.1 Database
- Check for missing indexes on frequently queried columns
- Check for N+1 query patterns in cron jobs
- Verify paginated queries use proper LIMIT/OFFSET with count
- Check if any query loads all rows into memory

### 4.2 API Routes
- All routes use `export const dynamic = 'force-dynamic'`
- No unnecessary data fetching (select only needed columns)
- Cron jobs have proper timeouts and error recovery

### 4.3 Frontend
- Client components use `"use client"` directive
- No unnecessary re-renders (useCallback/useMemo where needed)
- Images optimized (if any)
- Bundle size: any large dependencies that could be lazy-loaded?

---

## 5. COMPLIANCE AUDIT

### 5.1 TCPA (Telephone Consumer Protection Act)
- STOP/START/CANCEL/END/QUIT keywords handled
- Opt-out confirmation sent immediately
- Opted-out numbers never receive SMS (fail-closed on lookup error)
- Opt-out table (`opt_outs`) has proper unique constraints

### 5.2 Data Privacy
- User data scoped by business_id (multi-tenant isolation)
- RLS enforced on all tables
- No cross-tenant data leakage
- Account deletion: does CASCADE properly clean up?

### 5.3 Billing
- Stripe webhook handles: checkout complete, subscription update, subscription delete, payment failed
- `protect_stripe_columns` trigger prevents client-side tampering
- Billing guard blocks outbound SMS when subscription inactive
- Grace period for new businesses during onboarding

---

## 6. CODE QUALITY AUDIT

### 6.1 Architecture
- Consistent patterns across all API routes (auth → validate → business lookup → logic → response)
- Lib files are focused and single-purpose
- No circular dependencies
- Proper separation: lib/ (logic), api/ (routes), components/ (UI)

### 6.2 Error Handling
- All async operations wrapped in try/catch
- Non-blocking operations (RD sync, AI analysis) never crash the parent flow
- Webhook handlers use finally blocks to mark events as processed/failed

### 6.3 Testing
- 177 tests currently passing
- Check coverage: are critical paths tested?
- Missing tests for any new features?

### 6.4 TypeScript
- Strict mode enabled
- No `any` types in production code
- Zod schemas match database column types

---

## 7. INFRASTRUCTURE AUDIT

### 7.1 Vercel
- 8 cron jobs configured — verify Vercel plan supports this (Pro required for >2)
- Check for any route that might timeout (Vercel has 10s default for serverless, 60s for cron)
- Webhook routes need longer timeouts (Twilio waits for TwiML response)

### 7.2 Environment Variables
Required:
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
- TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
- STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
- CRON_SECRET (should be 32+ chars)
- APP_BASE_URL, NEXT_PUBLIC_APP_URL
Optional:
- OPENAI_API_KEY, OPENAI_MODEL
- UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
- TELNYX_API_KEY, TELNYX_PUBLIC_KEY
- TWILIO_WEBHOOK_URL (override for proxies)

### 7.3 Database Migrations
- Migrations 001-007 exist
- Verify all are idempotent (IF NOT EXISTS / DO $$ guards)
- Verify ordering: no migration references objects created in a later migration

---

## 8. FEATURE COMPLETENESS

### 8.1 Working Features (verify each)
- [ ] Missed call detection (Twilio voice webhook)
- [ ] Missed call detection (RepairDesk poll backup)
- [ ] Auto-SMS on missed call
- [ ] Customer SMS reply forwarded to owner
- [ ] AI auto-reply to customer
- [ ] AI lead qualification (3 questions)
- [ ] Hot lead alerts (high urgency → owner)
- [ ] Follow-up SMS (15 min after missed call)
- [ ] Call recording transcription (Whisper)
- [ ] AI call quality audit (9 criteria)
- [ ] Action items (AI-generated task list)
- [ ] RepairDesk notes (device-specific)
- [ ] Repair status auto-updates to customer
- [ ] Google review requests after repair
- [ ] Booking link in SMS ({{booking_link}})
- [ ] Daily morning digest (7 AM)
- [ ] End-of-day report (6-7 PM)
- [ ] Customer timeline (unified history)
- [ ] Lead conversion analytics + funnel
- [ ] Employee leaderboard
- [ ] Recovery score
- [ ] Manual phone call audit form
- [ ] Settings: SMS templates, business hours, timezone
- [ ] Settings: RepairDesk API connection
- [ ] Settings: AI features toggles (auto-reply, digest, status updates)
- [ ] Settings: booking URL + Google review link
- [ ] Stripe billing (checkout, portal, subscription management)
- [ ] Onboarding wizard (3 steps)
- [ ] TCPA compliance (opt-out/opt-in)

### 8.2 Missing / Incomplete Features
List anything that's partially built, has placeholder UI, or is referenced in code but not wired up.

---

## Deliverables

1. **Findings table** sorted by severity (P0 → P3) with file paths and line numbers
2. **Fix recommendations** for each finding (specific, not vague)
3. **Feature gaps** list with effort estimates (small/medium/large)
4. **Architecture diagram** of the current system (text-based)
5. **Priority action plan** — what to fix first for production readiness

---

## Rules
- Start by inspecting relevant files. Do not assume code matches prior descriptions.
- Be specific: cite file paths and line numbers.
- Distinguish between "broken" (P0/P1) and "could be better" (P2/P3).
- If something works but is fragile, call it out with the failure scenario.
- Do not suggest adding features — focus on fixing what exists.
- Run `npm test -- --run` and `npm run lint` and report results.
