import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

/** Maximum days a new business can send SMS without a subscription. */
const ONBOARDING_GRACE_DAYS = 7;

/**
 * Checks whether a business has an active subscription that allows
 * SMS-spending operations.
 *
 * Allowed: billing_exempt; 'active'; 'trialing' with a future stripe_trial_ends_at.
 * Onboarding grace: NULL status OR 'trialing' with no recorded trial end date is
 *   allowed for 7 days after business creation (prod defaults new rows to
 *   'trialing' with a null trial end until Stripe writes one).
 * Blocked: 'canceled', 'past_due', 'unpaid', expired trial, or expired grace.
 *
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function checkBillingStatus(businessId: string): Promise<
  { allowed: true } | { allowed: false; reason: string }
> {
  const { data: business, error } = await supabaseAdmin
    .from('businesses')
    .select('billing_exempt, stripe_status, stripe_trial_ends_at, created_at')
    .eq('id', businessId)
    .single();

  if (error || !business) {
    logger.error('[BillingGuard] Failed to fetch business — failing closed', error, { businessId });
    return { allowed: false, reason: 'Unable to verify billing status. Please try again later.' };
  }

  // Internal / comped accounts (e.g. our own shop dogfooding the product) bypass
  // the subscription gate. Kept separate from stripe_status so they never count
  // as paying customers in revenue metrics.
  if (business.billing_exempt) {
    return { allowed: true };
  }

  const status = business.stripe_status;
  if (status === 'active') {
    return { allowed: true };
  }
  if (
    status === 'trialing' &&
    business.stripe_trial_ends_at &&
    new Date(business.stripe_trial_ends_at) > new Date()
  ) {
    return { allowed: true };
  }

  // Onboarding grace window (7 days from creation). A brand-new business defaults
  // to status 'trialing' with NO stripe_trial_ends_at until Stripe records one, so
  // we'd otherwise block its missed-call SMS during the most important window — the
  // moment a new shop tests its first call. Treat "no usable trial end date yet"
  // (null status OR 'trialing' with a null end date) as the onboarding window,
  // bounded by ONBOARDING_GRACE_DAYS so it can't become an indefinite free ride.
  // (A 'trialing' sub WITH a future end date is already allowed above; with a past
  // date it correctly falls through to blocked.)
  const noTrialEndYet = !business.stripe_trial_ends_at;
  if ((!status || status === 'trialing') && noTrialEndYet && business.created_at) {
    const createdAt = new Date(business.created_at);
    const graceEnd = new Date(createdAt.getTime() + ONBOARDING_GRACE_DAYS * 24 * 60 * 60 * 1000);
    if (new Date() < graceEnd) {
      logger.info('[BillingGuard] Within onboarding grace period — allowing SMS', { businessId });
      return { allowed: true };
    }
    logger.warn('[BillingGuard] Onboarding grace period expired — blocking SMS', { businessId });
    return { allowed: false, reason: 'Your free trial has expired. Please set up billing to continue sending messages.' };
  }

  const reason = `Subscription status is "${status}". Please update your billing to continue sending messages.`;
  logger.warn('[BillingGuard] SMS blocked due to billing status', { businessId, status });
  return { allowed: false, reason };
}
