"use client";

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const urgencyConfig = {
    high: { label: 'High', className: 'bg-red-500/15 text-red-300 border-red-500/20' },
    medium: { label: 'Medium', className: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20' },
    low: { label: 'Low', className: 'bg-green-500/15 text-green-300 border-green-500/20' },
} as const;

const sentimentConfig = {
    positive: { label: 'Positive', className: 'bg-green-500/15 text-green-300 border-green-500/20' },
    neutral: { label: 'Neutral', className: 'bg-muted text-muted-foreground border-border' },
    negative: { label: 'Negative', className: 'bg-orange-500/15 text-orange-300 border-orange-500/20' },
    frustrated: { label: 'Frustrated', className: 'bg-red-500/15 text-red-300 border-red-500/20' },
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
    pending: { label: 'Pending', className: 'bg-primary/15 text-primary border-primary/20' },
    called: { label: 'Called', className: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/20' },
    no_answer: { label: 'No Answer', className: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20' },
    booked: { label: 'Booked', className: 'bg-green-500/15 text-green-300 border-green-500/20' },
    lost: { label: 'Lost', className: 'bg-red-500/15 text-red-300 border-red-500/20' },
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
