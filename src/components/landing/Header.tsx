"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Header() {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 12);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    return (
        <header
            className={cn(
                'fixed top-0 left-0 right-0 z-50 py-4 px-6 transition-colors duration-300',
                scrolled
                    ? 'bg-[#16120B]/85 backdrop-blur-md border-b border-white/5'
                    : 'bg-transparent border-b border-transparent'
            )}
        >
            <div className="max-w-6xl mx-auto flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2 group">
                    <div className="bg-[#E0A43B] p-2 rounded-lg group-hover:scale-105 transition-transform">
                        <MessageSquare size={20} fill="currentColor" className="text-[#1A1206]" />
                    </div>
                    <span className="text-xl font-bold tracking-tight text-stone-50">LeadCatcher</span>
                </Link>

                <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-stone-300">
                    <Link href="#how-it-works" className="transition-colors hover:text-white">How it works</Link>
                    <Link href="#pricing" className="transition-colors hover:text-white">Pricing</Link>
                    <Link href="/login" className="transition-colors hover:text-white">Login</Link>
                </nav>

                <div className="flex items-center gap-4">
                    <Link href="/login" className="md:hidden text-sm font-medium text-stone-300">Login</Link>
                    <Button asChild className="rounded-full px-6 bg-[#E0A43B] hover:brightness-110 text-[#1A1206] font-semibold shadow-lg shadow-black/10">
                        <Link href="/onboarding">Start free</Link>
                    </Button>
                </div>
            </div>
        </header>
    );
}
