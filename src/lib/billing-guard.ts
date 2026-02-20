import { supabaseAdmin } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

/**
 * Checks whether a business has an active subscription that allows
 * SMS-spending operations.
 *
 * Allowed statuses: 'active', 'trialing'.
 * Blocked statuses: 'canceled', 'past_due', 'unpaid', null (no subscription).
 *
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function checkBillingStatus(businessId: string): Promise<
  { allowed: true } | { allowed: false; reason: string }
> {
  const { data: business, error } = await supabaseAdmin
    .from('businesses')
    .select('stripe_status')
    .eq('id', businessId)
    .single();

  if (error || !business) {
    logger.error('[BillingGuard] Failed to fetch business', error, { businessId });
    // Fail open for DB errors so we don't break existing users during outages.
    // The SMS cost risk of a brief DB failure is much lower than blocking all users.
    return { allowed: true };
  }

  const status = business.stripe_status;
  if (status === 'active' || status === 'trialing') {
    return { allowed: true };
  }

  const reason = status
    ? `Subscription status is "${status}". Please update your billing to continue sending messages.`
    : 'No active subscription. Please subscribe to send messages.';

  logger.warn('[BillingGuard] SMS blocked due to billing status', { businessId, status });
  return { allowed: false, reason };
}
