import Link from 'next/link';

interface SubscriptionBannerProps {
    status: string | null;
    trialDaysLeft: number | null;
}

export function SubscriptionBanner({ status, trialDaysLeft }: SubscriptionBannerProps) {
    // No banner needed for active subscriptions
    if (status === 'active') return null;

    // Trial banner — only show when 3 or fewer days remain
    if (status === 'trialing' && trialDaysLeft !== null && trialDaysLeft <= 3) {
        return (
            <div className="bg-blue-600 text-white text-center py-2 px-4 text-sm">
                Your free trial ends in {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}.{' '}
                <Link href="/dashboard/billing" className="underline font-semibold">
                    Subscribe now
                </Link>{' '}
                to keep your account active.
            </div>
        );
    }

    // Past due
    if (status === 'past_due') {
        return (
            <div className="bg-yellow-500 text-white text-center py-2 px-4 text-sm">
                Your payment is past due. Please{' '}
                <Link href="/dashboard/billing" className="underline font-semibold">
                    update your payment method
                </Link>{' '}
                to avoid service interruption.
            </div>
        );
    }

    // Canceled or unpaid
    if (status === 'canceled' || status === 'unpaid') {
        return (
            <div className="bg-red-600 text-white text-center py-2 px-4 text-sm">
                Your subscription has ended.{' '}
                <Link href="/dashboard/billing" className="underline font-semibold">
                    Resubscribe
                </Link>{' '}
                to restore full access.
            </div>
        );
    }

    // No subscription at all
    if (!status) {
        return (
            <div className="bg-blue-600 text-white text-center py-2 px-4 text-sm">
                Start your 14-day free trial.{' '}
                <Link href="/dashboard/billing" className="underline font-semibold">
                    Choose a plan
                </Link>
            </div>
        );
    }

    return null;
}
