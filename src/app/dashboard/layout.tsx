import { createSupabaseServerClient, supabaseAdmin } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { SubscriptionBanner } from '@/components/dashboard/SubscriptionBanner';
import { DashboardNav } from '@/components/dashboard/DashboardNav';

// Prevent static prerendering — dashboard requires auth cookies and DB access
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    let supabase;
    try {
        supabase = await createSupabaseServerClient();
    } catch {
        redirect('/login');
    }

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect('/login');
    }

    // Fetch subscription status — fail gracefully if DB call errors
    let stripeStatus: string | null = null;
    let trialDaysLeft: number | null = null;

    try {
        const { data: business } = await supabaseAdmin
            .from('businesses')
            .select('stripe_status, stripe_plan, stripe_trial_ends_at, stripe_current_period_end')
            .eq('user_id', user.id)
            .single();

        stripeStatus = business?.stripe_status || null;
        const trialEndsAt = business?.stripe_trial_ends_at || null;

        if (stripeStatus === 'trialing' && trialEndsAt) {
            const now = Date.now();
            trialDaysLeft = Math.max(
                0,
                Math.ceil((new Date(trialEndsAt).getTime() - now) / (1000 * 60 * 60 * 24))
            );
        }
    } catch {
        // supabaseAdmin may throw if SUPABASE_SERVICE_ROLE_KEY is missing.
        // Render the dashboard without subscription banner rather than 500.
    }

    return (
        <div className="flex flex-col md:flex-row h-screen overflow-hidden">
            <DashboardNav />
            <div className="flex-1 flex flex-col overflow-hidden">
                <SubscriptionBanner
                    status={stripeStatus}
                    trialDaysLeft={trialDaysLeft}
                />
                <div className="flex-1 overflow-auto">
                    {children}
                </div>
            </div>
        </div>
    );
}
