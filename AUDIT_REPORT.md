# Lead Catcher - Comprehensive Audit Report

**Date:** January 15, 2026
**Auditor:** Claude Code (Opus 4.5)
**Repository:** LeadCatcher
**Branch:** claude/audit-lead-catcher-app-Yqjg5

---

## 1. Executive Summary

### Overall Health Score: 6.5/10

**Rationale:** The Lead Catcher application demonstrates solid foundational architecture with good security practices in several areas (RLS policies, Twilio signature validation, rate limiting, PII redaction in logs). However, critical issues exist in code quality (16 ESLint errors), missing security validation in one webhook, potential open redirect vulnerability, and missing production essentials (no .env.example, limited tests, deprecated middleware convention).

### Top 5 Biggest Risks

| Rank | Risk | Severity | Impact |
|------|------|----------|--------|
| 1 | **Transcription webhook lacks Twilio signature validation** | High | Attackers could inject fake transcriptions and spam users |
| 2 | **Open redirect in auth callback** | High | Phishing attacks via malicious redirect URLs |
| 3 | **React immutability error in settings page** | Blocker | Settings page may crash or behave unpredictably |
| 4 | **No .env.example file** | Medium | Developer onboarding friction, accidental secret exposure risk |
| 5 | **Deprecated middleware convention** | Medium | Future Next.js upgrades will break functionality |

### Top 5 Best Parts

| Rank | Strength |
|------|----------|
| 1 | **Comprehensive RLS policies** - Multi-tenant data isolation is well-implemented |
| 2 | **PII redaction in logger** - Phone numbers automatically masked in logs |
| 3 | **Twilio signature validation** - Voice and SMS webhooks validate request authenticity |
| 4 | **TCPA compliance** - Proper opt-out/opt-in handling for SMS messaging |
| 5 | **Rate limiting** - Upstash Redis rate limiting protects API endpoints |

---

## 2. Findings Table (Sorted by Severity)

| ID | Severity | Category | Finding | Evidence | Recommendation | Effort |
|----|----------|----------|---------|----------|----------------|--------|
| F01 | **Blocker** | Code Quality | Settings page `fetchSettings` accessed before declaration causes React immutability error | `src/app/dashboard/settings/page.tsx:38` | Move `fetchSettings` definition before the useEffect that calls it, or wrap in useCallback | S |
| F02 | **High** | Security | Transcription webhook does NOT validate Twilio signature | `src/app/api/webhooks/twilio/transcription/route.ts:9-14` - Comment says "verify loosely", no validation called | Add `validateTwilioRequest()` call before processing | S |
| F03 | **High** | Security | Open redirect vulnerability in auth callback - `next` param not validated | `src/app/auth/callback/route.ts:8` - `next` param used directly in redirect | Validate `next` starts with `/` and doesn't contain `//` or external URLs | S |
| F04 | **High** | Security | Transcription callback URL params (businessId, caller, called) are user-controllable without signature validation | `src/app/api/webhooks/twilio/voice/route.ts:95` | Validate signature in transcription webhook OR sign the callback URL params with HMAC | M |
| F05 | **Medium** | DevOps | Missing `.env.example` file - 12+ required env vars undocumented | Root directory missing `.env.example` | Create `.env.example` with all required variables (masked values) | S |
| F06 | **Medium** | DevOps | Deprecated middleware convention warning | `npm run build` output | Migrate from `middleware.ts` to `proxy.ts` per Next.js 16 guidance | M |
| F07 | **Medium** | Code Quality | 16 ESLint errors including `@typescript-eslint/no-explicit-any` violations | `src/lib/logger.ts:10,13,49,53,57,65` and others | Replace `any` types with proper type definitions | M |
| F08 | **Medium** | Code Quality | Multiple unused imports/variables across codebase | ESLint output - 18 warnings | Remove unused code or prefix with `_` if intentional | S |
| F09 | **Medium** | UI/UX | Unescaped apostrophes and quotes in JSX causing ESLint errors | `src/components/landing/Hero.tsx:45,96`, `src/components/onboarding/Wizard.tsx:170,249,255,272` | Use HTML entities: `&apos;` `&quot;` or escape properly | S |
| F10 | **Medium** | Reliability | React hooks missing dependencies | `src/app/dashboard/page.tsx:98,141`, `src/app/dashboard/settings/page.tsx:39` | Add `supabase` to dependency arrays or use useCallback | S |
| F11 | **Medium** | Feature Gap | Verify webhook endpoint referenced but not implemented | `src/app/api/verify/route.ts:71` references `/api/verify/webhook` | Implement the TwiML endpoint or remove the reference | M |
| F12 | **Medium** | Code Quality | Deprecated `scmp` package via Twilio SDK | `npm ci` output | Consider pinning Twilio version or wait for SDK update | S |
| F13 | **Low** | Security | No explicit CORS configuration | No CORS headers in `next.config.ts` beyond security headers | Add explicit CORS policy if cross-origin requests expected | S |
| F14 | **Low** | Code Quality | `npm run lint` command broken - invalid directory | `next lint` command fails | Fix package.json lint script or use `npx eslint src/` | S |
| F15 | **Low** | UI/UX | Footer links are placeholder (`#`) | `src/components/landing/Footer.tsx:22-24` | Implement Privacy, Terms, Contact pages or remove links | M |
| F16 | **Low** | Reliability | Single test file with 9 tests - low coverage | Only `src/lib/phone-utils.test.ts` exists | Add tests for business-logic.ts, ai-service.ts, API routes | L |
| F17 | **Low** | Code Quality | `formatTemplate` imported but never used | `src/app/api/webhooks/twilio/voice/route.ts:4` | Either use it for SMS template formatting or remove import | S |
| F18 | **Low** | UX | Wizard generates mock Twilio number instead of provisioning real one | `src/components/onboarding/Wizard.tsx:73-74` | MVP acceptable, but document limitation; implement Twilio number purchase for production | L |
| F19 | **Nit** | Code Quality | Unused `router` in login page | `src/app/login/page.tsx:19` | Remove unused variable | S |
| F20 | **Nit** | Code Quality | Unused `Link` import in onboarding page | `src/app/onboarding/page.tsx:4` | Remove unused import | S |

---

## 3. Security Deep Dive

### 3.1 Threat Model

**Assets to Protect:**
- Lead PII (phone numbers, names, messages)
- Business configuration and credentials
- Twilio/OpenAI API credentials
- User authentication sessions

**Threat Actors:**
1. External attackers (via webhook spoofing, XSS, injection)
2. Malicious users (tenant isolation bypass)
3. Data exfiltration (logging, error messages)

### 3.2 Authentication & Authorization

| Aspect | Status | Notes |
|--------|--------|-------|
| Auth Mechanism | ✅ Good | Supabase Auth with magic link (OTP) |
| Session Management | ✅ Good | SSR cookie handling via @supabase/ssr |
| Middleware Protection | ✅ Good | `/dashboard` and `/onboarding` protected |
| API Route Auth | ✅ Good | `/api/messages/send` and `/api/verify` check user |
| Webhook Auth | ⚠️ Partial | Voice/SMS validate Twilio sig; **Transcription does NOT** |
| RLS Policies | ✅ Good | Comprehensive policies on all tables |
| Admin Client | ⚠️ Caution | `supabaseAdmin` bypasses RLS - used correctly in webhooks |

### 3.3 Critical Vulnerabilities

#### VULN-01: Missing Signature Validation on Transcription Webhook
**File:** `src/app/api/webhooks/twilio/transcription/route.ts:9-14`
**Exploit Scenario:** Attacker sends POST request with crafted `TranscriptionText`, `businessId`, `caller`, `called` parameters to inject fake voicemails, spam leads, or trigger AI-generated replies to arbitrary numbers.
**Fix:**
```typescript
// Add at line 9:
const isValid = await validateTwilioRequest(request);
if (!isValid) {
    logger.warn('[Transcription Webhook] Invalid Twilio signature');
    return new Response('Unauthorized', { status: 403 });
}
```

#### VULN-02: Open Redirect in Auth Callback
**File:** `src/app/auth/callback/route.ts:8`
**Exploit Scenario:** Attacker crafts URL: `https://app.com/auth/callback?code=X&next=//evil.com` - after auth, user redirected to phishing site.
**Fix:**
```typescript
const next = searchParams.get('next') ?? '/dashboard';
// Validate redirect target
const safeNext = next.startsWith('/') && !next.startsWith('//') && !next.includes(':')
    ? next
    : '/dashboard';
return NextResponse.redirect(`${origin}${safeNext}`);
```

### 3.4 Input Validation Summary

| Input Point | Validation | Status |
|-------------|------------|--------|
| Phone numbers | `normalizePhoneNumber()` + regex | ✅ Good |
| SMS body length | Max 1600 chars in API | ✅ Good |
| Form data (Twilio) | Signature validation (partial) | ⚠️ Partial |
| Business name in TwiML | Sanitized with `replace(/[<>&"']/g, '')` | ✅ Good |
| URL query params | No validation in transcription webhook | ❌ Missing |
| Auth redirect | No validation | ❌ Missing |

### 3.5 Secrets Management

| Check | Status |
|-------|--------|
| Hardcoded secrets in code | ✅ None found |
| .env files committed | ✅ Properly gitignored |
| Service role key usage | ✅ Server-side only |
| PII in logs | ✅ Redacted by logger |

---

## 4. UI/UX Report

### 4.1 Prioritized Issues

| Priority | Issue | Location | Impact |
|----------|-------|----------|--------|
| 1 | No navigation from dashboard to settings | Dashboard lacks settings link | Users can't access settings without URL |
| 2 | No logout functionality visible | Dashboard/Settings pages | Users can't sign out |
| 3 | Call button is non-functional | `src/app/dashboard/page.tsx:296` | Clicking "Call" does nothing |
| 4 | Empty state for new users | Dashboard shows "Select a lead" | Confusing for users with 0 leads |
| 5 | Mobile sidebar close on select | Works correctly | ✅ Good |
| 6 | Character counter UX | Shows "X/1600" with orange warning >1520 | ✅ Good |
| 7 | Form validation messages | Zod validation with inline errors | ✅ Good |
| 8 | Loading states | Global loader + inline spinners | ✅ Good |
| 9 | Error boundary | Custom error page with retry | ✅ Good |
| 10 | Placeholder footer links | Privacy/Terms/Contact are `#` | Needs implementation |

### 4.2 Accessibility (a11y)

| Check | Status | Notes |
|-------|--------|-------|
| Semantic HTML | ✅ | Proper use of header, main, footer |
| Form labels | ✅ | Labels present with `htmlFor` |
| ARIA attributes | ✅ | `aria-label`, `role="option"`, `aria-selected` present |
| Keyboard navigation | ⚠️ | Lead list items have tabIndex but no visible focus ring |
| Color contrast | ✅ | Using slate/blue palette with good contrast |
| Screen reader | ⚠️ | Sheet has `sr-only` title, but some buttons lack labels |

### 4.3 Responsiveness

- ✅ Mobile header with hamburger menu
- ✅ Sheet-based navigation on mobile
- ✅ Responsive grid layouts (md: breakpoints)
- ✅ Message bubbles adapt width (85% mobile, 70% desktop)

---

## 5. Feature Gaps & Enhancement Ideas

| Feature | Current State | Recommendation | Implementation Approach |
|---------|---------------|----------------|------------------------|
| Real Twilio provisioning | Mock number generated | Implement Twilio number purchase via API | Use Twilio IncomingPhoneNumbers API in onboarding |
| Conversation export | Not implemented | Add CSV/PDF export of leads and messages | New API route + frontend button |
| Lead search filters | Basic text search only | Add status filter, date range picker | Extend dashboard state + Supabase queries |
| Team members | DB schema ready but commented | Enable team_members table and policies | Uncomment schema, add invite flow |
| Multi-number support | DB schema ready but commented | Allow Pro users to have multiple Twilio numbers | Uncomment twilio_numbers table |
| Stripe integration | Pricing shown but no checkout | Implement Stripe checkout for plans | Add Stripe SDK, checkout API route |
| Voicemail playback | Only transcription shown | Store voicemail URL, add audio player | Update leads table, add audio component |
| AI auto-reply toggle | Always on | Let users enable/disable AI responses | Add setting toggle, check in webhook |

---

## 6. Reliability & Test Plan

### 6.1 Manual Test Cases

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| TC01 | Magic link login | Enter email, click link, verify redirect | Lands on /dashboard |
| TC02 | Onboarding flow | Complete 4-step wizard | Business created, lands on dashboard |
| TC03 | Missed call handling | Call business number, don't answer | Lead created, SMS sent, owner notified |
| TC04 | SMS reply handling | Reply to auto-text | Message logged, AI analysis runs |
| TC05 | TCPA opt-out | Send "STOP" | Opt-out recorded, confirmation sent |
| TC06 | Send message from dashboard | Select lead, type message, send | SMS delivered, message logged |
| TC07 | Status update | Change lead status | DB updated, UI reflects change |
| TC08 | Settings save | Modify template/hours, save | Settings persisted |

### 6.2 Automated Tests to Add

| Priority | Test | Rationale |
|----------|------|-----------|
| Critical | `twilio-validator.test.ts` | Verify signature validation logic |
| Critical | `api/webhooks/twilio/voice.test.ts` | Test webhook with mock Twilio payload |
| Critical | `api/webhooks/twilio/sms.test.ts` | Test opt-out handling, lead creation |
| High | `api/messages/send.test.ts` | Test auth, opt-out check, message sending |
| High | `business-logic.test.ts` | Test isBusinessHours with various timezones |
| Medium | `ai-service.test.ts` | Mock OpenAI responses, test fallback |
| Medium | Integration: onboarding → dashboard | E2E flow with Playwright/Cypress |

### 6.3 Current Test Coverage

- **Existing:** `phone-utils.test.ts` (9 tests, 100% coverage of phone-utils)
- **Missing:** Everything else - approximately 5% overall coverage

---

## 7. Implementation Roadmap

### NOW (0-3 Days) - Critical Fixes

| Task | File | Effort |
|------|------|--------|
| Fix fetchSettings hoisting error | `src/app/dashboard/settings/page.tsx` | 10 min |
| Add signature validation to transcription webhook | `src/app/api/webhooks/twilio/transcription/route.ts` | 15 min |
| Fix open redirect vulnerability | `src/app/auth/callback/route.ts` | 15 min |
| Create .env.example | Root directory | 30 min |
| Fix ESLint errors (unescaped entities) | Multiple files | 30 min |
| Add missing React hook dependencies | Dashboard files | 30 min |

### NEXT (1-2 Weeks) - Stability & Polish

| Task | Effort |
|------|--------|
| Add logout button to dashboard | S |
| Add navigation link to settings | S |
| Implement or hide "Call" button | S |
| Fix placeholder footer links | M |
| Remove unused imports/variables | S |
| Replace `any` types with proper typing | M |
| Add tests for webhooks and business logic | L |
| Migrate middleware to proxy convention | M |
| Implement verify/webhook endpoint | M |

### LATER (1-2 Months) - Features & Scale

| Task | Effort |
|------|--------|
| Real Twilio number provisioning | L |
| Stripe payment integration | L |
| Team member functionality | L |
| Multi-number support | M |
| Lead export (CSV/PDF) | M |
| Voicemail audio playback | M |
| E2E test suite | L |

---

## 8. Required Environment Variables

Create `.env.example` with the following:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
TWILIO_WEBHOOK_URL=https://your-app.com (optional, for load balancers)

# App
APP_BASE_URL=https://your-app.com
NEXT_PUBLIC_APP_URL=https://your-app.com

# Redis (Upstash - Optional for rate limiting)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token

# OpenAI (Optional for AI features)
OPENAI_API_KEY=sk-xxxxx
OPENAI_MODEL=gpt-4o
```

---

## 9. Conclusion

Lead Catcher is a well-architected MVP with solid foundations in authentication, multi-tenancy, and core telephony integration. The critical path (missed call → SMS → lead capture → dashboard) is functional. However, before production deployment, the following must be addressed:

1. **Security-critical:** Fix transcription webhook signature validation and auth redirect validation
2. **Code quality:** Fix the settings page React error and ESLint issues
3. **DevOps:** Create .env.example and address middleware deprecation warning

With these fixes (estimated 2-4 hours of work), the application would be production-ready for initial users. Longer-term improvements around test coverage, feature completeness (Stripe, team members), and observability would strengthen the product for scale.

---

*Report generated by Claude Code audit system*
