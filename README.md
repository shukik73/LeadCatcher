# Lead Catcher 🎣

**Never lose a lead to a missed call.**

Lead Catcher is a B2B SaaS application that automatically recovers revenue for service businesses by capturing missed calls via SMS and providing a unified inbox for lead management.

## 🚀 Key Features

*   **Missed Call Text Back**: Automatically greets callers via SMS when you can't answer.
*   **Unified Inbox**: Manage SMS conversations and leads from one dashboard.
*   **Real-time Updates**: Instant notifications for new leads and messages.
*   **Business Isolation**: Secure multi-tenancy ensures data privacy.
*   **Performance First**: Built on Next.js 15, React 19, and Supabase.

## 🛠️ Tech Stack

*   **Frontend**: Next.js (App Router), React, Tailwind CSS, shadcn/ui
*   **Backend**: Supabase (Postgres, Auth, Realtime)
*   **Telephony**: Twilio (Voice & SMS Webhooks)
*   **Validation**: Zod, React Hook Form

## 🏃‍♂️ Getting Started

### Prerequisites

*   Node.js 18+
*   Supabase Account
*   Twilio Account (with a phone number)

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-org/leadcatcher.git
    cd leadcatcher
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Configure Environment**
    Copy `.env.example` to `.env.local` and fill in your keys.
    ```bash
    cp .env.example .env.local
    ```
    *See `.env.example` for details on required variables.*

4.  **Setup Database**
    Run the SQL scripts in `supabase/schema.sql` in your Supabase SQL Editor to create tables and policies.

5.  **Run Development Server**
    ```bash
    npm run dev
    ```
    Open [http://localhost:3000](http://localhost:3000)

## 📡 Webhooks

Configure your Twilio Phone Number webhooks to point to your deployed URL:

*   **Voice**: `POST https://your-app.com/api/webhooks/twilio/voice`
*   **Messaging**: `POST https://your-app.com/api/webhooks/twilio/sms`

## 🛡️ Security

*   **RLS**: Rows are secured by Supabase Row Level Security.
*   **Validation**: All webhooks validate Twilio cryptographic signatures.
*   **Sanitization**: Phone numbers are normalized to E.164.

## 📄 License

Proprietary Software. Internal Use Only.
