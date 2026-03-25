"use client";

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const urgencyConfig = {
    high: { label: 'High', className: 'bg-red-100 text-red-800 border-red-200' },
    medium: { label: 'Medium', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    low: { label: 'Low', className: 'bg-green-100 text-green-800 border-green-200' },
} as const;

const sentimentConfig = {
    positive: { label: 'Positive', className: 'bg-green-100 text-green-800 border-green-200' },
    neutral: { label: 'Neutral', className: 'bg-slate-100 text-slate-700 border-slate-200' },
    negative: { label: 'Negative', className: 'bg-orange-100 text-orange-800 border-orange-200' },
    frustrated: { label: 'Frustrated', className: 'bg-red-100 text-red-800 border-red-200' },
} as const;

const categoryConfig = {
    repair_quote: { label: 'Repair Quote' },
    status_check: { label: 'Status Check' },
    parts_inquiry: { label: 'Parts Inquiry' },
    follow_up: { label: 'Follow Up' },
    spam: { label: 'Spam' },
    wrong_number: { label: 'Wrong Number' },
} as const;

const statusConfig = {
    pending: { label: 'Pending', className: 'bg-blue-100 text-blue-800 border-blue-200' },
    called: { label: 'Called', className: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
    no_answer: { label: 'No Answer', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    booked: { label: 'Booked', className: 'bg-green-100 text-green-800 border-green-200' },
    lost: { label: 'Lost', className: 'bg-red-100 text-red-800 border-red-200' },
} as const;

export function UrgencyBadge({ urgency }: { urgency: string | null }) {
    const config = urgencyConfig[urgency as keyof typeof urgencyConfig];
    if (!config) return null;
    return <Badge variant="outline" className={cn(config.className)}>{config.label}</Badge>;
}

export function SentimentBadge({ sentiment }: { sentiment: string | null }) {
    const config = sentimentConfig[sentiment as keyof typeof sentimentConfig];
    if (!config) return null;
    return <Badge variant="outline" className={cn(config.className)}>{config.label}</Badge>;
}

export function CategoryBadge({ category }: { category: string | null }) {
    const config = categoryConfig[category as keyof typeof categoryConfig];
    if (!config) return null;
    return <Badge variant="secondary">{config.label}</Badge>;
}

export function CallbackStatusBadge({ status }: { status: string | null }) {
    const config = statusConfig[status as keyof typeof statusConfig];
    if (!config) return null;
    return <Badge variant="outline" className={cn(config.className)}>{config.label}</Badge>;
}
