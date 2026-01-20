"use client";

import { Phone, MessageSquare, Bell, CheckCircle2 } from 'lucide-react';

const steps = [
    {
        icon: Phone,
        title: "Customer Calls",
        description: "A potential customer calls your business line while you're busy working.",
        color: "bg-red-100 text-red-600"
    },
    {
        icon: MessageSquare,
        title: "Auto Text Sent",
        description: "Within seconds, they receive a friendly text letting them know you'll follow up.",
        color: "bg-blue-100 text-blue-600"
    },
    {
        icon: Bell,
        title: "You Get Notified",
        description: "Get an instant alert with the caller's info and voicemail summary.",
        color: "bg-amber-100 text-amber-600"
    },
    {
        icon: CheckCircle2,
        title: "Close the Deal",
        description: "Follow up when you're ready. The lead stays warm, and you win the job.",
        color: "bg-green-100 text-green-600"
    }
];

export default function HowItWorks() {
    return (
        <section id="how-it-works" className="py-24 bg-white">
            <div className="container px-4 mx-auto">
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <h2 className="text-3xl md:text-5xl font-bold mb-4 text-slate-900">
                        How it works
                    </h2>
                    <p className="text-xl text-slate-500">
                        Set up in 5 minutes. Never lose a lead to a missed call again.
                    </p>
                </div>

                <div className="grid md:grid-cols-4 gap-8 max-w-5xl mx-auto">
                    {steps.map((step, index) => (
                        <div key={index} className="relative">
                            {/* Connector line */}
                            {index < steps.length - 1 && (
                                <div className="hidden md:block absolute top-8 left-1/2 w-full h-0.5 bg-slate-200" />
                            )}

                            <div className="relative flex flex-col items-center text-center">
                                <div className={`h-16 w-16 rounded-full ${step.color} flex items-center justify-center mb-4 relative z-10`}>
                                    <step.icon size={28} />
                                </div>
                                <h3 className="font-semibold text-lg text-slate-900 mb-2">{step.title}</h3>
                                <p className="text-slate-500 text-sm">{step.description}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
