import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

/** Maximum days a new business can send SMS without a subscription. */
const ONBOARDING_GRACE_DAYS = 7;

/**
 * Checks whether a business has an active subscription that allows
 * SMS-spending operations.
 *
 * Allowed statuses: 'active', 'trialing' (only if stripe_trial_ends_at is set and in the future).
 * Grace period: NULL status is allowed for 7 days after business creation (onboarding).
 * Blocked statuses: 'canceled', 'past_due', 'unpaid', or expired grace period.
 *
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function checkBillingStatus(businessId: string): Promise<
  { allowed: true } | { allowed: false; reason: string }
> {
  const { data: business, error } = await supabaseAdmin
    .from('businesses')
    .select('stripe_status, stripe_trial_ends_at, created_at')
    .eq('id', businessId)
    .single();

  if (error || !business) {
    logger.error('[BillingGuard] Failed to fetch business — failing closed', error, { businessId });
    return { allowed: false, reason: 'Unable to verify billing status. Please try again later.' };
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

  // Allow SMS during onboarding grace period (7 days from creation).
  // After that, a subscription is required.
  if (!status && business.created_at) {
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
