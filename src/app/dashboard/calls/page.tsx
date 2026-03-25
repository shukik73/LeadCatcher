"use client";

import { useState, useEffect, useCallback } from 'react';
import { CallsTable } from '@/components/calls-table';
import { CallFilters, EMPTY_FILTERS, type CallFiltersState } from '@/components/call-filters';
import { CallDetailPanel, type CallAnalysis } from '@/components/call-detail-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, RefreshCw, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

export default function CallsPage() {
    const [calls, setCalls] = useState<CallAnalysis[]>([]);
    const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 0 });
    const [filters, setFilters] = useState<CallFiltersState>(EMPTY_FILTERS);
    const [loading, setLoading] = useState(true);
    const [selectedCall, setSelectedCall] = useState<CallAnalysis | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkOwner, setBulkOwner] = useState('');
    const [bulkAssigning, setBulkAssigning] = useState(false);

    const fetchCalls = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('page', page.toString());
            params.set('limit', '25');
            if (filters.category) params.set('category', filters.category);
            if (filters.urgency) params.set('urgency', filters.urgency);
            if (filters.sentiment) params.set('sentiment', filters.sentiment);
            if (filters.callback_status) params.set('callback_status', filters.callback_status);
            if (filters.owner) params.set('owner', filters.owner);
            if (filters.from) params.set('from', new Date(filters.from).toISOString());
            if (filters.to) params.set('to', new Date(filters.to + 'T23:59:59').toISOString());

            const res = await fetch(`/api/calls/list?${params.toString()}`);
            const data = await res.json();

            if (data.success) {
                setCalls(data.calls);
                setPagination(data.pagination);
            } else {
                toast.error(data.error || 'Failed to load calls');
            }
        } catch {
            toast.error('Failed to load calls');
        } finally {
            setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        fetchCalls(1);
    }, [fetchCalls]);

    const handleSelectCall = (call: CallAnalysis) => {
        setSelectedCall(call);
        setDetailOpen(true);
    };

    const handleToggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleBulkAssign = async () => {
        if (!bulkOwner.trim() || selectedIds.size === 0) return;
        setBulkAssigning(true);
        try {
            const res = await fetch('/api/calls/bulk-assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    call_ids: Array.from(selectedIds),
                    owner: bulkOwner.trim(),
                }),
            });
            const data = await res.json();
            if (data.success || res.ok) {
                toast.success(`Assigned ${data.assigned || selectedIds.size} calls to ${bulkOwner.trim()}`);
                setSelectedIds(new Set());
                setBulkOwner('');
                fetchCalls(pagination.page);
            } else {
                toast.error(data.error || 'Failed to assign');
            }
        } catch {
            toast.error('Failed to bulk assign');
        } finally {
            setBulkAssigning(false);
        }
    };

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-[1400px]">
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold text-slate-800">Call Review</h1>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchCalls(pagination.page)}
                    disabled={loading}
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
            </div>

            <CallFilters filters={filters} onChange={setFilters} />

            {/* Bulk actions */}
            {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2">
                    <span className="text-xs text-blue-700 font-medium">
                        {selectedIds.size} selected
                    </span>
                    <Input
                        placeholder="Owner name"
                        value={bulkOwner}
                        onChange={(e) => setBulkOwner(e.target.value)}
                        className="h-7 text-xs w-[140px]"
                    />
                    <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        disabled={!bulkOwner.trim() || bulkAssigning}
                        onClick={handleBulkAssign}
                    >
                        {bulkAssigning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <UserPlus className="h-3 w-3 mr-1" />}
                        Assign
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setSelectedIds(new Set())}
                    >
                        Clear
                    </Button>
                </div>
            )}

            {loading && calls.length === 0 ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
            ) : (
                <div className="border rounded-lg bg-white">
                    <CallsTable
                        calls={calls}
                        pagination={pagination}
                        onPageChange={(page) => fetchCalls(page)}
                        onSelectCall={handleSelectCall}
                        selectedIds={selectedIds}
                        onToggleSelect={handleToggleSelect}
                    />
                </div>
            )}

            <CallDetailPanel
                call={selectedCall}
                open={detailOpen}
                onClose={() => setDetailOpen(false)}
                onUpdated={() => {
                    fetchCalls(pagination.page);
                    setDetailOpen(false);
                }}
            />
        </div>
    );
}
