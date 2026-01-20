"use client";

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
    {
        question: "How does call forwarding work?",
        answer: "You set up conditional call forwarding with your carrier (takes about 2 minutes). When you miss a call, it automatically forwards to your LeadCatcher number, which handles the voicemail and sends the instant text."
    },
    {
        question: "Will customers know they're texting an automated system?",
        answer: "The initial text is automated, but you can customize the message to match your brand voice. All follow-up texts come directly from you through our 2-way texting feature."
    },
    {
        question: "What if I want to turn it off during certain hours?",
        answer: "You can set business hours in your dashboard. Outside those hours, callers get a different message letting them know when you'll be available."
    },
    {
        question: "Do I need to change my phone number?",
        answer: "No! You keep your existing business number. We provide a forwarding number that works behind the scenes. Your customers always see your real number."
    },
    {
        question: "Is there a contract or commitment?",
        answer: "No contracts. Start with a free 14-day trial, then pay month-to-month. Cancel anytime with no fees."
    },
    {
        question: "What carriers do you support?",
        answer: "We support all major carriers including Verizon, AT&T, T-Mobile, and most regional carriers. Our setup wizard will guide you through the specific steps for your carrier."
    }
];

export default function FAQ() {
    return (
        <section id="faq" className="py-24 bg-white">
            <div className="container px-4 mx-auto">
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <h2 className="text-3xl md:text-5xl font-bold mb-4 text-slate-900">
                        Frequently asked questions
                    </h2>
                    <p className="text-xl text-slate-500">
                        Everything you need to know about LeadCatcher.
                    </p>
                </div>

                <div className="max-w-2xl mx-auto">
                    <Accordion type="single" collapsible className="w-full">
                        {faqs.map((faq, index) => (
                            <AccordionItem key={index} value={`item-${index}`}>
                                <AccordionTrigger className="text-left text-slate-900 hover:text-blue-600">
                                    {faq.question}
                                </AccordionTrigger>
                                <AccordionContent className="text-slate-500">
                                    {faq.answer}
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </div>
            </div>
        </section>
    );
}
