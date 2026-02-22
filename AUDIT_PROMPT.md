# LeadCatcher Comprehensive Audit Prompt

> Copy this entire prompt into Claude, ChatGPT, or any AI code review tool along with your codebase.

---

## Instructions

You are a senior full-stack engineer and security auditor. Perform a comprehensive audit of **LeadCatcher** — a B2B SaaS application that recovers lost revenue for service businesses by capturing missed calls, sending instant SMS responses via Twilio, integrating with RepairDesk CRM, managing Stripe billing, and providing a unified lead management dashboard.

**Rate the application on a scale of 1–10** in each category below, and provide an **overall score**. For every finding, include:

1. **Severity**: Critical / High / Medium / Low / Info
2. **File path and line number(s)** where the issue exists
3. **What's wrong**: Clear description of the problem
4. **Why it matters**: Real-world impact (data breach, revenue loss, user frustration, etc.)
5. **How to fix it**: Specific, actionable code-level fix (not vague advice)
6. **Priority**: P0 (fix immediately) / P1 (fix this week) / P2 (fix this sprint) / P3 (backlog)

---

## Tech Stack Context

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript 5.9
- **Database**: Supabase (PostgreSQL) with Row Level Security (RLS)
- **Auth**: Supabase Auth (email/password, magic links) with cookie-based sessions
- **Telephony**: Twilio (Voice, SMS, Voicemail Transcription)
- **AI**: OpenAI GPT-4o (voicemail analysis, intent detection, smart replies)
- **Payments**: Stripe (subscriptions, checkout, billing portal, webhooks)
- **CRM Integration**: RepairDesk API (customer sync, missed call polling)
- **Rate Limiting**: Upstash Redis
- **UI**: shadcn/ui + Radix UI + Tailwind CSS 4 + Framer Motion
- **Testing**: Vitest
- **Deployment**: Vercel

---

## Application Architecture

### Core Flow
1. User signs up → completes 5-step onboarding (business info, carrier, Twilio number linking, call forwarding setup, verification test)
2. Customer calls business → call forwards to Twilio number → missed call detected → instant SMS sent → voicemail recorded → AI transcribes and analyzes → smart reply sent → owner notified
3. Customer replies via SMS → AI detects intent → conversation logged → owner notified
4. Dashboard shows all leads, conversation threads, AI summaries, and lead status management
5. Settings: SMS templates (with presets), business hours, RepairDesk API integration
6. Billing: Stripe subscriptions (Starter $299/mo, Pro $499/mo) with 14-day free trial

### Key Files to Audit
```
src/middleware.ts                              — Auth, rate limiting, redirects
src/app/dashboard/layout.tsx                   — Dashboard layout, subscription checks
src/app/dashboard/page.tsx                     — Main inbox (lead list + conversation)
src/app/dashboard/settings/page.tsx            — Settings (templates, hours, API)
src/app/dashboard/billing/page.tsx             — Billing management
src/app/onboarding/page.tsx                    — 5-step setup wizard
src/components/onboarding/Wizard.tsx           — Onboarding form logic
src/app/login/page.tsx                         — Auth forms
src/app/auth/callback/route.ts                 — OAuth/magic link callback
src/app/api/settings/route.ts                  — Server-side settings save
src/app/api/messages/send/route.ts             — Outbound SMS sending
src/app/api/webhooks/twilio/voice/route.ts     — Incoming call handler
src/app/api/webhooks/twilio/sms/route.ts       — Incoming SMS handler
src/app/api/webhooks/twilio/transcription/route.ts — Voicemail transcription handler
src/app/api/stripe/webhook/route.ts            — Stripe event handler
src/app/api/stripe/checkout/route.ts           — Stripe checkout session
src/app/api/stripe/portal/route.ts             — Stripe billing portal
src/app/api/repairdesk/test-connection/route.ts — RepairDesk API test
src/app/api/repairdesk/sync/route.ts           — Customer import
src/app/api/repairdesk/poll/route.ts           — Cron: missed call detection
src/app/api/verify/route.ts                    — Phone verification
src/app/api/verify/webhook/route.ts            — Verification TwiML
src/lib/supabase-server.ts                     — Server Supabase client + admin
src/lib/supabase-client.ts                     — Browser Supabase client
src/lib/twilio-validator.ts                    — Webhook signature validation
src/lib/ai-service.ts                          — OpenAI integration
src/lib/repairdesk.ts                          — RepairDesk API client
src/lib/stripe.ts                              — Stripe client + plan config
src/lib/billing-guard.ts                       — Subscription status checker
src/lib/business-logic.ts                      — Business hours logic
src/lib/phone-utils.ts                         — E.164 phone normalization
src/lib/webhook-common.ts                      — Idempotency utilities
src/lib/logger.ts                              — Structured logging (PII redaction)
src/lib/env.ts                                 — Env var validation
src/lib/url-validator.ts                       — URL validation
src/lib/redirect-validator.ts                  — Auth redirect validation
src/instrumentation.ts                         — Next.js startup hook
next.config.ts                                 — Security headers, CSP
supabase/schema.sql                            — Core database schema + RLS
supabase/stripe-billing.sql                    — Stripe columns + trigger
supabase/tcpa-compliance.sql                   — Opt-out table
supabase/webhook-idempotency.sql               — Webhook events table
supabase/repairdesk-integration.sql            — RepairDesk columns
supabase/indexes.sql                           — Performance indexes
```

---

## AUDIT CATEGORIES

### 1. SECURITY AUDIT (Weight: 25%)

Audit every attack surface. This is a production SaaS handling PII (phone numbers, names, conversations), processing payments, and sending automated messages.

**Authentication & Authorization**
- Are all dashboard routes and API endpoints properly protected?
- Can a user access another user's data (broken access control)?
- Is the auth callback vulnerable to open redirects?
- Are session tokens handled securely (HttpOnly, Secure, SameSite)?
- Is there proper CSRF protection?
- Can an unauthenticated user reach any protected resource?

**Webhook Security**
- Are ALL Twilio webhooks validating signatures? (Check voice, SMS, AND transcription)
- Is the Stripe webhook verifying signatures correctly?
- Are webhook callback URL parameters (businessId, caller, called) tamper-proof?
- Can an attacker forge webhook events to inject fake leads or messages?
- Is the cron endpoint (`/api/repairdesk/poll`) properly authenticated?
- Are webhook events idempotent? Can replaying events cause duplicate SMS charges?

**Injection & Input Validation**
- SQL injection via Supabase queries (parameterized queries used correctly?)
- XSS vulnerabilities in rendered user content (business names, messages, templates)
- TwiML injection in voice responses (business name sanitized?)
- Command injection in any server-side operations
- SSRF via RepairDesk API URL or store URL configuration
- SMS injection (can a user craft messages that exploit Twilio?)

**Data Protection**
- Is PII (phone numbers, names, conversations) properly handled?
- Are API keys (Twilio, Stripe, RepairDesk, OpenAI) stored securely?
- Are service role keys ever exposed to the client?
- Is sensitive data logged inappropriately?
- Are error messages leaking internal details to users?

**TCPA Compliance**
- Is opt-out handling correct and complete (STOP, UNSUBSCRIBE, CANCEL, END, QUIT)?
- Does the system fail-closed if opt-out lookup fails?
- Are confirmation messages sent for opt-out and opt-in?
- Can the system accidentally send SMS to opted-out numbers?
- Is there an audit trail for opt-out events?

**Rate Limiting & Abuse Prevention**
- Can an attacker trigger unlimited SMS sends (Twilio cost attack)?
- Is rate limiting applied to all user-facing endpoints?
- Can webhook endpoints be abused for DDoS amplification?
- Are there limits on RepairDesk sync operations?

**Cryptography & Secrets**
- Are secrets managed correctly (.env, no hardcoding)?
- Is the verification token sufficiently random?
- Are Stripe webhook secrets rotated?
- Is HTTPS enforced everywhere (HSTS)?

---

### 2. UI/UX AUDIT (Weight: 25%)

Evaluate the interface from a real user's perspective. The target users are small service business owners (repair shops, contractors, etc.) who are NOT tech-savvy.

**Navigation & Information Architecture**
- Is the dashboard layout intuitive? Can users find what they need?
- Is the sidebar navigation clear and well-organized?
- Are there dead-end states where users get stuck?
- Is the mobile experience functional? (responsive design)
- Can users navigate back from any page?

**Onboarding Experience**
- Is the 5-step wizard clear and achievable for non-technical users?
- Are carrier-specific call forwarding instructions accurate and helpful?
- Is the Twilio number linking step understandable?
- Is the verification test step clear about what to expect?
- What happens if a step fails? Are error messages helpful?
- Can users go back to previous steps?
- Is there progress indication?

**Settings Page**
- Are SMS template presets useful and relevant for the target audience?
- Is the side-by-side layout for business hours and RepairDesk integration clear?
- Do per-section save buttons make it clear what's being saved?
- Is the timezone selector easy to use?
- Is the business hours configuration intuitive?
- Are there proper loading states and success/error feedback?

**Dashboard / Inbox**
- Is the lead list easy to scan and filter?
- Is the conversation view clear (inbound vs outbound messages)?
- Is the message input area accessible and obvious?
- Is the character counter visible?
- Are AI-generated messages clearly marked?
- Can users easily change lead status?
- Is the real-time update experience smooth?
- Is there an empty state for new users with no leads?

**Billing Page**
- Is the pricing clear and comparison between plans obvious?
- Is the "Start Free Trial" flow smooth?
- Is the current plan status and next billing date visible?
- Can users easily upgrade, downgrade, or cancel?
- Are past-due warnings noticeable but not alarming?
- Is the "Update Payment Method" flow obvious?

**Error Handling & Feedback**
- Do all forms show proper validation errors?
- Are loading states present for all async operations?
- Are success/error toasts clear and timely?
- Do users see helpful messages when things fail (not technical jargon)?
- Are there proper empty states and zero-data states?

**Accessibility**
- Is color contrast sufficient (WCAG 2.1 AA)?
- Are interactive elements keyboard-navigable?
- Are form labels properly associated with inputs?
- Are screen reader users supported (ARIA attributes)?
- Is focus management correct (modals, sheets)?
- Are loading/status changes announced to assistive technology?

**Visual Design & Polish**
- Is the visual hierarchy clear on each page?
- Is spacing and typography consistent?
- Are interactive states clear (hover, focus, active, disabled)?
- Is the landing page compelling and professional?
- Do animations enhance or distract from the experience?

---

### 3. PERFORMANCE & RELIABILITY AUDIT (Weight: 15%)

**Page Load Performance**
- Are there large client-side bundles that should be code-split?
- Are images optimized (Next.js Image component used)?
- Is there unnecessary client-side JavaScript on server-renderable pages?
- Are "use client" directives used minimally and appropriately?
- Are third-party scripts loaded efficiently?

**Database Performance**
- Are queries efficient? Are there N+1 query patterns?
- Are appropriate indexes defined for common query patterns?
- Are there missing indexes for frequently filtered columns?
- Is the Supabase Realtime subscription scoped properly?
- Could any query cause a full table scan?

**API Response Times**
- Are webhook handlers fast enough to avoid Twilio timeouts (15s)?
- Could OpenAI API calls block webhook responses?
- Are there unnecessary sequential API calls that could be parallelized?
- Is error handling causing slow cascading failures?

**Reliability**
- What happens when Twilio is down? Graceful degradation?
- What happens when OpenAI is down? Does SMS still send?
- What happens when Stripe is down? Can users still use the dashboard?
- What happens when Supabase is down?
- Are there retry mechanisms for critical operations (SMS sending)?
- Are webhook events properly reprocessed after failures?

**Caching**
- Are static pages and assets cached appropriately?
- Is `force-dynamic` used where necessary and not overused?
- Are Supabase queries cached where appropriate?

---

### 4. CODE QUALITY AUDIT (Weight: 15%)

**Architecture & Patterns**
- Is the separation of concerns clean (API routes vs business logic vs UI)?
- Are there circular dependencies?
- Is the lib/ directory well-organized?
- Are shared utilities properly extracted (webhook-common.ts, etc.)?
- Is error handling consistent across the codebase?

**TypeScript Usage**
- Are types properly defined and used (no excessive `any`)?
- Are Supabase database types generated and used?
- Are API request/response types defined?
- Are form schemas (Zod) properly typed?

**Code Duplication**
- Are there repeated patterns that should be extracted?
- Is business logic duplicated between client and server?
- Are similar API routes sharing common utilities?

**Error Handling**
- Are errors caught and handled at appropriate levels?
- Do catch blocks log useful context?
- Are user-facing error messages helpful?
- Do webhook handlers properly clean up on failure?
- Is the error handling fail-safe (e.g., opt-out checks)?

**Testing**
- Is test coverage adequate for critical paths?
- Are webhook handlers tested (voice, SMS, transcription, Stripe)?
- Are business logic functions tested (hours checking, phone normalization)?
- Are edge cases covered (empty inputs, null values, timezone boundaries)?
- Are integration tests needed for critical flows?
- Are there missing test cases you can identify?

---

### 5. USER EXPERIENCE & BUSINESS LOGIC AUDIT (Weight: 20%)

**Core Value Proposition**
- Does the missed call → SMS response flow work reliably end-to-end?
- Is the response time fast enough to feel "instant" to the caller?
- Are the default SMS templates effective and professional?
- Does the AI analysis provide actionable insights?

**SMS Template System**
- Are the 4 preset options for business hours relevant and professional?
- Are the 4 preset options for after hours relevant and professional?
- Does the `{{business_name}}` variable work correctly?
- Can templates accidentally be saved empty?
- Is the maximum message length enforced?

**Business Hours Logic**
- Does the timezone handling work correctly across all US timezones?
- What happens at exactly the boundary time (e.g., 9:00 AM open)?
- Does it handle days marked as closed correctly?
- What about holidays or custom schedules?
- Does DST (Daylight Saving Time) work correctly?

**Lead Management**
- Is the lead lifecycle clear (New → Contacted → Booked → Closed)?
- Can leads be created from multiple sources without duplicates?
- Is the phone number deduplication reliable?
- Does the RepairDesk import merge correctly with phone-based leads?
- Are lead status transitions validated?

**Billing & Subscription Logic**
- Does the 14-day trial work correctly?
- What happens when a trial expires and the user hasn't subscribed?
- Are billing guards correctly blocking SMS when subscription is inactive?
- Can a user bypass billing guards?
- What happens during the grace period for past-due accounts?
- Is the Stripe webhook handling all edge cases (failed payments, disputes, refunds)?

**RepairDesk Integration**
- Does the customer sync handle pagination correctly?
- Are phone numbers normalized during import?
- Is the missed call polling reliable?
- Does the 3-minute grace period work correctly for callbacks?
- What happens if RepairDesk API is down during a sync?

**Voicemail & Transcription Flow**
- Is the voicemail greeting professional and customizable?
- Does the transcription webhook handle long voicemails?
- What happens if transcription fails?
- Is the AI smart reply actually helpful?
- Can the AI generate inappropriate responses?

**Edge Cases**
- What happens if a customer calls multiple times rapidly?
- What happens if the business owner's phone is off?
- What happens with international phone numbers?
- What happens if Twilio number is not configured correctly?
- What happens if the user hasn't completed onboarding but tries to use the dashboard?
- What happens with very long business names in TwiML?
- What happens if SMS template contains special characters?

---

## OUTPUT FORMAT

Structure your audit report as follows:

```markdown
# LeadCatcher Comprehensive Audit Report
**Date**: [date]
**Auditor**: [name/model]
**Codebase Version**: [commit hash if available]

## Executive Summary
- **Overall Score**: X/10
- **Critical Issues**: [count]
- **High Issues**: [count]
- **Medium Issues**: [count]
- **Low Issues**: [count]
- **Info**: [count]
- **Top 3 Priorities**: [list]

## Scores by Category
| Category | Score | Weight | Weighted Score |
|----------|-------|--------|----------------|
| Security | X/10 | 25% | X |
| UI/UX | X/10 | 25% | X |
| Performance & Reliability | X/10 | 15% | X |
| Code Quality | X/10 | 15% | X |
| User Experience & Business Logic | X/10 | 20% | X |
| **Overall** | | | **X/10** |

## Category 1: Security
### Score: X/10

#### Finding S-01: [Title]
- **Severity**: Critical/High/Medium/Low/Info
- **Priority**: P0/P1/P2/P3
- **File**: `path/to/file.ts:line`
- **Problem**: ...
- **Impact**: ...
- **Fix**: ...
```code fix```

[Repeat for each finding]

## Category 2: UI/UX
### Score: X/10
[Same format]

## Category 3: Performance & Reliability
### Score: X/10
[Same format]

## Category 4: Code Quality
### Score: X/10
[Same format]

## Category 5: User Experience & Business Logic
### Score: X/10
[Same format]

## Recommendations Summary
### P0 — Fix Immediately (blocking production safety)
1. ...

### P1 — Fix This Week (important for quality)
1. ...

### P2 — Fix This Sprint (nice to have)
1. ...

### P3 — Backlog (future improvements)
1. ...

## Positive Observations
[List things that are done well — security measures, architecture decisions, etc.]
```

---

## IMPORTANT GUIDELINES

1. **Be specific.** Every finding must reference exact file paths and line numbers. Generic advice like "improve error handling" is not acceptable.
2. **Be actionable.** Every finding must include a concrete fix, ideally with code snippets.
3. **Be honest.** If something is done well, say so. Don't manufacture issues for a longer report.
4. **Prioritize ruthlessly.** A security vulnerability that could cause a data breach is more important than a misaligned button.
5. **Think like an attacker** for security. Think like a confused small business owner for UX.
6. **Consider the business context.** This is for non-technical service business owners (repair shops, contractors). They need things to "just work."
7. **Don't repeat known issues.** If there's an existing AUDIT_REPORT.md, note which issues are already documented vs new discoveries.
8. **Test edge cases mentally.** Walk through user flows step by step and identify where things can break.
9. **Consider production environment.** Some issues only manifest in production (missing env vars, CORS, CSP violations, etc.).
10. **Score fairly.** A 7/10 means "good with notable issues." An 8/10 means "strong with minor issues." A 9/10 means "excellent, production-ready." A 10/10 doesn't exist.
