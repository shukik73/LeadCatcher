# LeadCatcher Audit Report — 2026-07-02

Holistic read-only audit across **Simplicity · UI/UX · Security · Improvements**,
run against commit `6599f28` (branch `claude/codex-audit-prompt-2pq3ij`) per
`docs/CODEX-AUDIT-PROMPT.md`. Findings are backed by `file:line` citations and
marked **Confirmed** (traced in code) or **Theoretical** (needs a live
environment to prove).

**Baseline checks (run during this audit):** `tsc --noEmit` clean · `vitest`
251/251 pass (33 files) · `eslint` 0 errors, 13 warnings (unused imports) ·
`npm audit --omit=dev` 4 vulns (2 high in `undici`, used directly in
`call-transcriber.ts`; non-breaking fix available).

---

## 1. Executive summary

1. **A Redis blip silently drops every missed call.** When Upstash errors, the
   middleware returns **503 to Twilio webhooks** (`middleware.ts:108-111`). Twilio
   voice requests don't retry the primary handler, so the caller hears an error and
   **no lead or auto-reply is ever created** — a direct failure of the product's
   one promise ("never lose a lead"). *High.*
2. **STOP opt-out can silently fail while telling the customer they're
   unsubscribed.** The `opt_outs` upsert error is never checked before sending the
   "You have been unsubscribed" text and marking the event processed
   (`webhooks/twilio/sms/route.ts:92-115`). A DB blip → the customer believes they
   opted out, but automated SMS keep coming. **Direct TCPA liability.** *High.*
3. **Webhook retry can re-send duplicate SMS to customers.** The reclaim path
   (`webhook-common.ts:58-79`) reprocesses a `failed` event fully, but the auto-reply
   send happens long before the event is marked processed
   (`voice/route.ts:144` vs `:267`) — any throw in between means the retry texts the
   customer again. *High.*
4. **No outbound-HTTP timeouts → the inverse failure: events lost forever.**
   RepairDesk/Telnyx `fetch` calls have no `AbortSignal`; OpenAI clients use SDK
   defaults (10-min). A hang trips Vercel's function kill, leaving `webhook_events`
   stuck in `processing`, which the reclaim logic then treats as a duplicate and
   **permanently drops** the voicemail/lead. *High.*
5. **Nothing alerts.** `logger.ts` writes to console only; `error.tsx:16` has a
   "would send to Sentry" comment that was never wired. Every failure above, plus
   ~15 silent cron failures, is invisible in production. *High.*
6. **Cron digests can send owners plausible-but-wrong "0 calls today" reports** —
   `daily-digest`/`end-of-day` never check `.error` on their stat queries
   (`cron/daily-digest/route.ts:81-113`). *Medium.*
7. **UI: replying to an SMS — the core recovery action — isn't reachable from the
   Today screen** (`today/page.tsx:427-457`); it costs 3-5 taps and a context switch
   on mobile. And the Today "X" button **silently marks a lead LOST** with no
   confirmation or undo, one mis-tap away from the green "Booked" button. *High (UX).*
8. **"Mark booked" exists in 4 places across 3 different data models**, so revenue
   KPIs disagree with each other (Inbox writes `leads.status`; Today/Queue write
   `call_analyses` via `mark-booked`; FollowUp queue omits value capture entirely).
   *High (UX).*
9. **Tenant isolation is solid.** All 8 `calls/[id]/*` routes and every
   ID-accepting endpoint verify ownership through one consistent pattern; all tables
   have RLS; service-role usage is compensated everywhere. **No cross-tenant vuln.**
10. **~4,300-4,700 LOC is safely removable** — dominated by committed root junk
    (~2,050 LOC of stale audit `.md` + 14 `tmpclaude-*` files) and three drifting
    schema sources (~583 LOC) that the applied `migrations/` already supersede.

**Nothing Critical.** The externally-reachable *auth* surface (webhook signatures,
cron secrets, tenant scoping, billing) is unusually well-hardened; the real risk
is **reliability and silent data loss**, not access control.

---

## 2. Scorecard

| Dimension | Grade | Justification |
|---|---|---|
| **Security — access control** | **A−** | No cross-tenant vuln; all webhooks signature-validated, all crons timing-safe secret-gated, billing server-derived. Only Low/Info hardening left. |
| **Security — abuse/TCPA** | **B−** | STOP-persistence-not-checked (High) and STOP/START confirms bypass the rate limiter drag it down; opt-out enforced on all *send* paths otherwise. |
| **Reliability** | **C** | Core capture path fails on a Redis blip; duplicate-send and lost-event races; no timeouts; zero alerting. |
| **UI/UX** | **B−** | Genuinely fast "wall-board" Today screen, consistent toasts, good a11y basics — but the #1 action is buried, a destructive action is unguarded, and 4 screens overlap. |
| **Simplicity** | **C+** | One clean auth pattern, but 57 routes with copy-pasted preamble, a dead Telnyx path, 3 schema sources, and ~2k LOC of committed junk. |
| **Testing** | **B−** | 251 tests, strong on webhooks/validators — but money/compliance paths (Stripe ordering, reclaim-resend, opt-out failure, tenant isolation on calls API) untested. |

---

## 3. Findings by dimension

### 3A. Reliability & data integrity

**[High][Confirmed] Redis outage → 503 to Twilio webhooks → missed calls lost.**
`middleware.ts:104-112` fails closed for webhook paths on any rate-limiter error.
Stripe retries 5xx; Twilio voice does **not** retry the primary handler, so a
transient Upstash error drops the call permanently.
*Fix (S):* fail **open** for Twilio paths (signature validation is the real auth) —
fail closed only for Stripe if desired.

**[High][Confirmed] STOP opt-out persistence never verified.**
`webhooks/twilio/sms/route.ts:92-99` `await`s the `opt_outs` upsert but discards its
result, then sends the unsubscribe confirmation (`:106`) and `markWebhookProcessed`
(`:115`) unconditionally. Supabase returns errors, not throws — a failed write is
invisible and the customer keeps getting SMS.
*Fix (S):* destructure `{ error }`; on failure skip the confirmation and return 500
so the event is reclaimable.

**[High][Confirmed] Webhook reclaim replays SMS side-effects → duplicate texts.**
`webhook-common.ts:58-79` reclaims `failed → processing` and reprocesses fully; the
auto-reply is sent at `voice/route.ts:144` but the event isn't marked processed until
`:267`. A throw in between re-sends on retry. Worse, if the throw preceded the
`messages` insert (`:196-206`), the rate limiter (which counts `messages` rows) never
saw the first send. Same shape in `transcription/route.ts` and `sms/route.ts`.
*Fix (M):* record send-completion per event (e.g. `webhook_events.sms_sent_at`)
before replaying, or split "claim send" from "claim event".

**[High][Confirmed] No outbound-HTTP timeouts → stuck `processing` → lost events.**
RepairDesk `repairdesk.ts:237` and Telnyx `telnyx/sms/route.ts:21` use bare `fetch`;
8 OpenAI clients use SDK defaults. Only `call-transcriber.ts:26` sets a timeout. A
hang → Vercel kill → `finally` never runs → event stuck `processing` → reclaim treats
retries as duplicates → voicemail/lead silently dropped.
*Fix (S):* `AbortSignal.timeout()` on RD/Telnyx; `timeout`/`maxRetries` on OpenAI
clients. *(M)* sweeper to fail events stuck `processing > N` minutes.

**[High][Confirmed] No error alerting anywhere.**
`logger.ts:45-66` is console-only; `error.tsx:16` Sentry is unimplemented. Vercel
cron failures page nobody.
*Fix (S):* Slack webhook in `logger.error` (or Sentry) + Vercel cron monitors.

**[High][Confirmed] Silent cron failures send wrong owner reports.**
`daily-digest/route.ts:81-113` and `end-of-day:83-103` never check `.error` on stat
queries → a DB failure yields a plausible "0 calls today" digest. `ai-audit:353-358`
can freeze a business's watermark forever; all batch crons swallow per-business errors
and return 200.
*Fix (M):* check `.error` wherever stats feed customer-facing output; return non-2xx
on whole-business failure.

**[Medium][Confirmed] Claim-before-send loses owner alerts on a Twilio blip.**
`hot-lead-alert.ts:29-36` and `owner-no-reply-alert.ts` set the "sent" claim column
*before* the Twilio call; a send failure is never rolled back → alert silently lost,
no retry. *Fix (S):* clear the claim in the catch, or use a short lease.

**[Medium][Confirmed] RepairDesk defects:** `poll/route.ts:293-300` `checkForCallback`
fails **open** (texts customers who already got a callback when RD is down);
`poll:185-193` can leave leads stuck in `Processing` on a crash (no sweeper);
`sync-call:119-136` writes `rd_synced_at` even when the note POST failed (note lost,
future syncs short-circuited); `repairdesk-auto-sync.ts:59-69` has no dedupe guard →
duplicate RD notes. *Fix (S each).*

**[Low][Confirmed]** OpenAI failure degrades gracefully — the lead is created before
any AI runs (`voice/route.ts:163`, fallbacks in `ai-service.ts:59-66`). *Good.*
Stripe webhook is the best-engineered surface (signature + idempotent claim +
monotonic-ordering guard + reton-500, `stripe/webhook/route.ts:39-122`). *Good.*

### 3B. Security

**[Low][Confirmed] STOP/START confirmations bypass rate-limit + billing guard.**
`webhooks/twilio/sms/route.ts:104-113` (and Telnyx `:135-166`) call
`messages.create` directly, unlike every other send path. An attacker alternating
STOP/START forces one billed reply per inbound (1:1, to their own number — bounded
cost, not fan-out). *Fix (S):* gate the START confirmation behind the existing
`checkSmsRateLimit`.

**[Low][Theoretical] Prompt-injected lead fields reach the owner SMS un-stripped.**
`ai-receptionist.ts:136` strips URLs from the customer reply but not from the
extracted `device`/`issue` fields (`:138-143`), which flow raw into the owner alert
(`lead-qualification.ts:158-173` → `sms/route.ts:346`). The parallel `analyzeIntent`
path already defends this (`ai-service.ts:51-55`). *Fix (S):* reuse `stripUrls` on the
extracted fields.

**[Low][Confirmed] Unauthenticated Twilio server actions.**
`actions/twilio.ts:169` `verifyTwilioPhoneNumber` and `:130` `autoLinkTwilioNumber`
call Twilio before any `auth.getUser()` — `'use server'` exports are public POST
endpoints, so an anonymous caller can probe the platform Twilio account and burn
quota. No tenant DB data exposed. *Fix (S):* add the `auth.getUser()` guard already
used in `linkTwilioNumberToBusiness` (`:267-275`).

**[Low][Theoretical] `syncAuditToRepairDesk` fetches an audit without a tenant
filter.** `audit-rd-sync.ts:34-38` takes `businessId` but doesn't apply it to the
`call_audits` fetch. Both current callers verify ownership first, so not exploitable
today. *Fix (S):* add `.eq('business_id', businessId)` — defense-in-depth.

**[Low][Confirmed]** CSP allows `script-src 'unsafe-inline'` (`next.config.ts`) — a
common Next.js tradeoff; no injection sink found. Auth flows rely on Supabase's
built-in rate limiting (no app-layer throttle) — acceptable, worth confirming
Supabase Auth limits are enabled.

**Verified clean:** all webhooks validate signatures before mutation; idempotency is
enforced in code (`webhook-common.ts:25-50`, atomic `23505` claim); all 10 crons +
`repairdesk/poll` use `timingSafeEqual` on `CRON_SECRET` and fail closed; every SMS
send path enforces billing + opt-out + rate-limit and targets only DB-scoped numbers
(no arbitrary-number send); Stripe plan is derived server-side; RepairDesk URLs pass
`validateRepairDeskUrl` (SSRF-safe); auth callback uses `getSafeRedirectPath`.
**Tenant isolation: no Critical/High** — all 8 `calls/[id]/*` routes funnel through
`updateCallAnalysis` (`call-actions.ts:16-69`) with `.eq('business_id')` + RLS; every
table has RLS with no `USING(true)`; 27 service-role usages all compensated; DB
triggers block client tampering with billing/telephony columns.

### 3C. UI/UX (persona: shop owner on a phone between customers)

**[High][Confirmed] "Reply to SMS" not reachable from Today's lead cards.**
`today/page.tsx:427-457` offers only Call / Booked / X. Since the flow is SMS-first,
replying costs 3-5 taps via Inbox — which uses a *different* entity (`leads`) than
Today (`call_analyses`), so the lead isn't pre-selected; desktop auto-select is
explicitly skipped under 768px (`page.tsx:101-103`). *Fix:* add a per-card Text button
deep-linking `/dashboard?lead=<id>`.

**[High][Confirmed] Today's "X" silently marks the lead LOST.**
`today/page.tsx:253-268` POSTs `mark-lost`; the button is a 28px ghost icon
(`:449-456`) beside the green Booked button, with no confirm, undo, or toast. Mis-taps
are unrecoverable and pollute recovery-rate analytics. *Fix:* toast-with-Undo (sonner
supports `action`) or a distinct "dismissed" status.

**[High][Confirmed] "Mark booked" — 4 places, 3 data models.**
Inbox Select writes `leads.status` (no value); Today/Queue write `call_analyses` via
`mark-booked` (value captured); FollowUp queue uses `log-outcome {booked}` with **no
value prompt** (`followup-queue.tsx:145`); CallDetailPanel captures value
(`call-detail-panel.tsx:326`). Booking in the Inbox never reaches Today's "Jobs
booked" KPI → revenue numbers disagree. *Fix:* one booked pathway with value capture
everywhere.

**[High][Confirmed] Four screens answer "who do I chase?" with overlapping data.**
Today, Queue (`/hot-leads`), Follow-Ups, and Actions draw from overlapping feeds; the
same `<FollowUpDrafts/>` card renders on two pages (`hot-leads:191`, `followups:77`).
*Fix:* merge Follow-Ups + Actions into Queue (tabs); keep Today as the capped triage
view; target 5-6 nav destinations (currently 12).

**[High][Confirmed] Calls page is a 10-column table with no responsive collapse**
(`calls-table.tsx:35-152`) — sideways-scroll on a phone. *Fix:* card layout under
`md:` (pattern already exists in hot-leads/followups).

**[Medium] Silent/toast-only failures masquerade as "all clear."** Follow-Ups renders
"All caught up!" on fetch *error* (false positive); Settings silently renders factory
defaults on a failed load (`settings:100-158`) that a Save then persists over real
data; Audit list has `catch { /* silent */ }` (`:109-111`). *Fix:* inline error +
Retry (the Today/Queue pattern already in the repo).

**[Medium] Sub-44px tap targets** on outcome buttons (`h-7` = 28px across hot-leads/
followups) with destructive actions adjacent to positive ones. **[Medium]** 7 icon-only
Refresh buttons and Inbox Send lack `aria-label`. **[Medium]** `-600` color tokens
(tuned for white bg) used for the most urgent text ("OVERDUE") inside the forced-dark
dashboard → lowest-contrast signal on screen.

**[Medium][Confirmed] `formatPhoneNumber` exists but zero components use it.**
`phone-utils.ts:48-65` (tested) is imported only by its own test; raw E.164 renders in
6+ places and two files define duplicate local formatters. *Fix:* use it everywhere;
delete the duplicates.

**Done well:** login → Today wall-board with silent 60s refresh; consistent single
sonner toaster; optimistic Inbox send + KPI update; text-label (not color-only) status
badges; Radix focus traps; good empty/loading/error states on Today, Inbox, Queue.

### 3D. Simplicity

**[Confirmed] ~2,050 LOC committed root junk** — 6 stale audit `.md` files
(`AUDIT_PROMPT.md`, `AUDIT_REPORT.md`, `FEATURE_AUDIT_*`, `LEADCATCHER_AUDIT_PROMPT.md`,
`REBUILD.md`) + 14 `tmpclaude-*-cwd` files (accidental commits containing stray path
strings). *Risk: low.*

**[Confirmed] 3 competing schema sources.** `supabase/migrations/` (13 files) is the
applied truth; loose `schema.sql`/`schema-enhanced.sql`/etc. (~583 LOC) predate it,
aren't run by any script, and README still points at the stale files. *Risk: low
(confirm no manual `psql -f` runbook).*

**[Confirmed] Telnyx is dead weight** — `telnyx/sms/route.ts` + `telnyx-validator.ts`
+ 2 env lines (~335 LOC); the path string has zero callers, `configure-webhooks` only
registers Twilio, every send lib hard-codes `twilio()`. *Unreachable from code; can't
rule out an externally-provisioned Telnyx number* → confirm, then delete.

**[Confirmed] Copy-pasted auth preamble across ~33 authed routes** (~10-15 lines each:
server client → `getUser()` → 401 → `businesses` lookup → 403/404 → try/catch/500).
No `withAuthedBusiness()` wrapper exists. *~330-400 LOC consolidatable; risk med
(broad, mechanical — do incrementally).*

**[Confirmed] Dead/mergeable routes:** `missed-call-watchdog` is a self-documented
no-op (30 LOC); `coaching/by-owner`, `calls/patterns/top`, `calls/daily-report`,
`calls/analyze` grep to 0 callers (~395 LOC — confirm no external caller before
deleting mutation/ingest endpoints); the 8 `calls/[id]/*` routes (all live) could
collapse to one `?action=` handler (~200 LOC). Cron `followup`+`followup-drafts` and
`daily-digest`+`end-of-day` are merge candidates.

*All 8 `calls/[id]/*` routes and all 10 `vercel.json` crons are confirmed **live**.*

---

## 4. Top 10 action list (cross-dimension, ordered by severity × 1/effort)

| # | Action | Dim | Sev | Effort | Evidence |
|---|--------|-----|-----|--------|----------|
| 1 | Fail **open** for Twilio paths in the middleware rate limiter | Rel | High | S | `middleware.ts:108-111` |
| 2 | Check the `opt_outs` upsert error; fail closed on STOP | Sec/TCPA | High | S | `sms/route.ts:92-115` |
| 3 | Wire error alerting (Slack/Sentry) into `logger.error` + cron monitors | Rel | High | S | `logger.ts:45-66`, `error.tsx:16` |
| 4 | Add timeouts on RepairDesk/Telnyx `fetch` + OpenAI clients | Rel | High | S | `repairdesk.ts:237`, `telnyx/sms:21` |
| 5 | Add a per-card **Text** button on Today; make X a dismiss-with-Undo | UX | High | S/M | `today/page.tsx:427-457,253-268` |
| 6 | Make webhook reclaim SMS-safe + sweeper for stuck `processing` rows | Rel | High | M | `webhook-common.ts:58-79`, `voice/route.ts:144` |
| 7 | Unify "mark booked" onto one endpoint with value capture | UX | High | M | `followup-queue.tsx:145`, Inbox `page.tsx:66-78` |
| 8 | Check `.error` in digest/end-of-day/ai-audit crons; non-2xx on failure | Rel | Med | M | `cron/daily-digest/route.ts:81-113` |
| 9 | Delete root junk (~2k LOC) + stale `supabase/*.sql` (~583 LOC); update README | Simp | Med | S | `git ls-files` |
| 10 | Add the 5 missing tests (below); introduce `withAuthedBusiness()` wrapper | Test/Simp | Med | M | §5 |

**5 tests to write first:** (1) Stripe out-of-order replay must not clobber newer
subscription state; (2) reclaimed voice webhook sends the auto-reply exactly once;
(3) STOP with a failing `opt_outs` upsert sends no confirmation and doesn't mark
processed; (4) tenant isolation on `/api/calls/list` + `/api/calls/[id]/mark-*`
(user B gets 404 for A's rows); (5) daily digest under a DB error does **not** send.

---

## 5. What was NOT verified (needs a live environment)

- **RLS runtime behavior** — policies were read statically (`migrations/`), not
  exercised against a live Postgres with two tenants. Test: sign in as tenant B, query
  tenant A's `call_analyses` id via PostgREST directly → expect 0 rows.
- **Twilio retry semantics** — the "voice webhook doesn't retry on 503" claim is based
  on Twilio's documented behavior, not a live call. Test: force a 503 and observe
  whether a lead is created.
- **Whether dead routes have external callers** — `calls/analyze`, RepairDesk
  `create-customer`/`add-note`, and the Telnyx webhook are unreachable *from this
  codebase*, but a Postman/mobile/externally-provisioned-number caller can't be ruled
  out. Confirm before deleting any mutation/ingest endpoint.
- **Supabase Auth rate limiting** — confirm brute-force limits are enabled in project
  settings (no app-layer throttle exists).
- **Missing composite indexes** (`call_analyses(business_id, callback_status,
  created_at)` etc.) are Theoretical — fine at current volume; verify with `EXPLAIN`
  under production-scale data.
