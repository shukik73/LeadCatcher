
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';

export default function Header() {
    return (
        <header className="fixed top-0 left-0 right-0 py-4 px-6 bg-white/80 backdrop-blur-md z-50 border-b border-slate-100">
            <div className="max-w-6xl mx-auto flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2 group">
                    <div className="bg-blue-600 text-white p-2 rounded-lg group-hover:scale-105 transition-transform">
                        <MessageSquare size={20} fill="currentColor" className="text-white" />
                    </div>
                    <span className="text-xl font-bold text-slate-900 tracking-tight">LeadCatcher</span>
                </Link>

                <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
                    <Link href="#how-it-works" className="hover:text-blue-600 transition-colors">How it Works</Link>
                    <Link href="#pricing" className="hover:text-blue-600 transition-colors">Pricing</Link>
                    <Link href="#faq" className="hover:text-blue-600 transition-colors">FAQ</Link>
                    <Link href="/login" className="hover:text-blue-600 transition-colors">Login</Link>
                </nav>

                <div className="flex items-center gap-4">
                    <Link href="/login" className="md:hidden text-sm font-medium text-slate-600">Login</Link>
                    <Button asChild className="rounded-full px-6 bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-200">
                        <Link href="/onboarding">Start Free Trial</Link>
                    </Button>
                </div>
            </div>
        </header>
    );
}
