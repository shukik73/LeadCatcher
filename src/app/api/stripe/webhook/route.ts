import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase-server';
import { claimWebhookEvent, markWebhookProcessed, markWebhookFailed } from '@/lib/webhook-common';
import { logger } from '@/lib/logger';
import type Stripe from 'stripe';

export const dynamic = 'force-dynamic';

const TAG = 'Stripe Webhook';

/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events for subscription lifecycle.
 * Must be configured in Stripe Dashboard → Webhooks.
 *
 * Idempotency: Uses atomic INSERT to claim the Stripe event.id.
 * Ordering: For subscription updates, checks event.created timestamp
 * to avoid overwriting newer state with older replayed events.
 */
export async function POST(request: Request) {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
        logger.warn(`[${TAG}] Missing stripe-signature header`);
        return new Response('Missing signature', { status: 400 });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        logger.error(`[${TAG}] STRIPE_WEBHOOK_SECRET not configured`);
        return new Response('Webhook not configured', { status: 500 });
    }

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.warn(`[${TAG}] Signature verification failed`, { error: message });
        return new Response(`Webhook Error: ${message}`, { status: 400 });
    }

    logger.info(`[${TAG}] Event received`, { type: event.type, eventId: event.id });

    // Idempotency: atomic claim
    const claim = await claimWebhookEvent(event.id, 'stripe', TAG);
    if (claim.status === 'duplicate') {
        return new Response('OK', { status: 200 });
    }
    if (claim.status === 'error') {
        return new Response('Internal Server Error', { status: 500 });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
                break;

            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, event.created, event.id);
                break;

            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
                break;

            case 'invoice.payment_failed':
                await handlePaymentFailed(event.data.object as Stripe.Invoice);
                break;

            default:
                logger.info(`[${TAG}] Unhandled event type`, { type: event.type });
        }

        await markWebhookProcessed(event.id);
    } catch (error) {
        logger.error(`[${TAG}] Error handling event`, error, { type: event.type });
        await markWebhookFailed(event.id);
        return new Response('Webhook handler error', { status: 500 });
    }

    return new Response('OK', { status: 200 });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const businessId = session.metadata?.business_id;
    const planId = session.metadata?.plan_id;
    const subscriptionId = session.subscription as string;

    if (!businessId || !subscriptionId) {
        logger.warn(`[${TAG}] Missing metadata in checkout session`, {
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

    logger.info(`[${TAG}] Checkout completed`, {
        businessId,
        planId: planId || 'unknown',
        status: subscription.status,
    });
}

/**
 * Handle subscription updates with monotonic ordering guard.
 * Uses the Stripe event.created timestamp to avoid overwriting
 * newer state with a replayed/out-of-order older event.
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription, eventCreatedAt: number, eventId: string) {
    const customerId = subscription.customer as string;

    const { data: business } = await supabaseAdmin
        .from('businesses')
        .select('id, stripe_status')
        .eq('stripe_customer_id', customerId)
        .single();

    if (!business) {
        logger.warn(`[${TAG}] No business for customer`, { customerId });
        return;
    }

    // Store business_id and Stripe event timestamp on the webhook_events row
    // so we can do ordering checks across events for the same business.
    const eventTimestamp = new Date(eventCreatedAt * 1000).toISOString();
    await supabaseAdmin.from('webhook_events')
        .update({ business_id: business.id, created_at: eventTimestamp })
        .eq('event_id', eventId);

    // Monotonic ordering guard: check if we already processed a newer event
    // for this business. If so, skip to avoid overwriting newer state.
    const { data: newerEvents } = await supabaseAdmin
        .from('webhook_events')
        .select('id')
        .eq('event_type', 'stripe')
        .eq('status', 'processed')
        .eq('business_id', business.id)
        .gt('created_at', eventTimestamp)
        .limit(1);

    if (newerEvents && newerEvents.length > 0) {
        logger.info(`[${TAG}] Skipping out-of-order subscription update`, {
            businessId: business.id,
            eventTimestamp,
        });
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

    logger.info(`[${TAG}] Subscription updated`, {
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
        logger.warn(`[${TAG}] No business for customer`, { customerId });
        return;
    }

    await supabaseAdmin
        .from('businesses')
        .update({
            stripe_status: 'canceled',
            stripe_subscription_id: null,
        })
        .eq('id', business.id);

    logger.info(`[${TAG}] Subscription canceled`, {
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

    logger.warn(`[${TAG}] Payment failed`, {
        businessId: business.id,
        invoiceId: invoice.id,
    });
}
