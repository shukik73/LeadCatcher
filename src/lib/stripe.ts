import Stripe from 'stripe';

// Lazy-initialized Stripe client.
// Defers creation until first use to avoid build-time failures when
// env vars aren't available (next build collects route data before runtime).
let _stripe: Stripe | null = null;

function getStripe(): Stripe {
    if (_stripe) return _stripe;

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
        throw new Error('Missing STRIPE_SECRET_KEY environment variable');
    }

    _stripe = new Stripe(key, { typescript: true });
    return _stripe;
}

export const stripe: Stripe = new Proxy({} as Stripe, {
    get(_target, prop, receiver) {
        const client = getStripe();
        const value = Reflect.get(client, prop, receiver);
        if (typeof value === 'function') {
            return value.bind(client);
        }
        return value;
    },
});

/**
 * Plan definitions — map internal plan names to Stripe Price IDs.
 * Create these in your Stripe Dashboard under Products.
 */
export const PLANS = {
    starter: {
        name: 'Starter',
        priceId: process.env.STRIPE_STARTER_PRICE_ID || '',
        price: 299,
        features: [
            'Up to 100 automated texts',
            'Standard call forwarding',
            'Basic Lead Alerts (SMS)',
            'Email Support',
        ],
    },
    pro: {
        name: 'Pro',
        priceId: process.env.STRIPE_PRO_PRICE_ID || '',
        price: 499,
        features: [
            'Unlimited automated texts',
            'Priority Owner Alerts',
            '2-Way Texting Relay',
            'Dedicated Support Line',
            'Custom Auto-Reply Message',
        ],
    },
} as const;

export type PlanId = keyof typeof PLANS;

export const TRIAL_DAYS = 14;
