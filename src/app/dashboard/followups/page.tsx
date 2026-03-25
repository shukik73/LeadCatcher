"use client";

import { useState, useEffect, useCallback } from 'react';
import { FollowUpQueue } from '@/components/followup-queue';
import { CallDetailPanel, type CallAnalysis } from '@/components/call-detail-panel';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface FollowUp {
    id: string;
    customer_name: string | null;
    customer_phone: string | null;
    category: string | null;
    urgency: string | null;
    summary: string | null;
    follow_up_notes: string | null;
    callback_status: string;
    coaching_note: string | null;
    owner: string | null;
    due_by: string | null;
    booked_value: number | null;
    created_at: string;
}

export default function FollowUpsPage() {
    const [followups, setFollowups] = useState<FollowUp[]>([]);
    const [loading, setLoading] = useState(true);
    const [urgencyFilter, setUrgencyFilter] = useState('');
    const [selectedCall, setSelectedCall] = useState<CallAnalysis | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    const fetchFollowups = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (urgencyFilter) params.set('urgency', urgencyFilter);
            const res = await fetch(`/api/calls/pending-followups?${params.toString()}`);
            const data = await res.json();
            if (data.success) {
                setFollowups(data.followups || []);
            } else {
                toast.error(data.error || 'Failed to load follow-ups');
            }
        } catch {
            toast.error('Failed to load follow-ups');
        } finally {
            setLoading(false);
        }
    }, [urgencyFilter]);

    useEffect(() => {
        fetchFollowups();
    }, [fetchFollowups]);

    const handleSelectCall = async (callId: string) => {
        try {
            const res = await fetch(`/api/calls/${callId}`);
            const data = await res.json();
            if (data.success) {
                setSelectedCall(data.call);
                setDetailOpen(true);
            }
        } catch {
            toast.error('Failed to load call details');
        }
    };

    const overdueCount = followups.filter(
        (f) => f.due_by && new Date(f.due_by) < new Date()
    ).length;

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-3xl">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Follow-Up Queue</h1>
                    <p className="text-sm text-slate-500">
                        {followups.length} pending follow-up{followups.length !== 1 ? 's' : ''}
                        {overdueCount > 0 && (
                            <span className="text-red-600 ml-2 inline-flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {overdueCount} overdue
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={urgencyFilter || '_all'} onValueChange={(v) => setUrgencyFilter(v === '_all' ? '' : v)}>
                        <SelectTrigger className="w-[120px] h-8 text-xs">
                            <SelectValue placeholder="All urgency" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="_all">All</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchFollowups}
                        disabled={loading}
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
            ) : (
                <FollowUpQueue
                    followups={followups}
                    onUpdated={fetchFollowups}
                    onSelectCall={handleSelectCall}
                />
            )}

            <CallDetailPanel
                call={selectedCall}
                open={detailOpen}
                onClose={() => setDetailOpen(false)}
                onUpdated={() => {
                    fetchFollowups();
                    setDetailOpen(false);
                }}
            />
        </div>
    );
}
