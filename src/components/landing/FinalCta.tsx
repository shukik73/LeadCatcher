"use client";

import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function FinalCta() {
    return (
        <section className="bg-[#16120B] py-24">
            <div className="container mx-auto max-w-2xl px-4 text-center md:px-6">
                <h2 className="mb-4 text-3xl font-bold tracking-tight text-stone-50 md:text-5xl">
                    The next call is already on its way.
                </h2>
                <p className="mb-8 text-lg text-stone-400">
                    Catch it. Set up takes five minutes — no card needed.
                </p>
                <Button
                    asChild
                    size="lg"
                    className="h-14 rounded-xl bg-[#E0A43B] px-8 text-lg font-semibold text-[#1A1206] shadow-lg shadow-[#E0A43B]/20 transition-all hover:brightness-110"
                >
                    <Link href="/onboarding">Start free — no card</Link>
                </Button>
            </div>
        </section>
    );
}
