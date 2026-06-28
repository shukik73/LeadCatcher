"use client";

import { Phone, MessageSquare, PhoneCall } from 'lucide-react';

const steps = [
    {
        step: 'Step 1',
        icon: Phone,
        title: 'A call goes unanswered',
        description: "You're under a sink or up a ladder. It rings out, the way it always does.",
    },
    {
        step: 'Step 2',
        icon: MessageSquare,
        title: 'We text them back',
        description: 'In seconds — sounding like you, not a robot. The customer feels looked after.',
    },
    {
        step: 'Step 3',
        icon: PhoneCall,
        title: 'You call back when free',
        description: "One tidy list shows who's waiting. Tap to call. The job's still warm.",
    },
];

export default function HowItWorks() {
    return (
        <section id="how-it-works" className="bg-[#16120B] py-24">
            <div className="container mx-auto px-4 md:px-6">
                <div className="mb-14 max-w-2xl">
                    <h2 className="mb-4 text-3xl font-bold tracking-tight text-stone-50 md:text-4xl">
                        Three steps. No learning curve.
                    </h2>
                    <p className="text-lg text-stone-400">
                        No dashboards to babysit. No new gadgets. It works quietly in the background.
                    </p>
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                    {steps.map((step) => (
                        <div key={step.step} className="rounded-2xl border border-white/5 bg-[#1E1810] p-8">
                            <span className="mb-6 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#E0A43B]/15 text-[#E0A43B]">
                                <step.icon className="h-5 w-5" />
                            </span>
                            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#E0A43B]">{step.step}</p>
                            <h3 className="mb-2 text-lg font-semibold text-stone-50">{step.title}</h3>
                            <p className="text-sm leading-relaxed text-stone-400">{step.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
