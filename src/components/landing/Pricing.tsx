"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import Link from 'next/link';

const plans = [
    {
        id: 'starter',
        name: 'Starter',
        description: 'For one-person shops.',
        price: 299,
        features: [
            'Auto text-back on every missed call',
            'Your simple daily list of who’s waiting',
            'Keep your current number',
        ],
        popular: false,
    },
    {
        id: 'pro',
        name: 'Pro',
        description: 'For growing teams.',
        price: 499,
        features: [
            'Everything in Starter',
            'Two-way texting from the app',
            'Shared inbox & instant owner alerts',
        ],
        popular: true,
    },
];

export default function Pricing() {
    return (
        <section id="pricing" className="bg-[#16120B] py-24">
            <div className="container mx-auto px-4 md:px-6">
                <div className="mb-14 text-center">
                    <h2 className="mb-4 text-3xl font-bold tracking-tight text-stone-50 md:text-4xl">One saved job covers the year.</h2>
                    <p className="text-lg text-stone-400">14 days free · no card to start · cancel anytime, no contracts.</p>
                </div>

                <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
                    {plans.map((plan) => (
                        <div
                            key={plan.id}
                            className={`relative flex flex-col rounded-3xl border p-8 ${
                                plan.popular ? 'border-[#E0A43B]/40 bg-[#211B11]' : 'border-white/5 bg-[#1E1810]'
                            }`}
                        >
                            {plan.popular && (
                                <div className="absolute right-6 top-6 rounded-full bg-[#E0A43B] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#1A1206]">
                                    Most Popular
                                </div>
                            )}
                            <div className="mb-6">
                                <h3 className="text-xl font-bold text-stone-50">{plan.name}</h3>
                                <p className="mt-1 text-sm text-stone-400">{plan.description}</p>
                            </div>
                            <div className="mb-8">
                                <span className="text-5xl font-bold text-stone-50">${plan.price}</span>
                                <span className="text-lg text-stone-500">/mo</span>
                            </div>
                            <ul className="mb-8 flex-1 space-y-3">
                                {plan.features.map((feature, i) => (
                                    <li key={i} className="flex items-center gap-3 text-stone-300">
                                        <Check className="h-5 w-5 shrink-0 text-[#E0A43B]" />
                                        <span>{feature}</span>
                                    </li>
                                ))}
                            </ul>
                            <Button
                                asChild
                                className={`h-12 w-full rounded-xl text-base font-semibold ${
                                    plan.popular
                                        ? 'bg-[#E0A43B] text-[#1A1206] hover:brightness-110'
                                        : 'border border-white/10 bg-white/5 text-stone-100 hover:bg-white/10'
                                }`}
                            >
                                <Link href={`/onboarding?plan=${plan.id}`}>Start free</Link>
                            </Button>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
