"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface RepairDeskTicket {
    id: number;
    ticket_id: string;
    status: string;
    device: string;
    issue: string;
    total: number;
    created_at: string;
    updated_at: string;
}

interface RepairDeskTicketCardProps {
    callId: string;
    customerPhone: string | null;
    rdTicketId: string | null;
    rdTicketStatus: string | null;
    rdSyncedAt: string | null;
    autoLookup?: boolean;
    onSynced?: () => void;
}

export function RepairDeskTicketCard({
    callId,
    customerPhone,
    rdTicketId,
    rdTicketStatus,
    rdSyncedAt,
    autoLookup = false,
    onSynced,
}: RepairDeskTicketCardProps) {
    const [tickets, setTickets] = useState<RepairDeskTicket[]>([]);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [looked, setLooked] = useState(false);

    // Auto-lookup tickets for status_check calls
    useEffect(() => {
        if (autoLookup && customerPhone && !looked && !rdTicketId) {
            lookupTickets();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoLookup, customerPhone]);

    const lookupTickets = async () => {
        if (!customerPhone) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/repairdesk/lookup-ticket?phone=${encodeURIComponent(customerPhone)}`);
            const data = await res.json();
            if (data.success) {
                setTickets(data.tickets || []);
                setLooked(true);
            } else {
                toast.error(data.error || 'Failed to lookup tickets');
            }
        } catch {
            toast.error('Failed to lookup tickets');
        } finally {
            setLoading(false);
        }
    };

    const syncToRepairDesk = async () => {
        setSyncing(true);
        try {
            const res = await fetch('/api/repairdesk/sync-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ call_id: callId }),
            });
            const data = await res.json();
            if (data.success) {
                toast.success(data.ticket_found ? 'Synced to RepairDesk ticket' : 'Synced (no ticket found)');
                onSynced?.();
            } else {
                toast.error(data.error || 'Failed to sync');
            }
        } catch {
            toast.error('Failed to sync to RepairDesk');
        } finally {
            setSyncing(false);
        }
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                    <ExternalLink className="h-4 w-4" />
                    RepairDesk
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {rdTicketId && (
                    <div className="text-sm">
                        <span className="text-slate-500">Ticket:</span>{' '}
                        <span className="font-mono">#{rdTicketId}</span>
                        {rdTicketStatus && (
                            <Badge variant="outline" className="ml-2">{rdTicketStatus}</Badge>
                        )}
                    </div>
                )}

                {rdSyncedAt && (
                    <p className="text-xs text-slate-500">
                        Last synced: {new Date(rdSyncedAt).toLocaleString()}
                    </p>
                )}

                <div className="flex gap-2 flex-wrap">
                    {customerPhone && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={lookupTickets}
                            disabled={loading}
                        >
                            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                            Lookup Tickets
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={syncToRepairDesk}
                        disabled={syncing}
                    >
                        {syncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ExternalLink className="h-3 w-3 mr-1" />}
                        {rdSyncedAt ? 'Re-sync' : 'Sync to RepairDesk'}
                    </Button>
                </div>

                {looked && tickets.length === 0 && (
                    <p className="text-xs text-slate-500">No tickets found for this customer.</p>
                )}

                {tickets.length > 0 && (
                    <div className="space-y-2">
                        {tickets.map((t) => (
                            <div key={t.id} className="border rounded-lg p-2 text-sm">
                                <div className="flex justify-between items-center">
                                    <span className="font-mono text-xs">#{t.ticket_id}</span>
                                    <Badge variant="outline">{t.status}</Badge>
                                </div>
                                <p className="text-slate-600 mt-1">{t.device} — {t.issue}</p>
                                {t.total > 0 && <p className="text-xs text-slate-500">${t.total.toFixed(2)}</p>}
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
