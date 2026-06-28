"use client";

import { usePathname, useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';
import { Button } from '@/components/ui/button';
import { MessageSquare, Settings, CreditCard, LogOut, Inbox, Menu, X, PhoneCall, ListChecks, GraduationCap, ClipboardCheck, ListTodo, BarChart3, User, Flame, Sun, ChevronDown, ChevronRight } from 'lucide-react';
import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

// The daily loop, front and center: read your texts (Inbox), see what needs you
// (Today), work the follow-up queue (Queue), configure (Settings).
const PRIMARY_ITEMS = [
    { href: '/dashboard', label: 'Inbox', icon: Inbox },
    { href: '/dashboard/today', label: 'Today', icon: Sun },
    { href: '/dashboard/hot-leads', label: 'Queue', icon: Flame },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

// Secondary but still everyday-useful.
const MORE_ITEMS = [
    { href: '/dashboard/calls', label: 'Calls', icon: PhoneCall },
    { href: '/dashboard/followups', label: 'Follow-Ups', icon: ListChecks },
    { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
];

// Power-user screens — tucked away so the nav isn't a wall of options.
const ADVANCED_ITEMS = [
    { href: '/dashboard/coaching', label: 'Coaching', icon: GraduationCap },
    { href: '/dashboard/actions', label: 'Actions', icon: ListTodo },
    { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
    { href: '/dashboard/customer', label: 'Customer', icon: User },
    { href: '/dashboard/audit', label: 'Audit', icon: ClipboardCheck },
];

export function DashboardNav() {
    const pathname = usePathname();
    const router = useRouter();
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);
    const [mobileOpen, setMobileOpen] = useState(false);

    const isActive = (href: string) => {
        if (href === '/dashboard') return pathname === '/dashboard';
        return pathname.startsWith(href);
    };

    // Keep a group open when the current page lives inside it.
    const [moreOpen, setMoreOpen] = useState(MORE_ITEMS.some((i) => isActive(i.href)));
    const [advancedOpen, setAdvancedOpen] = useState(ADVANCED_ITEMS.some((i) => isActive(i.href)));

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.push('/login');
    };

    const go = (href: string) => { router.push(href); setMobileOpen(false); };

    // ── Mobile: a flat list of item buttons ──
    const mobileItem = (item: typeof PRIMARY_ITEMS[number], indent = false) => (
        <Button
            key={item.href}
            variant="ghost"
            className={cn(
                "w-full justify-start",
                indent && "pl-8",
                isActive(item.href)
                    ? "bg-primary/15 text-primary"
                    : indent ? "text-muted-foreground hover:text-foreground" : "text-foreground/70 hover:text-foreground"
            )}
            onClick={() => go(item.href)}
        >
            <item.icon className="h-4 w-4 mr-2" />
            {item.label}
        </Button>
    );

    // ── Desktop: a slimmer item button ──
    const deskItem = (item: typeof PRIMARY_ITEMS[number], indent = false) => (
        <button
            key={item.href}
            onClick={() => router.push(item.href)}
            className={cn(
                "w-full rounded-lg flex items-center gap-2.5 transition-colors",
                indent ? "h-8 pl-6 pr-3 text-sm" : "h-9 px-3 text-sm font-medium",
                isActive(item.href)
                    ? "bg-primary/15 text-primary font-medium"
                    : indent ? "text-muted-foreground hover:text-foreground hover:bg-accent" : "text-foreground/70 hover:text-foreground hover:bg-accent"
            )}
        >
            <item.icon className={cn("shrink-0", indent ? "h-3.5 w-3.5" : "h-4 w-4")} />
            {item.label}
        </button>
    );

    const groupToggle = (label: string, open: boolean, set: (v: boolean) => void, desktop: boolean) => (
        <button
            onClick={() => set(!open)}
            className={cn(
                "w-full rounded-lg flex items-center gap-2.5 px-3 font-medium text-muted-foreground hover:text-foreground transition-colors",
                desktop ? "h-8 mt-2 text-xs" : "h-9 justify-start text-sm"
            )}
        >
            {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            {label}
        </button>
    );

    return (
        <>
            {/* Mobile top bar */}
            <div className="md:hidden dark bg-card text-foreground border-b border-border px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-foreground">
                    <div className="bg-primary text-primary-foreground p-1 rounded">
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
                <div className="md:hidden bg-card border-b border-border px-2 pb-2 space-y-1">
                    {PRIMARY_ITEMS.map((item) => mobileItem(item))}

                    {groupToggle('More', moreOpen, setMoreOpen, false)}
                    {moreOpen && MORE_ITEMS.map((item) => mobileItem(item, true))}

                    {groupToggle('Advanced', advancedOpen, setAdvancedOpen, false)}
                    {advancedOpen && ADVANCED_ITEMS.map((item) => mobileItem(item, true))}

                    <Button
                        variant="ghost"
                        className="w-full justify-start text-foreground/70 hover:text-red-400"
                        onClick={handleSignOut}
                    >
                        <LogOut className="h-4 w-4 mr-2" />
                        Sign Out
                    </Button>
                </div>
            )}

            {/* Desktop sidebar */}
            <div className="hidden md:flex w-48 bg-sidebar border-r border-border flex-col py-4 shrink-0">
                <div className="flex items-center gap-2 px-4 mb-6">
                    <div className="bg-primary text-primary-foreground p-1.5 rounded">
                        <MessageSquare size={16} fill="currentColor" />
                    </div>
                    <span className="font-bold text-sm text-foreground">LeadCatcher</span>
                </div>

                <nav className="flex-1 flex flex-col gap-0.5 px-2">
                    {PRIMARY_ITEMS.map((item) => deskItem(item))}

                    {groupToggle('More', moreOpen, setMoreOpen, true)}
                    {moreOpen && MORE_ITEMS.map((item) => deskItem(item, true))}

                    {groupToggle('Advanced', advancedOpen, setAdvancedOpen, true)}
                    {advancedOpen && ADVANCED_ITEMS.map((item) => deskItem(item, true))}
                </nav>

                <div className="px-2 mt-2">
                    <button
                        onClick={handleSignOut}
                        className="w-full h-9 rounded-lg flex items-center gap-2.5 px-3 text-sm font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                        <LogOut className="h-4 w-4 shrink-0" />
                        Sign Out
                    </button>
                </div>
            </div>
        </>
    );
}
