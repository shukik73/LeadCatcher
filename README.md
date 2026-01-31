# LeadCatcher

**Never lose a lead to a missed call.**

LeadCatcher is a B2B SaaS that automatically recovers revenue for service businesses (auto repair, HVAC, contractors) by capturing missed calls via SMS and providing a unified inbox for lead management.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Supabase Configuration](#supabase-configuration)
- [Twilio Configuration](#twilio-configuration)
- [Running the App](#running-the-app)
- [Deploying to Production](#deploying-to-production)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [API Routes](#api-routes)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

---

## Features

- **Missed Call Text Back** - Automatically texts callers when you miss their call
- **AI Voicemail Summary** - Transcribes and summarizes voicemails using OpenAI
- **Unified Inbox** - Manage all SMS conversations and leads from one dashboard
- **2-Way Texting** - Reply to leads directly from the dashboard
- **Real-time Updates** - Instant notifications via Supabase Realtime
- **Business Hours** - Configure when auto-replies are sent
- **TCPA Compliance** - Automatic opt-out handling (STOP/START keywords)
- **Multi-tenant Isolation** - Row Level Security ensures data privacy

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (App Router), React 19, Tailwind CSS, shadcn/ui |
| Backend | Supabase (Postgres, Auth, Realtime, RLS) |
| Telephony | Twilio (Voice, SMS, Transcription webhooks) |
| AI | OpenAI (voicemail analysis) |
| Rate Limiting | Upstash Redis |
| Validation | Zod, React Hook Form |

---

## Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org)
- **Supabase Account** - [Sign up](https://supabase.com)
- **Twilio Account** - [Sign up](https://www.twilio.com) (with a purchased phone number)
- **Vercel Account** (for deployment) - [Sign up](https://vercel.com)

Optional:
- **OpenAI API Key** - For AI-powered voicemail analysis
- **Upstash Redis** - For API rate limiting

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/shukik73/LeadCatcher.git
cd LeadCatcher

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env.local

# 4. Fill in your environment variables (see next section)

# 5. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values:

### Required

| Variable | Description | Where to find it |
|----------|-------------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | Supabase Dashboard > Settings > API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public/anon key | Supabase Dashboard > Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only) | Supabase Dashboard > Settings > API |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID (starts with AC) | [Twilio Console](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | Twilio Console |
| `TWILIO_PHONE_NUMBER` | Your Twilio number in E.164 format | Twilio Console > Phone Numbers |
| `APP_BASE_URL` | Server-side app URL | `http://localhost:3000` (dev) or your domain |
| `NEXT_PUBLIC_APP_URL` | Client-side app URL | Same as above |

### Optional

| Variable | Description |
|----------|-------------|
| `TWILIO_WEBHOOK_URL` | Override webhook URL (for ngrok/load balancers) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL for rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token |
| `OPENAI_API_KEY` | OpenAI key for AI voicemail analysis |
| `OPENAI_MODEL` | Model to use (default: `gpt-4o`) |

---

## Database Setup

Run these SQL scripts **in order** in the Supabase SQL Editor (Dashboard > SQL Editor > New Query):

### Step 1: Create tables

Run the contents of `supabase/schema.sql`. This creates:
- `businesses` - Business profiles linked to users
- `leads` - Captured leads from missed calls
- `messages` - SMS conversation history
- RLS policies for data isolation
- Performance indexes

### Step 2: TCPA compliance table

Run the contents of `supabase/tcpa-compliance.sql`. This creates:
- `opt_outs` - Tracks phone numbers that sent STOP
- RLS policies and indexes

### Step 3: Additional indexes (optional)

Run `supabase/indexes.sql` for additional performance indexes.

### Verify setup

After running the scripts, check that these tables exist in Supabase:
- `businesses`
- `leads`
- `messages`
- `opt_outs`

And that RLS is enabled on all tables (green shield icon).

---

## Supabase Configuration

### Authentication Settings

1. Go to **Supabase Dashboard > Authentication > URL Configuration**
2. Set **Site URL** to your production domain:
   ```
   https://www.leadcatcher.app
   ```
   (Use `http://localhost:3000` for local development)
3. Add **Redirect URLs**:
   ```
   https://www.leadcatcher.app/**
   http://localhost:3000/**
   ```

### Email Settings

1. Go to **Authentication > Email Templates**
2. The password reset email uses the Site URL for the redirect link
3. For testing, you can disable "Confirm email" under **Authentication > Providers > Email**

### Realtime

Realtime is enabled by default for the `leads` and `messages` tables. The dashboard subscribes to changes automatically.

---

## Twilio Configuration

### 1. Purchase a Phone Number

1. Go to [Twilio Console > Phone Numbers > Buy a Number](https://console.twilio.com/us1/develop/phone-numbers/manage/search)
2. Buy a local US number with **Voice** and **SMS** capabilities
3. Copy the number (e.g., `+15551234567`) to your `.env.local` as `TWILIO_PHONE_NUMBER`

### 2. Configure Webhooks

Go to **Twilio Console > Phone Numbers > Manage > Active Numbers** and click your number.

Set these webhook URLs:

| Type | URL | Method |
|------|-----|--------|
| **Voice - A call comes in** | `https://your-domain.com/api/webhooks/twilio/voice` | HTTP POST |
| **Messaging - A message comes in** | `https://your-domain.com/api/webhooks/twilio/sms` | HTTP POST |

Replace `your-domain.com` with your actual domain (e.g., `www.leadcatcher.app`).

### 3. A2P 10DLC Registration (Required for US messaging)

If sending SMS to US numbers, you must register for A2P 10DLC:

1. Go to **Twilio Console > Messaging > Compliance > Registrations**
2. Register your **Brand** (your business info)
3. Register a **Campaign** (use case: customer notifications)
4. Wait for approval (usually 1-5 business days)

Without A2P registration, your messages may be filtered or blocked by carriers.

### 4. Local Development with ngrok

For testing webhooks locally:

```bash
# Install ngrok
npm install -g ngrok

# Start your dev server
npm run dev

# In another terminal, expose port 3000
ngrok http 3000
```

Copy the ngrok URL (e.g., `https://abc123.ngrok-free.app`) and:
1. Set `TWILIO_WEBHOOK_URL` in `.env.local` to the ngrok URL
2. Update Twilio webhook URLs to use the ngrok URL

---

## Running the App

### Development

```bash
npm run dev          # Start dev server at localhost:3000
npm run lint         # Run ESLint
npm run test         # Run tests (Vitest)
npx tsc --noEmit     # TypeScript type checking
npm run build        # Production build
```

### User Flow

1. **Sign Up** - Visit `/login` and create an account
2. **Onboarding** - Complete the 5-step setup wizard:
   - Enter business info (name, phone)
   - Select your carrier
   - Link your Twilio number
   - Set up call forwarding on your phone
   - Test the forwarding
3. **Dashboard** - View leads, conversations, and reply to customers
4. **Settings** - Configure business hours, timezone, and SMS templates

---

## Deploying to Production

### Deploy to Vercel

1. Push your code to GitHub
2. Go to [vercel.com/new](https://vercel.com/new) and import your repo
3. Add all environment variables from `.env.example`
4. Set `APP_BASE_URL` and `NEXT_PUBLIC_APP_URL` to your Vercel domain
5. Deploy

### Post-deployment checklist

- [ ] Update Supabase **Site URL** to your production domain
- [ ] Update Supabase **Redirect URLs** to include your production domain
- [ ] Update Twilio **Voice webhook** to `https://your-domain.com/api/webhooks/twilio/voice`
- [ ] Update Twilio **SMS webhook** to `https://your-domain.com/api/webhooks/twilio/sms`
- [ ] Set all environment variables in Vercel
- [ ] Verify A2P 10DLC registration is approved
- [ ] Test: make a call to your Twilio number and verify the lead appears

### Custom Domain

1. In Vercel, go to **Project Settings > Domains**
2. Add your domain (e.g., `www.leadcatcher.app`)
3. Update DNS records as instructed by Vercel
4. Update all webhook URLs and env vars to use the new domain

---

## How It Works

### Missed Call Flow

```
Customer calls your business phone
        |
        v
You're busy, call goes unanswered
        |
        v
Carrier forwards to your Twilio number
        |
        v
Twilio Voice Webhook (/api/webhooks/twilio/voice)
        |
        ├──> Creates/finds lead in database
        ├──> Sends instant SMS: "Sorry I missed your call..."
        ├──> Records voicemail
        └──> Plays greeting via TwiML
                |
                v
        Customer leaves voicemail
                |
                v
        Twilio transcribes voicemail
                |
                v
Transcription Webhook (/api/webhooks/twilio/transcription)
        |
        ├──> AI analyzes voicemail (intent, summary)
        ├──> Stores analysis on the lead
        ├──> Sends AI-crafted follow-up SMS
        └──> Notifies business owner
```

### SMS Flow

```
Customer texts your Twilio number
        |
        v
SMS Webhook (/api/webhooks/twilio/sms)
        |
        ├──> Checks TCPA opt-out (STOP/START)
        ├──> Creates/finds lead
        ├──> Stores message
        ├──> AI analyzes message
        └──> Dashboard updates in real-time
```

### Call Forwarding Setup

Each carrier has different forwarding codes. Common ones:

| Carrier | Enable Forwarding | Disable Forwarding |
|---------|------------------|--------------------|
| **AT&T** | `*004*[Twilio#]#` then Send | `##004#` then Send |
| **Verizon** | `*71[Twilio#]` then Send | `*73` then Send |
| **T-Mobile** | `**004*[Twilio#]#` then Send | `##004#` then Send |

Replace `[Twilio#]` with your Twilio phone number (digits only, no +).

---

## Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Landing page
│   ├── login/page.tsx            # Login / Sign up / Forgot password
│   ├── onboarding/page.tsx       # Onboarding wizard
│   ├── dashboard/
│   │   ├── page.tsx              # Main dashboard (unified inbox)
│   │   └── settings/page.tsx     # Business settings
│   ├── auth/
│   │   ├── callback/route.ts     # Auth code exchange
│   │   └── reset-password/       # Password reset page
│   ├── api/
│   │   ├── messages/send/        # Send SMS endpoint
│   │   ├── verify/               # Phone verification
│   │   └── webhooks/twilio/      # Voice, SMS, Transcription webhooks
│   └── actions/twilio.ts         # Server actions
│
├── components/
│   ├── ui/                       # shadcn/ui components
│   ├── dashboard/                # Sidebar, Skeleton loaders
│   ├── landing/                  # Header, Hero, HowItWorks, FAQ, Pricing, Footer
│   └── onboarding/Wizard.tsx     # 5-step onboarding
│
├── lib/
│   ├── supabase-client.ts        # Browser Supabase client
│   ├── supabase-server.ts        # Server Supabase client (admin)
│   ├── twilio-validator.ts       # Webhook signature validation
│   ├── ai-service.ts             # OpenAI integration
│   ├── business-logic.ts         # Business hours checking
│   ├── phone-utils.ts            # Phone normalization (E.164)
│   └── logger.ts                 # Structured logging with PII redaction
│
├── middleware.ts                  # Auth, rate limiting, auth code routing
│
supabase/
├── schema.sql                    # Core tables + RLS policies
├── schema-enhanced.sql           # Extended schema
├── tcpa-compliance.sql           # Opt-out table
└── indexes.sql                   # Performance indexes
```

---

## API Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/webhooks/twilio/voice` | POST | Twilio Signature | Handles incoming/missed calls |
| `/api/webhooks/twilio/sms` | POST | Twilio Signature | Handles incoming SMS |
| `/api/webhooks/twilio/transcription` | POST | Twilio Signature | Processes voicemail transcriptions |
| `/api/messages/send` | POST | User Session | Sends outbound SMS from dashboard |
| `/api/verify` | POST | User Session | Initiates verification call |
| `/api/verify/webhook` | POST | Twilio Signature | TwiML for verification call |

---

## Security

- **Twilio Signature Validation** - All webhooks verify cryptographic signatures
- **Row Level Security (RLS)** - Users can only access their own data
- **Content Security Policy** - CSP headers prevent XSS
- **TCPA Compliance** - Automatic opt-out handling for STOP/START keywords
- **PII Redaction** - Phone numbers redacted in logs
- **Fail-fast Config** - App throws on missing environment variables
- **Rate Limiting** - API routes protected via Upstash Redis
- **Open Redirect Prevention** - Auth callbacks validate redirect paths

---

## Troubleshooting

### "Supabase env vars missing" error
Make sure `.env.local` has valid `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Restart the dev server after changing env vars.

### Webhooks not firing
- Verify webhook URLs in Twilio Console point to your domain
- For local dev, make sure ngrok is running and URLs are updated
- Check Twilio Console > Monitor > Logs for errors

### Password reset email goes to localhost
Update your **Site URL** in Supabase Dashboard > Authentication > URL Configuration to your production domain.

### Leads not appearing in dashboard
- Check that call forwarding is set up on your phone
- Verify the Twilio number is linked to your business in the onboarding wizard
- Check browser console for Supabase Realtime errors

### SMS not being delivered
- Ensure A2P 10DLC registration is approved
- Check if the recipient opted out (sent STOP)
- Verify `TWILIO_PHONE_NUMBER` is correct in env vars

### Build fails with Google Fonts error
This only happens in sandboxed environments. Production builds on Vercel work fine.

---

## Scripts

```bash
npm run dev       # Start development server
npm run build     # Create production build
npm run start     # Start production server
npm run lint      # Run ESLint checks
npm run test      # Run Vitest tests
```

---

## License

Proprietary Software. Internal Use Only.
