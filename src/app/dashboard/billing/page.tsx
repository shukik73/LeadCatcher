'use client';

import { useState, useEffect, useMemo } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2, ExternalLink, CreditCard, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'next/navigation';

const PLANS = {
    starter: {
        name: 'Starter',
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
        price: 499,
        features: [
            'Unlimited automated texts',
            'Priority Owner Alerts',
            '2-Way Texting Relay',
            'Dedicated Support Line',
            'Custom Auto-Reply Message',
        ],
    },
};

interface BillingInfo {
    stripe_status: string | null;
    stripe_plan: string | null;
    stripe_trial_ends_at: string | null;
    stripe_current_period_end: string | null;
    stripe_customer_id: string | null;
}

export default function BillingPage() {
    const [loading, setLoading] = useState(true);
    const [billing, setBilling] = useState<BillingInfo | null>(null);
    const [checkingOut, setCheckingOut] = useState<string | null>(null);
    const [openingPortal, setOpeningPortal] = useState(false);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);
    const searchParams = useSearchParams();
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    useEffect(() => {
        if (searchParams.get('success') === 'true') {
            toast.success('Subscription activated! Welcome aboard.');
        } else if (searchParams.get('canceled') === 'true') {
            toast.info('Checkout canceled. No charges were made.');
        }
    }, [searchParams]);

    useEffect(() => {
        async function fetchBilling() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { setLoading(false); return; }

            const { data: business } = await supabase
                .from('businesses')
                .select('stripe_status, stripe_plan, stripe_trial_ends_at, stripe_current_period_end, stripe_customer_id')
                .eq('user_id', user.id)
                .single();

            if (business) {
                setBilling(business as BillingInfo);
            }
            setLoading(false);
        }
        fetchBilling();
    }, [supabase]);

    const handleCheckout = async (planId: string) => {
        setCheckingOut(planId);
        setCheckoutError(null);
        try {
            const res = await fetch('/api/stripe/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ planId }),
            });
            const data = await res.json();
            if (data.url) {
                window.location.assign(data.url);
            } else {
                const errorMsg = data.error || 'Failed to start checkout';
                setCheckoutError(errorMsg);
                toast.error(errorMsg);
                setCheckingOut(null);
            }
        } catch {
            setCheckoutError('Network error. Please try again.');
            toast.error('Failed to start checkout');
            setCheckingOut(null);
        }
    };

    const handleManageBilling = async () => {
        setOpeningPortal(true);
        try {
            const res = await fetch('/api/stripe/portal', { method: 'POST' });
            const data = await res.json();
            if (data.url) {
                window.location.assign(data.url);
            } else {
                toast.error(data.error || 'Failed to open billing portal');
                setOpeningPortal(false);
            }
        } catch {
            toast.error('Failed to open billing portal');
            setOpeningPortal(false);
        }
    };

    if (loading) return (
        <div className="container mx-auto p-6 max-w-4xl space-y-8">
            <div className="h-9 w-24 bg-slate-200 rounded animate-pulse" />
            <div className="rounded-lg border border-slate-200 p-6 space-y-4">
                <div className="h-6 w-40 bg-slate-200 rounded animate-pulse" />
                <div className="h-4 w-64 bg-slate-100 rounded animate-pulse" />
                <div className="h-10 w-48 bg-slate-100 rounded animate-pulse" />
            </div>
            <div className="grid md:grid-cols-2 gap-6">
                {[1, 2].map(i => (
                    <div key={i} className="rounded-lg border border-slate-200 p-6 space-y-4">
                        <div className="h-6 w-24 bg-slate-200 rounded animate-pulse" />
                        <div className="h-8 w-32 bg-slate-200 rounded animate-pulse" />
                        <div className="space-y-2">
                            {Array.from({ length: 4 }).map((_, j) => (
                                <div key={j} className="h-4 bg-slate-100 rounded animate-pulse" />
                            ))}
                        </div>
                        <div className="h-10 bg-slate-100 rounded animate-pulse" />
                    </div>
                ))}
            </div>
        </div>
    );

    const hasSubscription = billing?.stripe_status && billing.stripe_status !== 'canceled';
    const currentPlan = billing?.stripe_plan || null;
    const isTrialing = billing?.stripe_status === 'trialing';
    const isActive = billing?.stripe_status === 'active';
    const isPastDue = billing?.stripe_status === 'past_due';

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-8">
            <h1 className="text-3xl font-bold">Billing</h1>

            {/* Current Plan Status */}
            {hasSubscription && (
                <Card>
                    <CardHeader>
                        <CardTitle>Current Plan</CardTitle>
                        <CardDescription>Manage your subscription and payment method.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-3">
                            <span className="text-lg font-semibold capitalize">
                                {currentPlan} Plan
                            </span>
                            {isTrialing && (
                                <Badge variant="secondary">
                                    Trial — ends {billing.stripe_trial_ends_at
                                        ? new Date(billing.stripe_trial_ends_at).toLocaleDateString()
                                        : 'soon'}
                                </Badge>
                            )}
                            {isActive && <Badge className="bg-green-100 text-green-800">Active</Badge>}
                            {isPastDue && <Badge variant="destructive">Past Due</Badge>}
                        </div>

                        {billing.stripe_current_period_end && (
                            <p className="text-sm text-gray-500">
                                {isTrialing ? 'Trial ends' : 'Next billing date'}:{' '}
                                {new Date(billing.stripe_current_period_end).toLocaleDateString()}
                            </p>
                        )}

                        {isPastDue && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
                                <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-yellow-800">Payment past due</p>
                                    <p className="text-sm text-yellow-700">Please update your payment method to avoid service interruption.</p>
                                </div>
                            </div>
                        )}

                        <div className="flex gap-3">
                            <Button
                                onClick={handleManageBilling}
                                disabled={openingPortal}
                                variant="outline"
                            >
                                {openingPortal ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <CreditCard className="h-4 w-4 mr-2" />
                                )}
                                Update Payment Method
                            </Button>
                            <Button
                                onClick={handleManageBilling}
                                disabled={openingPortal}
                                variant="ghost"
                                size="sm"
                            >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                Full Billing Portal
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* No subscription prompt */}
            {!hasSubscription && (
                <Card className="border-blue-200 bg-blue-50/50">
                    <CardContent className="py-6">
                        <div className="flex items-start gap-3">
                            <CreditCard className="h-6 w-6 text-blue-600 flex-shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-blue-900">Get started with a 14-day free trial</h3>
                                <p className="text-sm text-blue-700 mt-1">
                                    Choose a plan below to start your free trial. You&apos;ll enter your credit card on the next page
                                    and won&apos;t be charged until the trial ends.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Checkout error */}
            {checkoutError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-red-800">Checkout failed</p>
                        <p className="text-sm text-red-700">{checkoutError}</p>
                    </div>
                </div>
            )}

            {/* Plan Selection */}
            <div className="grid md:grid-cols-2 gap-6">
                {(Object.entries(PLANS) as [string, typeof PLANS.starter][]).map(([planId, plan]) => {
                    const isCurrent = currentPlan === planId && hasSubscription;

                    return (
                        <Card
                            key={planId}
                            className={isCurrent ? 'border-blue-500 border-2' : ''}
                        >
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle>{plan.name}</CardTitle>
                                    {isCurrent && (
                                        <Badge className="bg-blue-100 text-blue-800">Current</Badge>
                                    )}
                                </div>
                                <CardDescription>
                                    <span className="text-3xl font-bold text-foreground">${plan.price}</span>
                                    <span className="text-muted-foreground">/mo</span>
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <ul className="space-y-2">
                                    {plan.features.map((feature, i) => (
                                        <li key={i} className="flex items-center gap-2 text-sm">
                                            <Check className="h-4 w-4 text-blue-500 flex-shrink-0" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                {isCurrent ? (
                                    <Button disabled className="w-full" variant="outline">
                                        Current Plan
                                    </Button>
                                ) : (
                                    <Button
                                        className="w-full"
                                        onClick={() => handleCheckout(planId)}
                                        disabled={checkingOut !== null}
                                    >
                                        {checkingOut === planId && (
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        )}
                                        {checkingOut === planId ? 'Redirecting to checkout...' : (
                                            hasSubscription ? 'Switch Plan' : (
                                                <>
                                                    <CreditCard className="h-4 w-4 mr-2" />
                                                    Start 14-Day Free Trial
                                                </>
                                            )
                                        )}
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            <p className="text-center text-sm text-gray-500">
                All plans include a 14-day free trial. Cancel anytime from the billing portal.
            </p>
        </div>
    );
}
