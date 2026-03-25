"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export interface CallFiltersState {
    category: string;
    urgency: string;
    sentiment: string;
    callback_status: string;
    owner: string;
    from: string;
    to: string;
}

const EMPTY_FILTERS: CallFiltersState = {
    category: '',
    urgency: '',
    sentiment: '',
    callback_status: '',
    owner: '',
    from: '',
    to: '',
};

interface CallFiltersProps {
    filters: CallFiltersState;
    onChange: (filters: CallFiltersState) => void;
}

export function CallFilters({ filters, onChange }: CallFiltersProps) {
    const update = (key: keyof CallFiltersState, value: string) => {
        onChange({ ...filters, [key]: value });
    };

    const hasFilters = Object.values(filters).some(Boolean);

    return (
        <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1">
                <label className="text-xs text-slate-500">Category</label>
                <Select value={filters.category || '_all'} onValueChange={(v) => update('category', v === '_all' ? '' : v)}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All</SelectItem>
                        <SelectItem value="repair_quote">Repair Quote</SelectItem>
                        <SelectItem value="status_check">Status Check</SelectItem>
                        <SelectItem value="parts_inquiry">Parts Inquiry</SelectItem>
                        <SelectItem value="follow_up">Follow Up</SelectItem>
                        <SelectItem value="spam">Spam</SelectItem>
                        <SelectItem value="wrong_number">Wrong Number</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1">
                <label className="text-xs text-slate-500">Urgency</label>
                <Select value={filters.urgency || '_all'} onValueChange={(v) => update('urgency', v === '_all' ? '' : v)}>
                    <SelectTrigger className="w-[110px] h-8 text-xs">
                        <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1">
                <label className="text-xs text-slate-500">Status</label>
                <Select value={filters.callback_status || '_all'} onValueChange={(v) => update('callback_status', v === '_all' ? '' : v)}>
                    <SelectTrigger className="w-[120px] h-8 text-xs">
                        <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="called">Called</SelectItem>
                        <SelectItem value="no_answer">No Answer</SelectItem>
                        <SelectItem value="booked">Booked</SelectItem>
                        <SelectItem value="lost">Lost</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1">
                <label className="text-xs text-slate-500">Sentiment</label>
                <Select value={filters.sentiment || '_all'} onValueChange={(v) => update('sentiment', v === '_all' ? '' : v)}>
                    <SelectTrigger className="w-[120px] h-8 text-xs">
                        <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_all">All</SelectItem>
                        <SelectItem value="positive">Positive</SelectItem>
                        <SelectItem value="neutral">Neutral</SelectItem>
                        <SelectItem value="negative">Negative</SelectItem>
                        <SelectItem value="frustrated">Frustrated</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1">
                <label className="text-xs text-slate-500">Owner</label>
                <Input
                    className="w-[120px] h-8 text-xs"
                    placeholder="Any"
                    value={filters.owner}
                    onChange={(e) => update('owner', e.target.value)}
                />
            </div>

            <div className="space-y-1">
                <label className="text-xs text-slate-500">From</label>
                <Input
                    type="date"
                    className="w-[130px] h-8 text-xs"
                    value={filters.from}
                    onChange={(e) => update('from', e.target.value)}
                />
            </div>

            <div className="space-y-1">
                <label className="text-xs text-slate-500">To</label>
                <Input
                    type="date"
                    className="w-[130px] h-8 text-xs"
                    value={filters.to}
                    onChange={(e) => update('to', e.target.value)}
                />
            </div>

            {hasFilters && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange(EMPTY_FILTERS)}
                    className="h-8 text-xs"
                >
                    <X className="h-3 w-3 mr-1" />
                    Clear
                </Button>
            )}
        </div>
    );
}

export { EMPTY_FILTERS };
