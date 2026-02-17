import { createSupabaseServerClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { stripe } from '@/lib/stripe';
import { logger } from '@/lib/logger';

export async function POST() {
    try {
        const supabase = await createSupabaseServerClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: business } = await supabaseAdmin
            .from('businesses')
            .select('stripe_customer_id')
            .eq('user_id', user.id)
            .single();

        if (!business?.stripe_customer_id) {
            return Response.json(
                { error: 'No billing account found. Subscribe to a plan first.' },
                { status: 404 }
            );
        }

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        const session = await stripe.billingPortal.sessions.create({
            customer: business.stripe_customer_id,
            return_url: `${baseUrl}/dashboard/billing`,
        });

        logger.info('[Stripe] Portal session created', { userId: user.id });

        return Response.json({ url: session.url });
    } catch (error) {
        logger.error('[Stripe] Portal error', error);
        return Response.json({ error: 'Failed to create portal session' }, { status: 500 });
    }
}
