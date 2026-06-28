
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';

export default function Footer() {
    return (
        <footer className="border-t border-white/5 bg-[#100D08] py-12">
            <div className="container mx-auto px-4 md:px-6">
                <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
                    <div className="flex items-center gap-2">
                        <div className="rounded-md bg-[#E0A43B] p-1.5 text-[#1A1206]">
                            <MessageSquare size={16} fill="currentColor" />
                        </div>
                        <span className="font-bold text-stone-100">LeadCatcher</span>
                    </div>

                    <div className="text-sm text-stone-500">
                        &copy; {new Date().getFullYear()} LeadCatcher. All rights reserved.
                    </div>

                    <div className="flex gap-6 text-sm font-medium text-stone-400">
                        <Link href="/privacy" className="hover:text-stone-100">Privacy</Link>
                        <Link href="/terms" className="hover:text-stone-100">Terms</Link>
                        <Link href="mailto:support@leadcatcher.io" className="hover:text-stone-100">Support</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
