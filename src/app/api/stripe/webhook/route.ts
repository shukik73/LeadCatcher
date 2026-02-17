import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import type Stripe from 'stripe';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events for subscription lifecycle.
 * Must be configured in Stripe Dashboard → Webhooks.
 */
export async function POST(request: Request) {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
        logger.warn('[Stripe Webhook] Missing stripe-signature header');
        return new Response('Missing signature', { status: 400 });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        logger.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
        return new Response('Webhook not configured', { status: 500 });
    }

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.warn('[Stripe Webhook] Signature verification failed', { error: message });
        return new Response(`Webhook Error: ${message}`, { status: 400 });
    }

    logger.info('[Stripe Webhook] Event received', { type: event.type });

    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
                break;

            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
                break;

            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
                break;

            case 'invoice.payment_failed':
                await handlePaymentFailed(event.data.object as Stripe.Invoice);
                break;

            default:
                logger.info('[Stripe Webhook] Unhandled event type', { type: event.type });
        }
    } catch (error) {
        logger.error('[Stripe Webhook] Error handling event', error, { type: event.type });
        return new Response('Webhook handler error', { status: 500 });
    }

    return new Response('OK', { status: 200 });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const businessId = session.metadata?.business_id;
    const planId = session.metadata?.plan_id;
    const subscriptionId = session.subscription as string;

    if (!businessId || !subscriptionId) {
        logger.warn('[Stripe Webhook] Missing metadata in checkout session', {
            sessionId: session.id,
        });
        return;
    }

    // Fetch the subscription to get trial/period details
    const subscription = await stripe.subscriptions.retrieve(subscriptionId) as Stripe.Subscription;

    await supabaseAdmin
        .from('businesses')
        .update({
            stripe_subscription_id: subscriptionId,
            stripe_plan: planId || 'starter',
            stripe_status: subscription.status,
            stripe_trial_ends_at: subscription.trial_end
                ? new Date(subscription.trial_end * 1000).toISOString()
                : null,
            stripe_current_period_end: subscription.items.data[0]?.current_period_end
                ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
                : null,
        })
        .eq('id', businessId);

    logger.info('[Stripe Webhook] Checkout completed', {
        businessId,
        planId: planId || 'unknown',
        status: subscription.status,
    });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;

    const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single();

    if (!business) {
        logger.warn('[Stripe Webhook] No business for customer', { customerId });
        return;
    }

    // Determine plan from the price
    const priceId = subscription.items.data[0]?.price?.id;
    const planId = priceId === process.env.STRIPE_PRO_PRICE_ID ? 'pro' : 'starter';

    await supabaseAdmin
        .from('businesses')
        .update({
            stripe_plan: planId,
            stripe_status: subscription.status,
            stripe_trial_ends_at: subscription.trial_end
                ? new Date(subscription.trial_end * 1000).toISOString()
                : null,
            stripe_current_period_end: subscription.items.data[0]?.current_period_end
                ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
                : null,
        })
        .eq('id', business.id);

    logger.info('[Stripe Webhook] Subscription updated', {
        businessId: business.id,
        status: subscription.status,
        planId,
    });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;

    const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single();

    if (!business) {
        logger.warn('[Stripe Webhook] No business for customer', { customerId });
        return;
    }

    await supabaseAdmin
        .from('businesses')
        .update({
            stripe_status: 'canceled',
            stripe_subscription_id: null,
        })
        .eq('id', business.id);

    logger.info('[Stripe Webhook] Subscription canceled', {
        businessId: business.id,
    });
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
    const customerId = invoice.customer as string;

    const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single();

    if (!business) return;

    await supabaseAdmin
        .from('businesses')
        .update({ stripe_status: 'past_due' })
        .eq('id', business.id);

    logger.warn('[Stripe Webhook] Payment failed', {
        businessId: business.id,
        invoiceId: invoice.id,
    });
}
