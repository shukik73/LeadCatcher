
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';

export default function Footer() {
    return (
        <footer className="bg-slate-50 py-12 border-t border-slate-200">
            <div className="container px-4 mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-2">
                        <div className="bg-blue-600 text-white p-1.5 rounded-md">
                            <MessageSquare size={16} fill="currentColor" />
                        </div>
                        <span className="font-bold text-slate-900">LeadCatcher</span>
                    </div>

                    <div className="text-slate-500 text-sm">
                        &copy; {new Date().getFullYear()} LeadCatcher. All rights reserved.
                    </div>

                    <div className="flex gap-6 text-sm text-slate-500 font-medium">
                        <Link href="/privacy" className="hover:text-slate-900">Privacy</Link>
                        <Link href="/terms" className="hover:text-slate-900">Terms</Link>
                        <Link href="#" className="hover:text-slate-900">Contact</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}
