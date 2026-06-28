"use client";

import { Check } from 'lucide-react';

const waiting = [
    { initials: 'JD', name: 'Jordan Diaz', note: 'Needs a water heater looked at today?', tag: 'Replied' },
    { initials: 'SP', name: 'Sam Porter', note: 'Texted back · waiting on a reply', tag: 'Texted' },
    { initials: 'RK', name: 'Rae Kim', note: 'Perfect, see you Thursday 👍', tag: 'Booked' },
];

const benefits = [
    'See who called and what they said back',
    'Call back or text with one tap',
    'Works on the phone already in your pocket',
];

export default function WholeApp() {
    return (
        <section className="bg-[#16120B] py-24">
            <div className="container mx-auto grid grid-cols-1 items-center gap-14 px-4 md:px-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/5 bg-[#1E1810] p-6 shadow-2xl shadow-black/40">
                    <div className="mb-5 flex items-center justify-between">
                        <div>
                            <p className="text-xs text-stone-500">Tuesday · good morning, Mara</p>
                            <p className="text-lg font-semibold text-stone-50">3 people are waiting</p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E0A43B]/15 px-2.5 py-1 text-xs font-medium text-[#E0A43B]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#E0A43B]" /> Live
                        </span>
                    </div>

                    <ul className="space-y-3">
                        {waiting.map((p) => (
                            <li key={p.name} className="flex items-center gap-3 rounded-xl border border-white/5 bg-[#241D13] px-3 py-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E0A43B]/15 text-xs font-bold text-[#E0A43B]">
                                    {p.initials}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-stone-100">{p.name}</p>
                                    <p className="truncate text-xs text-stone-500">{p.note}</p>
                                </div>
                                <span className="hidden shrink-0 rounded-md bg-white/5 px-2 py-1 text-[11px] text-stone-400 sm:inline">{p.tag}</span>
                                <button className="shrink-0 rounded-lg bg-[#E0A43B] px-3 py-1.5 text-xs font-semibold text-[#1A1206]">Call</button>
                            </li>
                        ))}
                    </ul>
                </div>

                <div>
                    <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[#E0A43B]">Your whole app</p>
                    <h2 className="mb-4 text-3xl font-bold tracking-tight text-stone-50 md:text-4xl">
                        One screen. The people who need you.
                    </h2>
                    <p className="mb-8 max-w-lg text-lg leading-relaxed text-stone-400">
                        We threw out the clutter — no Coaching, no Analytics, no menus full of tabs. Open it between jobs, see who&apos;s waiting, tap to call. That&apos;s the whole thing.
                    </p>
                    <ul className="space-y-3">
                        {benefits.map((b) => (
                            <li key={b} className="flex items-center gap-3 text-stone-200">
                                <Check className="h-5 w-5 shrink-0 text-[#E0A43B]" />
                                {b}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    );
}
