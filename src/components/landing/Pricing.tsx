"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import Link from 'next/link';

const plans = [
    {
        id: 'starter',
        name: 'Starter',
        description: 'Perfect for solo operators.',
        price: 299,
        features: [
            "Up to 100 automated texts",
            "Standard call forwarding",
            "Basic Lead Alerts (SMS)",
            "Email Support"
        ],
        cta: 'Start Trial',
        popular: false,
    },
    {
        id: 'pro',
        name: 'Pro',
        description: 'For growing teams & shops.',
        price: 499,
        features: [
            "Unlimited automated texts",
            "Priority Owner Alerts",
            "2-Way Texting Relay",
            "Dedicated Support Line",
            "Custom Auto-Reply Message"
        ],
        cta: 'Get Started',
        popular: true,
    },
];

export default function Pricing() {
    return (
        <section id="pricing" className="py-24 bg-slate-50">
            <div className="container px-4 mx-auto">
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <h2 className="text-3xl md:text-5xl font-bold mb-4 text-slate-900">Simple, transparent pricing.</h2>
                    <p className="text-xl text-slate-500">Start with a 14-day free trial. No credit card required.</p>
                </div>

                <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                    {plans.map(plan => (
                        <div
                            key={plan.id}
                            className={`bg-white p-8 rounded-3xl border flex flex-col transition-all duration-300 ${
                                plan.popular
                                    ? 'shadow-xl border-blue-100 hover:shadow-2xl relative overflow-hidden transform hover:-translate-y-1'
                                    : 'shadow-sm border-slate-200 hover:shadow-xl'
                            }`}
                        >
                            {plan.popular && (
                                <div className="absolute top-0 right-0 bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-bl-xl uppercase tracking-wider">
                                    Most Popular
                                </div>
                            )}
                            <div className="mb-8">
                                <h3 className="text-2xl font-bold text-slate-900">{plan.name}</h3>
                                <p className="text-slate-500 mt-2">{plan.description}</p>
                            </div>
                            <div className="mb-8">
                                <span className="text-5xl font-bold text-slate-900">${plan.price}</span>
                                <span className="text-slate-500 text-lg">/mo</span>
                            </div>
                            <ul className="space-y-4 mb-8 flex-1">
                                {plan.features.map((feature, i) => (
                                    <li key={i} className={`flex items-center gap-3 ${plan.popular ? 'text-slate-700 font-medium' : 'text-slate-600'}`}>
                                        <Check className={`h-5 w-5 flex-shrink-0 ${plan.popular ? 'text-blue-600' : 'text-blue-500'}`} />
                                        <span>{feature}</span>
                                    </li>
                                ))}
                            </ul>
                            <Button
                                asChild
                                className={`w-full text-lg h-12 rounded-xl ${
                                    plan.popular
                                        ? 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200'
                                        : 'bg-slate-100 text-slate-900 hover:bg-slate-200 border border-slate-200'
                                }`}
                            >
                                <Link href={`/onboarding?plan=${plan.id}`}>{plan.cta}</Link>
                            </Button>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
