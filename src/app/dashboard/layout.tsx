import { createSupabaseServerClient, supabaseAdmin } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { SubscriptionBanner } from '@/components/dashboard/SubscriptionBanner';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect('/login');
    }

    // Fetch subscription status
    const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('stripe_status, stripe_plan, stripe_trial_ends_at, stripe_current_period_end')
        .eq('user_id', user.id)
        .single();

    const stripeStatus = business?.stripe_status || null;
    const trialEndsAt = business?.stripe_trial_ends_at || null;

    // Compute trial days remaining on the server — Date.now() is safe in async server components
    let trialDaysLeft: number | null = null;
    if (stripeStatus === 'trialing' && trialEndsAt) {
        const now = Date.now(); // eslint-disable-line react-hooks/purity
        trialDaysLeft = Math.max(
            0,
            Math.ceil((new Date(trialEndsAt).getTime() - now) / (1000 * 60 * 60 * 24))
        );
    }

    return (
        <>
            <SubscriptionBanner
                status={stripeStatus}
                trialDaysLeft={trialDaysLeft}
            />
            {children}
        </>
    );
}
