import { createSupabaseServerClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { stripe, PLANS, TRIAL_DAYS, type PlanId } from '@/lib/stripe';
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
    try {
        // 1. Authenticate
        const supabase = await createSupabaseServerClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { planId } = await request.json() as { planId: string };

        if (!planId || !(planId in PLANS)) {
            return Response.json({ error: 'Invalid plan' }, { status: 400 });
        }

        const plan = PLANS[planId as PlanId];

        if (!plan.priceId) {
            logger.error('[Stripe] Missing Stripe price ID. Set STRIPE_STARTER_PRICE_ID and STRIPE_PRO_PRICE_ID env vars.', null, { planId });
            return Response.json(
                { error: 'Billing is not set up yet. Please configure Stripe price IDs in your environment variables (STRIPE_STARTER_PRICE_ID / STRIPE_PRO_PRICE_ID).' },
                { status: 500 }
            );
        }

        // 2. Get business
        const { data: business } = await supabaseAdmin
            .from('businesses')
            .select('id, stripe_customer_id, name')
            .eq('user_id', user.id)
            .single();

        if (!business) {
            return Response.json({ error: 'Business not found. Complete onboarding first.' }, { status: 404 });
        }

        // 3. Create or reuse Stripe customer
        let customerId = business.stripe_customer_id;

        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: {
                    supabase_user_id: user.id,
                    business_id: business.id,
                },
            });
            customerId = customer.id;

            await supabaseAdmin
                .from('businesses')
                .update({ stripe_customer_id: customerId })
                .eq('id', business.id);
        }

        // 4. Create Checkout Session
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode: 'subscription',
            line_items: [{ price: plan.priceId, quantity: 1 }],
            subscription_data: {
                trial_period_days: TRIAL_DAYS,
                metadata: {
                    business_id: business.id,
                    plan_id: planId,
                },
            },
            success_url: `${baseUrl}/dashboard/billing?success=true`,
            cancel_url: `${baseUrl}/dashboard/billing?canceled=true`,
            metadata: {
                business_id: business.id,
                plan_id: planId,
            },
        });

        logger.info('[Stripe] Checkout session created', {
            userId: user.id,
            businessId: business.id,
            planId,
        });

        return Response.json({ url: session.url });
    } catch (error) {
        logger.error('[Stripe] Checkout error', error);
        return Response.json({ error: 'Failed to create checkout session' }, { status: 500 });
    }
}
