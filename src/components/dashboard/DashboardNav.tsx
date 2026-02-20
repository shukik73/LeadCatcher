"use client";

import { usePathname, useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';
import { Button } from '@/components/ui/button';
import { MessageSquare, Settings, CreditCard, LogOut, Inbox, Menu, X } from 'lucide-react';
import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
    { href: '/dashboard', label: 'Inbox', icon: Inbox },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
    { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
];

export function DashboardNav() {
    const pathname = usePathname();
    const router = useRouter();
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);
    const [mobileOpen, setMobileOpen] = useState(false);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.push('/login');
    };

    const isActive = (href: string) => {
        if (href === '/dashboard') return pathname === '/dashboard';
        return pathname.startsWith(href);
    };

    return (
        <>
            {/* Mobile top bar */}
            <div className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-800">
                    <div className="bg-blue-600 text-white p-1 rounded">
                        <MessageSquare size={14} fill="currentColor" />
                    </div>
                    LeadCatcher
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setMobileOpen(!mobileOpen)}
                    aria-label="Toggle navigation"
                >
                    {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </Button>
            </div>

            {/* Mobile dropdown */}
            {mobileOpen && (
                <div className="md:hidden bg-white border-b border-slate-200 px-2 pb-2 space-y-1">
                    {NAV_ITEMS.map((item) => (
                        <Button
                            key={item.href}
                            variant="ghost"
                            className={cn(
                                "w-full justify-start",
                                isActive(item.href)
                                    ? "bg-blue-50 text-blue-700"
                                    : "text-slate-600 hover:text-slate-900"
                            )}
                            onClick={() => { router.push(item.href); setMobileOpen(false); }}
                        >
                            <item.icon className="h-4 w-4 mr-2" />
                            {item.label}
                        </Button>
                    ))}
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-slate-600 hover:text-red-600"
                        onClick={handleSignOut}
                    >
                        <LogOut className="h-4 w-4 mr-2" />
                        Sign Out
                    </Button>
                </div>
            )}

            {/* Desktop sidebar */}
            <div className="hidden md:flex w-16 bg-white border-r border-slate-200 flex-col items-center py-4 gap-1 shrink-0">
                <div className="bg-blue-600 text-white p-1.5 rounded mb-4">
                    <MessageSquare size={16} fill="currentColor" />
                </div>

                {NAV_ITEMS.map((item) => (
                    <button
                        key={item.href}
                        onClick={() => router.push(item.href)}
                        title={item.label}
                        aria-label={item.label}
                        className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
                            isActive(item.href)
                                ? "bg-blue-50 text-blue-600"
                                : "text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                        )}
                    >
                        <item.icon className="h-5 w-5" />
                    </button>
                ))}

                <div className="flex-1" />

                <button
                    onClick={handleSignOut}
                    title="Sign Out"
                    aria-label="Sign Out"
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                    <LogOut className="h-5 w-5" />
                </button>
            </div>
        </>
    );
}
