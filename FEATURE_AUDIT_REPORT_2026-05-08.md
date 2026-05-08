# LeadCatcher Feature & Functional Audit Report

**Date:** 2026-05-08
**Auditor:** Claude (Opus 4.7) — read-only static + flow analysis
**Commit SHA:** `2906a4aaae0b901810e39c1c021208df396fdd0f`
**Branch:** `claude/leadcatcher-functional-audit-ggDuF`
**Environment:** static analysis + automated checks (typecheck, lint, vitest, `next build` with synthetic env)
**Live test environment:** Not available — no Supabase/Twilio/Stripe credentials in this audit harness, so no end-to-end browser walk-throughs were performed. Findings come from code paths, schemas, vercel cron config, and feature copy. Whenever a finding could only be confirmed live (e.g. "the wizard verify call rings but Twilio rejects it"), the root-cause candidates are listed and the engineer is asked to capture the exact error.

---

## Executive Summary

| Class | Count |
|---|---|
| Features fully implemented and wired | ~22 / 33 reviewed |
| BROKEN (will misbehave for users today) | 8 |
| MISSING (advertised / referenced but no impl) | 8 |
| INCOMPLETE (works but with material gaps) | 9 |

**Top 5 user-impacting issues**

1. **The verification "Run Test Call" can fail in several ways and the surfaced error is generic** — likely root causes: Twilio trial-account caller-ID restriction, missing/wrong `APP_BASE_URL`, and a unique-index collision when more than one business shares the single `TWILIO_PHONE_NUMBER`. (B-01)
2. **Multi-tenancy is silently broken**: a unique index on `businesses.forwarding_number` combined with `autoLinkTwilioNumber()` always linking the same `TWILIO_PHONE_NUMBER` means the second user to onboard hits a constraint failure. (B-02)
3. **Empty-state buttons on `/dashboard` send users to `/dashboard/settings` to "Run Test Call" / "Activate Forwarding" — but neither button exists on the settings page.** Test Call only lives in the onboarding wizard. (B-04, M-01)
4. **Pricing card says "No credit card required" but the actual trial flow requires a credit card on the Stripe checkout page.** Trust-destroying mismatch. (B-03)
5. **Pricing CTA passes `?plan=starter|pro` to `/onboarding`, but the wizard ignores it — and the wizard never starts a Stripe trial.** Newly onboarded users land on the dashboard with no subscription; the 7-day grace period in `billing-guard` masks this until it expires, then SMS sending suddenly stops. (I-02, I-03)

**Automated checks (clean baseline)**

| Check | Result |
|---|---|
| `npm ci` | Installs 590 pkgs; one deprecation warning (`scmp@2.1.0`, transitive via Twilio). |
| `npx tsc --noEmit` | 0 errors. |
| `npm run lint` | 0 errors, 13 warnings (unused imports / one stale `eslint-disable`). |
| `npm test` | 22 files / **177/177 tests pass**. |
| `npm run build` (synthetic env) | Builds. **One warning**: `The "middleware" file convention is deprecated. Please use "proxy" instead.` |

---

## Section 1: BROKEN Features

### B-01 — "Run Test Call" in onboarding errors out (the user-reported P0)
- **Feature:** Onboarding Step 3 verification — `Wizard.tsx → POST /api/verify → Twilio Calls API → POST /api/verify/webhook (TwiML) → forwarded call → POST /api/webhooks/twilio/voice` which sets `verified=true`.
- **Severity:** **P0**
- **Repro steps:**
  1. Sign up, complete Step 1 (business info → autoLink runs).
  2. Continue to Step 3, click **Run Test Call**.
  3. Observe the error toast / red panel.
- **Expected:** Phone rings; user declines; forwarded call hits voice webhook; UI shows green "It Works!".
- **Actual (per product owner):** "now when calling to the phone there is an error message."
- **Where it can fail (must be reproduced live to pin down the exact branch):**
  1. **Twilio trial accounts only allow outbound calls to verified Caller IDs.** If `business.business_phone` (entered in Step 1) is not in the Twilio "Verified Caller IDs" list, `client.calls.create()` throws `21219 / 21210 — The 'To' number is not a Verified outgoing caller ID`. Surfaced in UI as the generic `"Failed to place call"` (`src/app/api/verify/route.ts:90`).
  2. **`APP_BASE_URL` not publicly reachable.** If running locally without ngrok or with `APP_BASE_URL=http://localhost:3000`, Twilio's HTTP fetch of `${baseUrl}/api/verify/webhook` fails — `client.calls.create()` succeeds (Twilio queues the call) but the call hangs up immediately when fetching the URL fails. The user then never receives a call and the polling at `Wizard.tsx:150` times out → `"Verification timed out…"`.
  3. **Twilio signature mismatch on `/api/verify/webhook`.** When Twilio fetches the URL, it signs with its idea of the callback URL. `validateTwilioRequest()` rebuilds the URL from `TWILIO_WEBHOOK_URL` → `APP_BASE_URL` → `request.url`. If those don't match exactly (e.g. `APP_BASE_URL=https://myapp.vercel.app` but Twilio actually called `https://leadcatcher-git-foo-shukik73.vercel.app`), the webhook returns 403, Twilio plays the default error and hangs up — and importantly, **the test call never reaches `/api/webhooks/twilio/voice`** (Twilio is calling the user's phone, the user's phone forwards back to the Twilio number, that triggers the *voice* webhook, not the *verify* webhook). Re-reading the flow: the "verify webhook" plays a TwiML message **to the answered call**, but the **forwarded** call hits the voice webhook. So the verify webhook signature failure only matters if the user actually answers, which the wizard explicitly tells them not to do. So this branch is unlikely to be the user's reported error path.
  4. **The forwarded ("boomerang") call never arrives at the voice webhook.** The wizard tells the user "let it ring, do not answer." After the timeout (20s here), the carrier forwards the call to the Twilio number — but only if the user actually configured `*72`/`*71` (Step 2 has no programmatic verification — see B-05). On Step 2, "I dialed the code" is just an honor-system button.
  5. **Multi-tenant unique-index collision.** Step 1 calls `autoLinkTwilioNumber()` which `UPDATE businesses SET forwarding_number=$TWILIO_PHONE_NUMBER WHERE id=…`. The schema has `CREATE UNIQUE INDEX businesses_forwarding_number_unique ON businesses(forwarding_number) WHERE forwarding_number IS NOT NULL` (`supabase/migrations/001_full_schema.sql:108-109`). If **any** other business in the DB already has that same `TWILIO_PHONE_NUMBER`, the update fails, `autoLink` returns `success: false`, the wizard shows the red "Connection Failed" panel, and the user never reaches Step 3 — but the message says "An unexpected error occurred. Please try again." (`Wizard.tsx:106`). This is a very plausible match for the reported behavior on the second onboarding attempt or in a multi-tenant deployment.
  6. **`forwarding_number` empty when /api/verify runs.** If autoLink failed silently and the user advanced anyway, `/api/verify` returns 400 with `"No Twilio number linked. Complete step 3 first."` — confusing wording (it says step 3 from inside step 3).
- **Trace:**
  - UI handler: `src/components/onboarding/Wizard.tsx:133-168`
  - Outbound call: `src/app/api/verify/route.ts:60-93` — note `client.calls.create({ to: business.business_phone, from: business.forwarding_number })` (lines 70-71). All Twilio errors collapse to the same generic 500 with `"Failed to place call"` (line 90).
  - TwiML callback: `src/app/api/verify/webhook/route.ts`
  - Signature validator: `src/lib/twilio-validator.ts`
  - autoLink (Step 1): `src/app/actions/twilio.ts:40-86` and `linkTwilioNumberToBusiness` 185-255.
- **Suggested fix (diagnostic + UX, code-level):**
  ```ts
  // src/app/api/verify/route.ts:88
  } catch (error) {
      logger.error('Verification Call Failed', error);
      // Surface Twilio's actual error code/message to the user — they can fix
      // unverified caller-IDs themselves; today they just see "Failed to place call".
      const twErr = error as { code?: number; message?: string };
      const friendly =
          twErr.code === 21210 || twErr.code === 21219
              ? 'Your business phone is not a verified caller ID on this Twilio account. Verify it in the Twilio Console (or upgrade off the trial) and try again.'
              : twErr.code === 21601
              ? `The webhook URL ${baseUrl}/api/verify/webhook is not reachable from Twilio. Confirm APP_BASE_URL is a public HTTPS URL.`
              : `Twilio rejected the call (${twErr.code ?? 'unknown'}): ${twErr.message ?? 'no detail'}`;
      return new Response(JSON.stringify({ success: false, error: friendly }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
      });
  }
  ```
  ```ts
  // src/app/actions/twilio.ts:211 — surface DB unique-constraint collisions instead of
  // returning the generic "Failed to save phone number to your account".
  if (updateError) {
      logger.error('[linkTwilioNumberToBusiness] DB error', updateError);
      if (updateError.code === '23505') {
          return { success: false, error: 'This phone number is already linked to another business. Each business needs its own dedicated Twilio number.' };
      }
      return { success: false, error: 'Failed to save phone number to your account' };
  }
  ```
- **Verification:** Reproduce locally with ngrok + a Twilio trial sub-account; confirm the new error text appears for each branch (unverified caller, bad URL, unique collision).

### B-02 — Multi-tenant breaks at the second onboarding
- **Feature:** Sign-up → onboarding → autoLink Twilio number.
- **Severity:** **P0** for any deployment that intends to serve >1 business.
- **Repro:** Onboard business A, then business B with a different account.
- **Expected:** Each business gets its own forwarding number.
- **Actual:** Both businesses try to write `forwarding_number = $TWILIO_PHONE_NUMBER`. The unique partial index `businesses_forwarding_number_unique` (`supabase/migrations/001_full_schema.sql:108-109`) fails the second one with Postgres `23505`, surfaced as `"Failed to save phone number to your account"` (`src/app/actions/twilio.ts:221`).
- **Root cause:** Product is shipped as if there's a pool of Twilio numbers (number-per-tenant), but the code only ever links the single env var. There's no number-purchase code path. Combined with the unique index, this is a hard failure, not a soft warning.
- **Suggested fix (MVP):** Either (a) actually call `client.incomingPhoneNumbers.create()` to provision a new number per tenant on autoLink and surface a real cost message, or (b) drop the unique index and add a `business_id` column to a `twilio_numbers` table (commented-out in audit notes) so multiple businesses can legitimately share one number using `Called` + `Caller` + DB lookup, or (c) for true single-tenant deployments, document explicitly in README that this is a one-business install.
- **Verification:** Insert two `businesses` rows with the same `forwarding_number` in a Supabase branch — second INSERT should fail today and succeed after the schema/code change.

### B-03 — "No credit card required" claim is false
- **Feature:** Pricing → trial signup.
- **Severity:** **P1** (trust + likely chargebacks).
- **Evidence:**
  - Landing: `src/components/landing/Pricing.tsx:46` — *"Start with a 14-day free trial. No credit card required."*
  - Billing page: `src/app/dashboard/billing/page.tsx:233-236` — *"Choose a plan below to start your free trial. You'll enter your credit card on the next page and won't be charged until the trial ends."*
  - Stripe Checkout config requires a payment method by default and the code does not pass `payment_method_collection: 'if_required'` (`src/app/api/stripe/checkout/route.ts:71-88`).
- **Suggested fix:** Either remove "No credit card required" from `Pricing.tsx:46`, or pass `payment_method_collection: 'if_required'` to the checkout session and accept the risk of higher trial-to-paid leakage.

### B-04 — Dashboard empty-state CTAs lead to a settings page that doesn't have those buttons
- **Feature:** `/dashboard` empty state when the user has zero leads.
- **Severity:** **P1** (blocks first-run activation).
- **Evidence:** `src/app/dashboard/page.tsx:378-387` — both **"Activate Forwarding"** and **"Run Test Call"** route to `/dashboard/settings`. `src/app/dashboard/settings/page.tsx` has no test-call button (greps for `Run Test Call`, `verify`, `/api/verify` all return zero matches).
- **Repro:** Sign up, finish onboarding, return to `/dashboard` with zero leads. Click "Run Test Call". Lands on Settings, sees no obvious test-call control.
- **Suggested fix:** Add a "Send a test call to my phone" button in the Phone Connection card that hits `POST /api/verify` and shares the polling logic from the Wizard — or change both empty-state buttons to deep-link back to `/onboarding?step=3` (and have the Wizard accept that param).
- **Verification:** Click each button after the fix; confirm a real Twilio call lands on the user's phone.

### B-05 — Step 2 of the onboarding wizard never validates that the user actually dialed the forwarding code
- **Feature:** Onboarding Step 2 — "Activate call forwarding".
- **Severity:** **P1** (the most common failure mode on Step 3 will be "user clicked 'I dialed the code' but they didn't, or it didn't take").
- **Evidence:** `src/components/onboarding/Wizard.tsx:316-319` — only an "I dialed the code" button.
- **Suggested fix:** Either (a) document the carrier-specific `*#21#` dial code so the user can confirm the carrier's response; (b) move the verification call into Step 2 itself with a clear "if your phone rings and forwards, you're set" loop; (c) add a prominent "Didn't work? Call this number from your business phone" troubleshooting block.

### B-06 — `/api/cron/missed-call-watchdog` returns 200 disabled but is still a public route
- **Feature:** Disabled fallback poller.
- **Severity:** **P3**.
- **Evidence:** `src/app/api/cron/missed-call-watchdog/route.ts:24-30` — auth-guarded but always returns `{ disabled: true }`. Not in `vercel.json` cron list.
- **Suggested fix:** Delete the file once you confirm nothing external still pings it; the comment in the file already says so.

### B-07 — Logout silently clears state but does not clear server cookies if the browser closes mid-flow
- **Feature:** Sign-out via `DashboardNav`.
- **Severity:** **P3** — works on the happy path.
- **Evidence:** `src/components/dashboard/DashboardNav.tsx:29-32` — `await supabase.auth.signOut(); router.push('/login')`. No error handling if signOut fails (e.g. offline). User would land on `/login`, but middleware `/login` redirect (line 186-189 of `middleware.ts`) bounces authenticated sessions back to `/dashboard`.
- **Suggested fix:** Add a try/catch and toast on failure; force a hard reload after sign-out to clear in-memory state.

### B-08 — `validateTwilioRequest` clones `request.formData()` but the calling route then reads `request.formData()` again
- **Feature:** Twilio webhook signature validation.
- **Severity:** **P3** (currently works because `Request.clone()` handles it correctly in Node fetch, but the pattern is brittle).
- **Evidence:** `src/lib/twilio-validator.ts:31` calls `request.clone().formData()`. `voice/route.ts:26` then calls `request.formData()`. If the runtime ever drops streaming clone semantics (or if a caller forgets to `clone()`), the second read 500s.
- **Suggested fix:** Have `validateTwilioRequest` return `{ valid: boolean, params: FormData }` so callers don't reparse.

---

## Section 2: MISSING Features

### M-01 — "Run Test Call" outside the onboarding wizard
- **Where it's referenced:** `src/app/dashboard/page.tsx:383-386` ("Run Test Call" empty-state button), README implies post-onboarding test re-runs are possible.
- **What's actually there:** Nothing on Settings. The verify endpoint exists (`/api/verify`) but only the wizard calls it.
- **Implementation:** Add a card to `/dashboard/settings` next to Phone Connection that mirrors `runTestCall` from the wizard. Effort: **S**.

### M-02 — Recovery analytics dashboard
- **Where:** `/api/analytics/recovery/route.ts` exists; the audit prompt references `/dashboard/analytics → recovery dashboards`.
- **Actual:** `/dashboard/analytics` only fetches `/api/analytics/funnel` (`src/app/dashboard/analytics/page.tsx:37`). No grep hits for `/api/analytics/recovery` outside the route file itself.
- **Implementation:** Add a second tab on the analytics page that calls the existing endpoint. Effort: **M**.

### M-03 — Daily call report viewer
- **Where:** `/api/calls/daily-report/route.ts` exists.
- **Actual:** No UI consumes it. Effort: **S** (button on Calls page → opens markdown in a sheet).

### M-04 — "Top patterns" view
- **Where:** `/api/calls/patterns/top/route.ts` exists.
- **Actual:** No UI. Effort: **S**.

### M-05 — Manual "analyze this call" trigger
- **Where:** `/api/calls/analyze/route.ts` exists.
- **Actual:** No UI button. Useful for re-running scoring after a transcription glitch. Effort: **S**.

### M-06 — RepairDesk "Create customer" button
- **Where:** `/api/repairdesk/create-customer/route.ts` exists; `repairdesk-ticket-card.tsx` only consumes `lookup-ticket` and `sync-call`.
- **Actual:** No path to create a new RD customer from a call. Effort: **S**.

### M-07 — Stripe `customer.subscription.trial_will_end` not handled
- **Where:** Audit prompt explicitly asks about it. Stripe sends it 3 days before the trial ends.
- **Actual:** `src/app/api/stripe/webhook/route.ts` only handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` (line 59-71).
- **Implementation:** Add a case that SMS/emails the owner about the upcoming trial end. Effort: **S**.

### M-08 — Magic-link / OTP login (referenced in audit prompt)
- **Where:** Feature inventory lists "Magic-link / OTP login".
- **Actual:** Login page (`src/app/login/page.tsx`) only does `signInWithPassword` and email/password sign-up. No `signInWithOtp` anywhere.
- **Note:** Could be intentional product change; flag for confirmation rather than ship-blocker. Effort: **M** if the team wants both.

---

## Section 3: INCOMPLETE Features

### I-01 — Single shared Twilio number model
Already detailed in B-02. Beyond the unique-index break, the voice and SMS webhooks query `forwarding_number = called` with `.single()` which works only by accident in single-tenant. Needs a real per-tenant number plan.

### I-02 — `?plan=` query param ignored by the wizard
Pricing.tsx links to `/onboarding?plan=starter|pro` (`src/components/landing/Pricing.tsx:88`) but `OnboardingPage` and `Wizard.tsx` never read `searchParams.get('plan')`. The user has to leave onboarding and visit `/dashboard/billing` separately to start the trial. Effort: **S** to plumb the param through and either pre-select the plan on billing or trigger checkout right after Step 3.

### I-03 — Onboarding never starts the Stripe trial
Combined with I-02, a brand-new business has `stripe_status=NULL` after onboarding. `billing-guard` allows SMS during a 7-day grace period (`src/lib/billing-guard.ts:43-54`), so the failure is delayed: at day 8, the customer's SMS suddenly stop sending with no banner. The Subscription banner only renders for `stripe_status='trialing'|'past_due'` etc. (see `SubscriptionBanner.tsx`).
- **Suggested fix:** After the wizard's Step 3 verifies, redirect to Stripe checkout (or to `/dashboard/billing`) with a clear "Activate your trial" CTA in the dashboard until `stripe_status` is set.

### I-04 — Settings AI Features card has its own Save button while every other card has its own Save button — but the per-toggle changes aren't debounced or guarded against navigation away
Minor UX thing; user toggles a switch then forgets to click Save and assumes it persisted. Add a "you have unsaved changes" indicator or save-on-toggle. Effort: **S**.

### I-05 — Empty-state copy in the dashboard says forwarding instructions are on Settings, but the Settings "Forwarding Status" component (`src/components/dashboard/ForwardingStatus.tsx`) only displays the *72 code; it does not explain how to undo it. Customers churn → no off-boarding instructions.

### I-06 — Mobile DashboardNav has 10 nav items + Sign Out; the dropdown can overflow the viewport on small phones because it's not inside a scroll container.
- **Evidence:** `src/components/dashboard/DashboardNav.tsx:60-87` — items in a `<div className="space-y-1">` with no max-height/overflow.

### I-07 — `Wizard.runTestCall` polling waits 30s (15 × 2s) and on failure says "Verification timed out. Make sure you declined/ignored the call so it forwarded to your Twilio number, then try again." But many of the failure modes from B-01 happen synchronously from the `POST /api/verify` step and never get to polling — the user sees the *initial* error path, but the toast/inline copy implies the polling timed out, which is misleading.
- **Suggested fix:** Distinguish "place-call failure" from "polling timeout" in the error UI.

### I-08 — Voice webhook depends on `forwarding_number=called` with `.single()`, but `normalizePhoneNumber()` is the only thing keeping `Called` and `forwarding_number` in matching format. If a phone is stored as `(786) 555-9876` in `forwarding_number` (from the Twilio API which returns E.164 like `+17865559876`), the lookup misses and the user hears `"this number is not configured correctly"`.
- **Mitigation today:** `linkTwilioNumberToBusiness` writes `foundNumber.phoneNumber` straight from Twilio, which is E.164 — so the column should already be E.164. If a manual SQL UPDATE writes a non-E.164 value, it's silently broken.
- **Suggested fix:** Add a CHECK constraint or normalize on read.

### I-09 — `auto_reply_enabled` toggle in Settings exists but the help text in `src/app/dashboard/settings/page.tsx:780` warns "Automatically reply to customer SMS with AI-generated responses" — the SMS webhook only sends an AI auto-reply on inbound *replies* to existing leads (`src/app/api/webhooks/twilio/sms/route.ts:320`). It does not auto-reply to fresh inbound SMS that aren't tied to a missed call. That's likely intentional but the copy doesn't make the boundary clear.

---

## Section 4: Cross-Cutting Issues

### Console / build warnings
- `Next 16 build` warns `The "middleware" file convention is deprecated. Please use "proxy" instead.` (`/tmp/build.log`). Codepath: `src/middleware.ts`. Rename to `proxy.ts` per Next 16.
- ESLint produces 13 warnings (no errors). Notable:
  - `src/app/api/analytics/funnel/route.ts:121` — `bookedCalls` assigned but never used (probably a dropped feature).
  - `src/app/dashboard/settings/page.tsx:150` — stale `// eslint-disable-next-line react-hooks/set-state-in-effect`.
  - Several pages (`actions`, `analytics`, `coaching`, `customer`) have unused icon imports (`CheckCircle`, `XCircle`, `MessageSquare`, `Clock`, `CardHeader`, `CardTitle`, etc.).

### Failing tests
- **None.** All 22 test files / 177 tests pass on a fresh `npm ci`. There is one stderr warning from `repairdesk-poll.test.ts` about `vi.fn()` not using `function`/`class` — non-blocking.

### Performance / DB shape
- `dashboard/page.tsx` does `select '*, messages (*)'` and pulls all messages for every lead in the page (50 leads × N messages). For a user with 500 leads each with 50 messages, that's 25k rows on initial load. The `messages` table has `lead_id_idx` per migration 001 line 124, so it's index-sconed, but the response payload is still large.
- `voice` and `sms` webhooks each instantiate a fresh `twilio()` client per invocation. Twilio SDK is lightweight, but consider hoisting.

### Security observations (already covered in `AUDIT_REPORT.md`, re-verified)
- Transcription webhook **does** now call `validateTwilioRequest` (was a P0 in the previous audit; verified fixed at `src/app/api/webhooks/twilio/transcription/route.ts:18`).
- Auth callback uses the new `getSafeRedirectPath` helper (`src/lib/redirect-validator.ts`); previous open-redirect bug fixed.
- Settings page hoisting bug fixed: `fetchSettings` declared before the `useEffect` that calls it (line 93 vs 148).

### Feature/Promise mismatches (advertising vs reality)
- **B-03**: "No credit card required" on the landing page, but checkout requires one.
- **FAQ Q4**: "Your customers always see your real number" — outbound auto-replies and owner notifications are sent from the Twilio `forwarding_number`, **not** the user's real business number. So when LeadCatcher texts a missed caller back, the customer sees a different number. Recommend rewording.
- **HowItWorks** says "Set up in 5 minutes" — realistic if everything works; B-01/B-04/B-05 mean today it's longer.

### Accessibility (spot-check)
- `dashboard/page.tsx:290-292` Call button uses `aria-label`-less icon-only button (`<Phone> Call`) — has visible text, fine.
- `Sidebar.tsx` lead items have `tabIndex={0}` and proper Enter/Space handlers; missing visible focus ring (uses Tailwind's default outline).
- `Wizard.tsx` progress bar uses `role="progressbar"` correctly.
- Several icon-only buttons in the Call Detail Panel (`call-detail-panel.tsx`) have no `aria-label` (e.g. the refresh button at `:107`, audit button at `:243` has visible text).

---

## Section 5: Prioritized Fix List

### P0 — Ship-blocking (fix today)
1. **B-01** Reproduce the test-call error live, capture the exact Twilio error code, and ship the typed error-message switch in `src/app/api/verify/route.ts` so users can self-diagnose unverified-caller-ID, unreachable-webhook, and unique-collision.
2. **B-02** Decide multi-tenant strategy and either implement number provisioning or document single-tenant constraint + drop the unique index appropriately.

### P1 — Fix this week
3. **B-04 / M-01** Add a "Send a test call" button to `/dashboard/settings` (or deep-link the empty-state buttons to `/onboarding?step=3`).
4. **B-03** Remove "No credit card required" from `Pricing.tsx:46` (or change checkout to `payment_method_collection: 'if_required'`).
5. **B-05** Improve onboarding Step 2 — add diagnostic copy or make Step 3 the actual gate.
6. **I-02 / I-03** Wire the `?plan=` param and trigger Stripe checkout at the end of onboarding.
7. **M-07** Handle `customer.subscription.trial_will_end` in the Stripe webhook so users get a heads-up before the trial converts.
8. **I-07** Distinguish "place-call failure" from "polling timeout" in the wizard error states.

### P2 — Fix this sprint
9. **M-02 / M-03 / M-04 / M-05 / M-06** Wire the orphan API routes to UI (recovery analytics, daily-report, patterns, analyze, RD create-customer).
10. Fix the `next 16` deprecation: rename `src/middleware.ts` → `src/proxy.ts` and adjust `config.matcher` if needed.
11. Clean up the 13 ESLint warnings (unused imports + stale `eslint-disable`).
12. Reword FAQ Q4 ("Your customers always see your real number") — accurate to the implementation.
13. **B-07** Harden `signOut` with try/catch + hard reload.
14. **I-04** Save-on-toggle UX for AI Features.

### P3 — Backlog
15. **B-06** Delete the disabled `missed-call-watchdog` route file.
16. **B-08** Refactor `validateTwilioRequest` to return parsed params.
17. **I-06** Make mobile nav dropdown scrollable.
18. **I-08** Add E.164 CHECK constraint or normalize-on-read for `forwarding_number`.
19. **M-08** Decide whether to add OTP/magic-link login or remove from advertised features.
20. Bring forward `AUDIT_REPORT.md`'s F18 and F12 follow-ups (deprecated `scmp` package via Twilio; test coverage of more business-logic surfaces).

---

## Section 6: What Works Well

- **Test discipline.** 177 tests, all green, covering the trickiest webhook permutations (idempotency, opt-out, rate-limit interactions, Stripe webhook signatures, redirect validator).
- **Webhook idempotency model.** `claimWebhookEvent → markWebhookProcessed/markWebhookFailed → markWebhookFailedIfProcessing` gives you exactly-once-ish semantics with a try/finally safety net (`src/lib/webhook-common.ts`).
- **TCPA discipline.** STOP/UNSUBSCRIBE/CANCEL/END/QUIT each handled, START re-subscribes, opt-out lookup fails closed before every outbound send. Confirmation message includes business name. Same lookup lives in `/api/messages/send` and the cron, no copy-paste drift.
- **Billing guard with grace period.** `billing-guard.ts` cleanly handles the trialing/active/past_due/canceled axis plus a 7-day onboarding grace.
- **AI lead-qualification dialogue and hot-lead alert** built on top of the SMS webhook is well-factored — quals progress is persisted per-step, hot lead urgency triggers an owner SMS, and the qualification path correctly suppresses the duplicate notify-owner SMS at the end (`src/app/api/webhooks/twilio/sms/route.ts:357-374`).
- **CSP, HSTS, X-Frame-Options, etc.** in `next.config.ts` look sensible for a B2B app with Stripe + Supabase + OpenAI + Twilio integrations.
- **Validation** on the settings POST is strict (`zod.strict()` plus regexes for timezone and subdomain).

---

## Appendix A: Reproduction Environment

- Node: `node --version` not captured (sandbox); `npm ci` succeeded with the lockfile, so engines satisfied.
- npm: 10.9.7 (notice for upgrade to 11).
- OS: Linux 6.18.5.
- Browser: not used (no live walk-through performed).
- Env vars set during `next build` (synthetic): `SKIP_ENV_VALIDATION=1`, plus dummy Supabase/Twilio/Stripe/OpenAI/CRON values.
- Supabase project ref: not used.
- Twilio account: not used.
- Stripe mode: not used.

## Appendix B: Files I read while building this report
`AGENTS.md`, `AUDIT_PROMPT.md`, `AUDIT_REPORT.md`, `FEATURE_AUDIT_PROMPT.md`, `package.json`, `vercel.json`, `next.config.ts`, `.env.example`, `src/middleware.ts`, `src/lib/twilio-validator.ts`, `src/lib/webhook-url.ts`, `src/lib/billing-guard.ts`, `src/lib/redirect-validator.ts`, `src/components/onboarding/Wizard.tsx`, `src/components/landing/{Hero,Pricing,FAQ,Footer,Header,HowItWorks}.tsx`, `src/components/dashboard/{DashboardNav,Sidebar}.tsx`, `src/components/{call-detail-panel,calls-table,call-filters,followup-queue,repairdesk-ticket-card,audio-player,urgency-badge}.tsx`, `src/app/{layout,page,login/page,onboarding/page,auth/callback/route}.tsx`, `src/app/dashboard/{layout,page,settings/page,billing/page,calls/page,actions/page,audit/page,customer/page,analytics/page,followups/page,coaching/page}.tsx`, `src/app/api/verify/{route,webhook/route}.ts`, `src/app/api/webhooks/twilio/{voice,sms,transcription}/route.ts`, `src/app/api/messages/send/route.ts`, `src/app/api/settings/route.ts`, `src/app/api/twilio/configure-webhooks/route.ts`, `src/app/api/stripe/{checkout,portal,webhook}/route.ts`, `src/app/api/cron/{followup,daily-digest,end-of-day,missed-call-watchdog}/route.ts`, `src/app/api/repairdesk/poll/route.ts`, `src/app/actions/twilio.ts`, `supabase/migrations/{001..007}*.sql`, `/tmp/{tsc,lint,test,build}.log`.
