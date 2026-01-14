"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import Link from 'next/link';

const features = {
    starter: [
        "Up to 100 automated texts",
        "Standard call forwarding",
        "Basic Lead Alerts (SMS)",
        "Email Support"
    ],
    pro: [
        "Unlimited automated texts",
        "Priority Owner Alerts",
        "2-Way Texting Relay",
        "Dedicated Support Line",
        "Custom Auto-Reply Message"
    ]
};

export default function Pricing() {
    return (
        <section id="pricing" className="py-24 bg-slate-50">
            <div className="container px-4 mx-auto">
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <h2 className="text-3xl md:text-5xl font-bold mb-4 text-slate-900">Simple, transparent pricing.</h2>
                    <p className="text-xl text-slate-500">Start with a 14-day free trial. No credit card required.</p>
                </div>

                <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                    {/* Starter Plan */}
                    <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 hover:shadow-xl transition-all duration-300 flex flex-col">
                        <div className="mb-8">
                            <h3 className="text-2xl font-bold text-slate-900">Starter</h3>
                            <p className="text-slate-500 mt-2">Perfect for solo operators.</p>
                        </div>
                        <div className="mb-8">
                            <span className="text-5xl font-bold text-slate-900">$299</span>
                            <span className="text-slate-500 text-lg">/mo</span>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1">
                            {features.starter.map((feature, i) => (
                                <li key={i} className="flex items-center gap-3 text-slate-600">
                                    <Check className="h-5 w-5 text-blue-500 flex-shrink-0" />
                                    <span>{feature}</span>
                                </li>
                            ))}
                        </ul>
                        <Button asChild className="w-full text-lg h-12 rounded-xl bg-slate-100 text-slate-900 hover:bg-slate-200 border border-slate-200">
                            <Link href="/onboarding?plan=starter">Start Trial</Link>
                        </Button>
                    </div>

                    {/* Pro Plan */}
                    <div className="bg-white p-8 rounded-3xl shadow-xl border border-blue-100 hover:shadow-2xl transition-all duration-300 relative overflow-hidden flex flex-col transform hover:-translate-y-1">
                        <div className="absolute top-0 right-0 bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-bl-xl uppercase tracking-wider">
                            Most Popular
                        </div>
                        <div className="mb-8">
                            <h3 className="text-2xl font-bold text-slate-900">Pro</h3>
                            <p className="text-slate-500 mt-2">For growing teams & shops.</p>
                        </div>
                        <div className="mb-8">
                            <span className="text-5xl font-bold text-slate-900">$499</span>
                            <span className="text-slate-500 text-lg">/mo</span>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1">
                            {features.pro.map((feature, i) => (
                                <li key={i} className="flex items-center gap-3 text-slate-700 font-medium">
                                    <Check className="h-5 w-5 text-blue-600 flex-shrink-0" />
                                    <span>{feature}</span>
                                </li>
                            ))}
                        </ul>
                        <Button asChild className="w-full text-lg h-12 rounded-xl bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200">
                            <Link href="/onboarding?plan=pro">Get Started</Link>
                        </Button>
                    </div>
                </div>
            </div>
        </section>
    );
}
