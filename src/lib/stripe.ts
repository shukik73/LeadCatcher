import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Missing STRIPE_SECRET_KEY environment variable');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    typescript: true,
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
