"use client";

import { Skeleton } from '@/components/ui/skeleton';

function LeadItemSkeleton() {
    return (
        <div className="p-4 border-b border-border">
            <div className="flex justify-between mb-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-4 w-48 mb-2" />
            <Skeleton className="h-5 w-16 rounded-full" />
        </div>
    );
}

function SidebarSkeleton() {
    return (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b border-border">
                <Skeleton className="h-6 w-32" />
            </div>
            <div className="p-4">
                <Skeleton className="h-10 w-full" />
            </div>
            <div className="flex-1 overflow-y-auto">
                <LeadItemSkeleton />
                <LeadItemSkeleton />
                <LeadItemSkeleton />
                <LeadItemSkeleton />
                <LeadItemSkeleton />
            </div>
        </div>
    );
}

function ChatAreaSkeleton() {
    return (
        <div className="flex-1 flex flex-col h-full">
            <header className="bg-card border-b border-border p-4 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div>
                        <Skeleton className="h-5 w-32 mb-1" />
                        <Skeleton className="h-3 w-24" />
                    </div>
                </div>
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-8 w-32" />
                </div>
            </header>

            <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-muted/50">
                <div className="flex justify-start">
                    <Skeleton className="h-16 w-64 rounded-2xl" />
                </div>
                <div className="flex justify-end">
                    <Skeleton className="h-12 w-48 rounded-2xl" />
                </div>
                <div className="flex justify-start">
                    <Skeleton className="h-20 w-72 rounded-2xl" />
                </div>
                <div className="flex justify-end">
                    <Skeleton className="h-10 w-40 rounded-2xl" />
                </div>
            </div>

            <div className="p-4 bg-card border-t border-border">
                <div className="flex gap-2">
                    <Skeleton className="h-10 flex-1" />
                    <Skeleton className="h-10 w-10" />
                </div>
            </div>
        </div>
    );
}

export function DashboardSkeleton() {
    return (
        <div className="flex h-full bg-muted overflow-hidden flex-col md:flex-row">
            {/* Desktop Leads Sidebar */}
            <div className="hidden md:flex w-80 bg-card border-r border-border flex-col">
                <SidebarSkeleton />
            </div>

            {/* Main Chat Area */}
            <ChatAreaSkeleton />
        </div>
    );
}

export { SidebarSkeleton };
