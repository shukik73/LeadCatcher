"use client";

import { Skeleton } from '@/components/ui/skeleton';
import { MessageSquare } from 'lucide-react';

function LeadItemSkeleton() {
    return (
        <div className="p-4 border-b border-slate-50">
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
            <div className="p-4 border-b border-slate-100">
                <h1 className="font-bold text-xl text-slate-800 flex items-center gap-2">
                    <div className="bg-blue-600 text-white p-1 rounded">
                        <MessageSquare size={14} fill="currentColor" />
                    </div>
                    LeadCatcher
                </h1>
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
        <div className="flex-1 flex flex-col h-[calc(100vh-65px)] md:h-screen">
            {/* Header Skeleton */}
            <header className="bg-white border-b border-slate-200 p-4 flex justify-between items-center">
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

            {/* Messages Area Skeleton */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50/50">
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

            {/* Input Skeleton */}
            <div className="p-4 bg-white border-t border-slate-200">
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
        <div className="flex h-screen bg-slate-50 overflow-hidden flex-col md:flex-row">
            {/* Mobile Header */}
            <div className="md:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between">
                <h1 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                    <div className="bg-blue-600 text-white p-1 rounded">
                        <MessageSquare size={14} fill="currentColor" />
                    </div>
                    LeadCatcher
                </h1>
                <Skeleton className="h-8 w-8" />
            </div>

            {/* Desktop Sidebar */}
            <div className="hidden md:flex w-80 bg-white border-r border-slate-200 flex-col">
                <SidebarSkeleton />
            </div>

            {/* Main Chat Area */}
            <ChatAreaSkeleton />
        </div>
    );
}

export { SidebarSkeleton };
