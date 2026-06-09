# LeadCatcher v2 — Greenfield Rebuild Design

> Status: **Proposal / for review.** This is a design artifact, not implemented code.
> It describes how LeadCatcher would be built from scratch, learning from v1.
> Port the *concepts and the good security instincts* from v1 — not the code.

---

## 0. Why rebuild

v1 has a strong core idea ("never lose a lead to a missed call") and genuinely
good security hygiene (Twilio signature validation, webhook idempotency, RLS,
TCPA fail-closed, PII redaction). But it has out-grown its foundations:

1. **Feature sprawl** — 11 dashboard destinations, most of which are different
   views of the same underlying entity (Inbox / Hot Leads / Calls / Follow-Ups /
   Actions / Customer).
2. **Two parallel data models** — every missed call writes to *both* `leads` and
   `call_analyses`, kept in sync by hand.
3. **A data model that can't represent reality** — `UNIQUE(business_id,
   caller_phone)` collapses every future contact from a repeat customer into one
   row. No concept of a conversation/job distinct from a contact.
4. **Broken multi-tenancy** — one shared Twilio number + unique index =
   one business per deployment; `businesses.user_id UNIQUE` = one user per
   business, yet the app has "assign owner" / "coaching by owner" / "bulk-assign".
5. **Two competing data-access models** — the inbox reads client-side via
   supabase-js + RLS; everything else reads server-side via the service-role
   admin client across ~50 route handlers. This split is *why* DB triggers exist
   to defend sensitive columns from client tampering.
6. **8 polling crons** doing work that should be event-driven.

v2 fixes these at the foundation, where they're cheap.

---

## 1. Product scope — one loop, ruthlessly

The product is one sentence and one loop:

> **Capture** the missed contact → **Respond** instantly → **Recover** the job →
> **Prove** the ROI.

Everything that doesn't serve that loop is cut from the core or deferred to a
paid tier.

### Tier 1 (the product — what every customer gets)
- Missed-call **instant text-back** (the hero feature)
- **Unified conversation inbox** (calls + SMS + voicemail in one thread)
- **AI voicemail summary + intent/urgency** (so owners triage in seconds)
- **Callback queue** ("who needs a call back, by when")
- **ROI / recovered-revenue** dashboard (the renewal argument)

### Tier 2 (Pro — grow into it)
- Team seats + per-agent assignment
- Coaching / call QA / audit
- Advanced analytics, pattern detection
- CRM / RepairDesk-style integrations

### Cut or merge from v1
- `Hot Leads`, `Calls`, `Follow-Ups`, `Actions`, `Customer` → these are **views
  over one timeline**, not five nav items. They become filters/tabs on Inbox +
  the Today screen.
- Standalone `call_analyses` table → folded into `events` (see §3).
- Most of the 8 crons → event-driven jobs + 1 scheduler (see §4).

---

## 2. Information architecture (UI/UX)

v1 opens on a list. v2 opens on a **decision**.

```
┌─────────────────────────────────────────────┐
│  TODAY  (home)                                │
│  ───────────────────────────────────────     │
│  4 missed calls today                         │
│  2 awaiting callback  ·  next due in 12 min   │
│  $3,200 recovered this month                  │
│  [ Call back now → ]   [ Open inbox → ]       │
└─────────────────────────────────────────────┘
```

Nav shrinks from 11 to **4**:

| Nav      | What it is                                              |
|----------|--------------------------------------------------------|
| Today    | The action-oriented home (above). Mobile-first.        |
| Inbox    | The unified conversation timeline (filters: needs callback / unread / won / lost) |
| Insights | ROI + analytics + (Pro) coaching/audit                 |
| Settings | Business, number/forwarding, hours, templates, billing |

UX principles:
- **Mobile-first.** The user is a shop owner with greasy hands and a phone.
- **Money-forward framing** everywhere ("recovered $X" beats "12 leads contacted").
- **One primary action per screen.** No screen makes the owner choose between
  five buttons.
- **Generated, not hand-typed types** for every entity rendered.

---

## 3. Data model (the foundation)

One coherent graph. ROI and teams are first-class, not bolted on.

```
orgs ─┬─ members        (a user's role within an org)
      ├─ phone_numbers  (provisioned per org — multi-tenant from day one)
      ├─ contacts       (the person who reached out)
      │    └─ conversations  (a thread / job — MANY per contact)
      │         └─ events    (call | sms | voicemail | note | status | outcome)
      ├─ outcomes       ($ value + won/lost — ROI is stored, not inferred)
      ├─ opt_outs       (TCPA — keep v1's fail-closed behavior)
      └─ webhook_events (idempotency — keep v1's atomic-claim pattern)
```

The key shifts from v1:
- **`contacts` ≠ `conversations`.** A repeat customer is one contact with many
  conversations. No more "one row per phone forever."
- **`events` is the single timeline.** AI analysis, follow-ups, hot-lead status,
  action items are *derivations/columns on events*, not separate tables.
- **`orgs` + `members`** replaces `businesses.user_id UNIQUE` — teams work.
- **`phone_numbers`** is its own table — multi-tenancy is the default, not a
  documented limitation.
- **`outcomes`** stores recovered revenue so ROI is a `SUM`, not a heuristic.

Sketch (illustrative — not final DDL):

```sql
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/New_York',
  business_hours jsonb,
  -- billing
  stripe_customer_id text unique,
  stripe_subscription_id text,
  plan text not null default 'starter',
  status text check (status in ('trialing','active','past_due','canceled','unpaid')),
  trial_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','agent')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table phone_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  e164 text not null unique,             -- the provisioned/forwarding number
  provider text not null default 'twilio',
  provider_sid text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  phone text not null,
  name text,
  created_at timestamptz not null default now(),
  unique (org_id, phone)                 -- one contact per phone, MANY conversations
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  assigned_to uuid references auth.users(id),  -- per-agent assignment
  status text not null default 'new'
    check (status in ('new','responded','awaiting_callback','won','lost')),
  intent text,
  urgency text check (urgency in ('low','medium','high')),
  ai_summary text,
  callback_due_at timestamptz,
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  type text not null
    check (type in ('call','sms_in','sms_out','voicemail','note','status','outcome')),
  body text,
  direction text check (direction in ('inbound','outbound')),
  is_ai_generated boolean not null default false,
  metadata jsonb,                        -- transcription, scores, audit, etc.
  created_at timestamptz not null default now()
);

create table outcomes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  result text not null check (result in ('won','lost')),
  amount_cents integer,                  -- recovered revenue → ROI dashboard
  created_at timestamptz not null default now()
);
```

RLS: every table scoped by `org_id ∈ (select org_id from members where user_id =
auth.uid())`. RLS is **defense-in-depth**, not the primary gate (see §4).

---

## 4. Architecture

### Data access — pick ONE pattern
- **Reads:** Server Components → one typed **data layer** (`/lib/data/*`) →
  Supabase. No direct client-side table reads.
- **Writes:** Server Actions + a few route handlers. Validated with zod at the
  boundary.
- **RLS:** on for every table as defense-in-depth. Because the client never
  writes sensitive tables directly, **the `protect_*_columns` triggers from v1
  disappear** — the architecture removes the need for them.
- **Types:** generated from the DB (`supabase gen types`). No hand-written
  interfaces.

### Telephony ingestion — one pipeline behind a provider interface
v1 already half-abstracts this (Twilio + Telnyx validators). Formalize it:

```
inbound webhook → verify signature → claim idempotency → enqueue → worker
                                                                     ├─ upsert contact/conversation
                                                                     ├─ send instant text-back
                                                                     ├─ (async) transcribe + AI summarize
                                                                     └─ emit event(s)
```

- `TelephonyProvider` interface: `sendSms`, `provisionNumber`,
  `validateWebhook`, `parseInbound`. Twilio and Telnyx are implementations.
- **Keep v1's atomic `claimWebhookEvent` idempotency** — it's good.
- Replace the **8 crons with a queue + 1 scheduler** (Inngest / QStash /
  Supabase queues). Follow-ups, digests, watchdog become scheduled/event jobs,
  not polling endpoints.

### AI — one service, one prompt registry
Collapse v1's nine AI modules (`ai-service`, `ai-auto-reply`, `ai-call-auditor`,
`call-summarizer`, `call-scoring`, `lead-qualification`, `recovery-score`,
`pattern-tracker`, `coaching-report`) into:
- one `lib/ai/` service,
- a **central prompt registry** with versioned prompts,
- one model-config source (default to the latest, most capable model),
- **structured outputs validated with zod**.

Ship only Tier-1 AI first (auto-reply, voicemail summary, intent/urgency).
Coaching/audit/pattern are Pro-tier and come later.

---

## 5. Onboarding (v1's riskiest surface — fix it first)

v1 onboarding depends on honor-system carrier forwarding codes, a fragile
"boomerang" verification, and trial-account caller-ID gotchas (v1's own
B-01/B-05). v2:

1. **Provision a dedicated number per org** programmatically
   (`TelephonyProvider.provisionNumber`) — surface the real cost, no shared number.
2. **Copy-pasteable per-carrier forwarding** instructions with the number
   pre-filled.
3. **Real verification** that reports *why* it failed (unverified caller ID,
   unreachable webhook URL, forwarding not set) instead of a generic error.
4. The "Run Test Call" control lives on **both** the wizard and Settings (v1's
   B-04 sends users to a Settings page that lacks the button).

---

## 6. Billing & trust

- Match marketing to reality (v1's "No credit card required" is false per B-03).
  Pick one model and make the copy true.
- Gate on a real subscription from signup; no silent grace period that hides a
  never-created subscription until it expires.
- The upgrade argument is the ROI screen: *"You recovered $X this month — keep it."*

---

## 7. Tech stack

Mostly keep v1's choices — they're sound — and tighten:

| Layer        | Choice                                                       |
|--------------|-------------------------------------------------------------|
| Framework    | Next.js (App Router), React 19, Server Components for reads  |
| UI           | Tailwind + shadcn/ui (keep)                                  |
| Backend      | Supabase (Postgres, Auth, RLS, Realtime)                     |
| Telephony    | Provider interface over Twilio / Telnyx                      |
| Jobs         | Queue + scheduler (Inngest / QStash) instead of 8 crons     |
| AI           | One `lib/ai/` service, central prompts, structured outputs  |
| Billing      | Stripe (keep)                                               |
| Types        | Generated from DB                                            |
| Validation   | Zod at every boundary (keep)                                |

Repo hygiene from day one: single source of schema truth (migrations only —
no `schema.sql` + `schema-enhanced.sql` drift), no committed temp files, one
living design doc instead of four overlapping audit reports.

---

## 8. Phased build order

1. **Foundation** — orgs/members/contacts/conversations/events/outcomes schema +
   RLS + generated types + auth/onboarding skeleton.
2. **Capture + Respond** — telephony provider interface, voice/SMS ingestion,
   idempotency, instant text-back, unified inbox.
3. **Triage** — voicemail transcription + AI summary/intent/urgency, callback
   queue, the Today screen.
4. **Recover + Prove** — outcomes capture, ROI dashboard, Stripe billing gated
   correctly.
5. **Pro tier** — teams/assignment, coaching/audit, advanced analytics,
   integrations.

Ship 1–4 as the real product. 5 is the expansion revenue.

---

## 9. What we explicitly keep from v1

These were done well — don't reinvent them:
- Twilio webhook **signature validation**
- **Webhook idempotency** via atomic claim
- **TCPA opt-out, fail-closed**
- **PII redaction** in structured logs
- **Fail-fast env** validation
- shadcn/ui component layer and the SMS-style thread UI
