"use client";

import { UrgencyBadge, SentimentBadge, CategoryBadge, CallbackStatusBadge } from '@/components/urgency-badge';
import { Button } from '@/components/ui/button';
import { Phone, Clock, User, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CallAnalysis } from '@/components/call-detail-panel';

interface CallsTableProps {
    calls: CallAnalysis[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
    onPageChange: (page: number) => void;
    onSelectCall: (call: CallAnalysis) => void;
    selectedIds: Set<string>;
    onToggleSelect: (id: string) => void;
}

export function CallsTable({
    calls,
    pagination,
    onPageChange,
    onSelectCall,
    selectedIds,
    onToggleSelect,
}: CallsTableProps) {
    const isOverdue = (call: CallAnalysis) =>
        call.due_by && new Date(call.due_by) < new Date() && call.callback_status === 'pending';

    return (
        <div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b bg-slate-50 text-left">
                            <th className="px-3 py-2 w-8">
                                <input
                                    type="checkbox"
                                    className="rounded"
                                    checked={calls.length > 0 && calls.every(c => selectedIds.has(c.id))}
                                    onChange={(e) => {
                                        calls.forEach(c => {
                                            if (e.target.checked !== selectedIds.has(c.id)) {
                                                onToggleSelect(c.id);
                                            }
                                        });
                                    }}
                                />
                            </th>
                            <th className="px-3 py-2 text-xs font-medium text-slate-500">Customer</th>
                            <th className="px-3 py-2 text-xs font-medium text-slate-500">Summary</th>
                            <th className="px-3 py-2 text-xs font-medium text-slate-500">Category</th>
                            <th className="px-3 py-2 text-xs font-medium text-slate-500">Urgency</th>
                            <th className="px-3 py-2 text-xs font-medium text-slate-500">Sentiment</th>
                            <th className="px-3 py-2 text-xs font-medium text-slate-500">Status</th>
                            <th className="px-3 py-2 text-xs font-medium text-slate-500">Owner</th>
                            <th className="px-3 py-2 text-xs font-medium text-slate-500">Due</th>
                            <th className="px-3 py-2 text-xs font-medium text-slate-500">Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        {calls.map((call) => (
                            <tr
                                key={call.id}
                                className={`border-b hover:bg-slate-50 cursor-pointer transition-colors ${
                                    isOverdue(call) ? 'bg-red-50/50' : ''
                                }`}
                                onClick={() => onSelectCall(call)}
                            >
                                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                    <input
                                        type="checkbox"
                                        className="rounded"
                                        checked={selectedIds.has(call.id)}
                                        onChange={() => onToggleSelect(call.id)}
                                    />
                                </td>
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-1.5">
                                        <User className="h-3 w-3 text-slate-400 shrink-0" />
                                        <div>
                                            <p className="font-medium text-slate-800 text-xs">
                                                {call.customer_name || 'Unknown'}
                                            </p>
                                            <p className="text-xs text-slate-500 flex items-center gap-1">
                                                <Phone className="h-2.5 w-2.5" />
                                                {call.customer_phone || 'N/A'}
                                            </p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-3 py-2 max-w-[200px]">
                                    <p className="text-xs text-slate-600 truncate">
                                        {call.summary || 'No summary'}
                                    </p>
                                </td>
                                <td className="px-3 py-2">
                                    <CategoryBadge category={call.category} />
                                </td>
                                <td className="px-3 py-2">
                                    <UrgencyBadge urgency={call.urgency} />
                                </td>
                                <td className="px-3 py-2">
                                    <SentimentBadge sentiment={call.sentiment} />
                                </td>
                                <td className="px-3 py-2">
                                    <CallbackStatusBadge status={call.callback_status} />
                                </td>
                                <td className="px-3 py-2">
                                    <span className="text-xs text-slate-600">{call.owner || '—'}</span>
                                </td>
                                <td className="px-3 py-2">
                                    {call.due_by ? (
                                        <span className={`text-xs flex items-center gap-1 ${isOverdue(call) ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                                            <Clock className="h-3 w-3" />
                                            {new Date(call.due_by).toLocaleString(undefined, {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: 'numeric',
                                                minute: '2-digit',
                                            })}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-slate-400">—</span>
                                    )}
                                </td>
                                <td className="px-3 py-2">
                                    <span className="text-xs text-slate-500">
                                        {new Date(call.created_at).toLocaleDateString()}
                                    </span>
                                </td>
                            </tr>
                        ))}
                        {calls.length === 0 && (
                            <tr>
                                <td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-500">
                                    No calls found matching your filters.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-3 py-2 border-t">
                    <span className="text-xs text-slate-500">
                        {pagination.total} calls total | Page {pagination.page} of {pagination.totalPages}
                    </span>
                    <div className="flex gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={pagination.page <= 1}
                            onClick={() => onPageChange(pagination.page - 1)}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={pagination.page >= pagination.totalPages}
                            onClick={() => onPageChange(pagination.page + 1)}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
