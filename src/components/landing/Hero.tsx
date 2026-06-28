"use client";

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { Phone, Play, Check, TrendingUp } from 'lucide-react';

const ACCENT = '#E0A43B';
const ACCENT_FG = '#1A1206';

const inlineChecks = ['Live in 5 minutes', 'Keep your number', 'No app to install'];

const stats = [
    { value: '4.9★', label: 'from owners' },
    { value: '4 sec', label: 'to text back' },
    { value: '5 min', label: 'to set up' },
];

export default function Hero() {
    return (
        <section
            className="relative overflow-hidden pt-32 pb-0 lg:pt-40"
            style={{
                ['--lc-accent' as string]: ACCENT,
                ['--lc-accent-fg' as string]: ACCENT_FG,
                backgroundColor: '#16120B',
            }}
        >
            <div className="absolute inset-0 -z-10 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-b from-[#1B150D] via-[#16120B] to-[#16120B]" />
                <div className="absolute -top-24 right-10 h-[26rem] w-[26rem] rounded-full bg-[var(--lc-accent)]/10 blur-[130px]" />
            </div>

            <div className="container mx-auto px-4 md:px-6">
                <div className="grid grid-cols-1 items-center gap-14 pb-16 lg:grid-cols-2 lg:gap-12 lg:pb-20">
                    <div className="text-center lg:text-left">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                            className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-[var(--lc-accent)]"
                        >
                            <span className="flex h-2 w-2 rounded-full bg-[var(--lc-accent)]" />
                            Built for plumbers, HVAC, electricians &amp; auto shops
                        </motion.div>

                        <motion.h1
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.1 }}
                            className="mx-auto mb-6 max-w-xl text-4xl font-bold leading-[1.05] tracking-tight text-stone-50 sm:text-5xl lg:mx-0 lg:text-6xl"
                        >
                            You didn&apos;t just miss the call. You lost <span className="text-[var(--lc-accent)]">the job.</span>
                        </motion.h1>

                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.2 }}
                            className="mx-auto mb-9 max-w-lg text-lg leading-relaxed text-stone-300 lg:mx-0"
                        >
                            When you can&apos;t pick up, LeadCatcher texts the caller back in seconds &mdash; in your shop&apos;s own voice. The lead stays warm and the job stays yours.
                        </motion.p>

                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.3 }}
                            className="flex flex-col items-center gap-4 sm:flex-row lg:justify-start"
                        >
                            <Button
                                asChild
                                size="lg"
                                className="h-14 rounded-xl bg-[var(--lc-accent)] px-8 text-lg font-semibold text-[var(--lc-accent-fg)] shadow-lg shadow-[var(--lc-accent)]/20 transition-all hover:brightness-110 hover:shadow-xl hover:shadow-[var(--lc-accent)]/30"
                            >
                                <Link href="/onboarding">Start free &mdash; no card</Link>
                            </Button>
                            <Link
                                href="#how-it-works"
                                className="inline-flex items-center gap-3 text-lg font-medium text-stone-200 transition-colors hover:text-white"
                            >
                                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-600">
                                    <Play className="h-4 w-4 fill-current" />
                                </span>
                                Watch 60-sec demo
                            </Link>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.4 }}
                            className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm text-stone-400 lg:justify-start"
                        >
                            {inlineChecks.map((item, i) => (
                                <span key={item} className="flex items-center gap-2">
                                    {i > 0 && <span className="text-stone-600">·</span>}
                                    {item}
                                </span>
                            ))}
                        </motion.div>
                    </div>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.7, delay: 0.3 }}
                        className="relative mx-auto w-full max-w-md"
                    >
                        <div className="rounded-3xl border border-white/5 bg-[#1E1810] p-6 shadow-2xl shadow-black/40">
                            <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-stone-400">
                                    <Phone className="h-4 w-4" />
                                </span>
                                <div className="text-left">
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Missed call · 9:41 AM</p>
                                    <p className="text-base font-semibold text-white">(555) 123-4567</p>
                                </div>
                            </div>

                            <div className="space-y-3 pt-4">
                                <div className="flex flex-col items-end">
                                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[var(--lc-accent)] px-4 py-2.5 text-left text-sm font-medium text-[var(--lc-accent-fg)]">
                                        Hi, it&apos;s Mara at Ridgeline Plumbing &mdash; sorry I missed you! What can I help with?
                                    </div>
                                    <span className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-stone-500">
                                        <Check className="h-3 w-3 text-[var(--lc-accent)]" /> Sent automatically · 4 sec
                                    </span>
                                </div>

                                <div className="flex justify-start">
                                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-[#2A2318] px-4 py-2.5 text-left text-sm text-stone-100">
                                        Oh great &mdash; my water heater&apos;s leaking. Can someone come today?
                                    </div>
                                </div>

                                <div className="flex justify-end">
                                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[var(--lc-accent)] px-4 py-2.5 text-left text-sm font-medium text-[var(--lc-accent-fg)]">
                                        Absolutely &mdash; I&apos;ve got you down for 2pm 🔥
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="absolute -bottom-10 -left-3 flex items-center gap-3 rounded-2xl border border-[var(--lc-accent)]/25 bg-[#1E1810] px-4 py-3 shadow-xl shadow-black/40">
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--lc-accent)]/15 text-[var(--lc-accent)]">
                                <TrendingUp className="h-5 w-5" />
                            </span>
                            <div className="text-left">
                                <p className="text-sm font-bold text-[var(--lc-accent)]">$1,400 job</p>
                                <p className="text-xs text-stone-400">saved from voicemail</p>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>

            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.6 }}
                className="border-t border-white/5 bg-black/20"
            >
                <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 py-6 text-sm md:flex-row md:px-6">
                    <p className="text-stone-400">Trusted by 200+ local shops across the trades</p>
                    <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
                        {stats.map((s) => (
                            <li key={s.label} className="text-stone-400">
                                <span className="font-semibold text-[var(--lc-accent)]">{s.value}</span> {s.label}
                            </li>
                        ))}
                    </ul>
                </div>
            </motion.div>
        </section>
    );
}
