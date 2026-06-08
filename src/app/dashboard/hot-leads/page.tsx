"use client";

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { UrgencyBadge, CallbackStatusBadge } from '@/components/urgency-badge';
import {
    Flame, RefreshCw, Loader2, Phone, User, Clock, PhoneCall,
    CheckCircle, XCircle, PhoneOff, StickyNote, AlertTriangle, Ticket,
} from 'lucide-react';
import { toast } from 'sonner';

interface HotLead {
    id: string;
    customerName: string | null;
    customerPhone: string | null;
    urgency: string | null;
    callStatus: string | null;
    callbackStatus: string | null;
    dueBy: string | null;
    summary: string | null;
    followUpNotes: string | null;
    coachingNote: string | null;
    sourceCallId: string | null;
    rdTicketId: string | null;
    createdAt: string;
    updatedAt: string;
}

interface HotLeadsSummary {
    total: number;
    dueNow: number;
    highUrgency: number;
    bookedToday: number | null;
}

function SummaryCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
    return (
        <Card>
            <CardContent className="py-4">
                <p className="text-xs font-medium text-slate-500">{label}</p>
                <p className={`text-2xl font-bold mt-1 ${accent ?? 'text-slate-800'}`}>{value}</p>
            </CardContent>
        </Card>
    );
}

export default function HotLeadsPage() {
    const [leads, setLeads] = useState<HotLead[]>([]);
    const [summary, setSummary] = useState<HotLeadsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null);
    const [noteText, setNoteText] = useState('');
    const [savingNote, setSavingNote] = useState(false);

    const fetchLeads = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/hot-leads');
            const data = await res.json();
            if (res.ok && data.success) {
                setLeads(data.leads || []);
                setSummary(data.summary || null);
            } else {
                setError(data.error || 'Failed to load hot leads');
            }
        } catch {
            setError('Failed to load hot leads');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLeads();
    }, [fetchLeads]);

    const quickAction = async (
        leadId: string,
        endpoint: string,
        label: string,
        body?: Record<string, unknown>,
    ) => {
        const key = `${leadId}-${label}`;
        setLoadingAction(key);
        try {
            const res = await fetch(`/api/calls/${leadId}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined,
            });
            const data = await res.json();
            if (res.ok && (data.success || data.id)) {
                toast.success(`${label} — done`);
                fetchLeads();
            } else {
                toast.error(data.error || `${label} failed`);
            }
        } catch {
            toast.error(`${label} failed`);
        } finally {
            setLoadingAction(null);
        }
    };

    const saveNote = async (leadId: string) => {
        if (!noteText.trim()) return;
        setSavingNote(true);
        try {
            const res = await fetch(`/api/calls/${leadId}/add-note`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: noteText.trim() }),
            });
            const data = await res.json();
            if (res.ok && (data.success || data.id)) {
                toast.success('Note added');
                setNoteOpenFor(null);
                setNoteText('');
            } else {
                toast.error(data.error || 'Failed to add note');
            }
        } catch {
            toast.error('Failed to add note');
        } finally {
            setSavingNote(false);
        }
    };

    const Header = (
        <div className="flex items-start justify-between gap-3">
            <div>
                <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Flame className="h-5 w-5 text-orange-500" />
                    Hot Lead Recovery
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                    Missed calls and callbacks that can still turn into revenue.
                </p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchLeads} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
        </div>
    );

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-4xl">
            {Header}

            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <SummaryCard label="Hot leads" value={summary?.total ?? '—'} />
                <SummaryCard
                    label="Due now"
                    value={summary?.dueNow ?? '—'}
                    accent={summary && summary.dueNow > 0 ? 'text-red-600' : undefined}
                />
                <SummaryCard
                    label="High urgency"
                    value={summary?.highUrgency ?? '—'}
                    accent={summary && summary.highUrgency > 0 ? 'text-orange-600' : undefined}
                />
                <SummaryCard
                    label="Booked today"
                    value={summary?.bookedToday ?? '—'}
                    accent={summary && summary.bookedToday ? 'text-green-600' : undefined}
                />
            </div>

            {/* Loading state */}
            {loading && leads.length === 0 && !error && (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
            )}

            {/* Error state */}
            {error && (
                <div className="text-center py-16 text-slate-500">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-red-400" />
                    <p className="text-sm">{error}</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={fetchLeads}>
                        <RefreshCw className="h-4 w-4 mr-1" /> Retry
                    </Button>
                </div>
            )}

            {/* Empty state */}
            {!loading && !error && leads.length === 0 && (
                <div className="text-center py-16 text-slate-500">
                    <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-400" />
                    <p className="text-sm font-medium text-slate-700">No hot leads right now.</p>
                    <p className="text-xs mt-1">
                        When missed calls, callbacks, or AI action items need attention, they will appear here.
                    </p>
                </div>
            )}

            {/* Lead queue */}
            {!error && leads.length > 0 && (
                <div className="space-y-3">
                    {leads.map((lead) => {
                        const isOverdue = lead.dueBy && new Date(lead.dueBy) < new Date();
                        const busy = loadingAction !== null;
                        return (
                            <Card
                                key={lead.id}
                                className={isOverdue ? 'border-red-200 bg-red-50/30' : undefined}
                            >
                                <CardContent className="py-3 space-y-2">
                                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                <span className="font-medium text-sm text-slate-800">
                                                    {lead.customerName || 'Unknown customer'}
                                                </span>
                                                <span className="text-xs text-slate-500 flex items-center gap-1">
                                                    <Phone className="h-2.5 w-2.5" />
                                                    {lead.customerPhone || 'N/A'}
                                                </span>
                                            </div>

                                            <div className="flex flex-wrap gap-1.5 mb-2">
                                                <UrgencyBadge urgency={lead.urgency} />
                                                <CallbackStatusBadge status={lead.callbackStatus} />
                                                {lead.callStatus && (
                                                    <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded capitalize">
                                                        {lead.callStatus}
                                                    </span>
                                                )}
                                                {lead.rdTicketId && (
                                                    <span className="text-xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                                        <Ticket className="h-2.5 w-2.5" />
                                                        #{lead.rdTicketId}
                                                    </span>
                                                )}
                                            </div>

                                            <p className="text-xs text-slate-600">{lead.summary || 'No summary'}</p>

                                            {lead.followUpNotes && (
                                                <p className="text-xs text-blue-600 mt-1 italic">
                                                    Script: {lead.followUpNotes}
                                                </p>
                                            )}
                                            {lead.coachingNote && (
                                                <p className="text-xs text-purple-600 mt-1 italic">
                                                    Coaching: {lead.coachingNote}
                                                </p>
                                            )}

                                            {lead.dueBy && (
                                                <p className={`text-xs mt-1 flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                                                    <Clock className="h-3 w-3" />
                                                    Due: {new Date(lead.dueBy).toLocaleString(undefined, {
                                                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                                                    })}
                                                    {isOverdue && ' (OVERDUE)'}
                                                </p>
                                            )}
                                            {lead.sourceCallId && (
                                                <p className="text-[11px] text-slate-400 mt-1 truncate">
                                                    Call ID: {lead.sourceCallId}
                                                </p>
                                            )}
                                        </div>

                                        {/* Quick actions */}
                                        <div className="flex flex-wrap sm:flex-col gap-1 shrink-0">
                                            <Button
                                                size="sm" variant="outline" className="h-7 text-xs"
                                                disabled={busy}
                                                onClick={() => quickAction(lead.id, 'mark-called', 'Marked called')}
                                            >
                                                {loadingAction === `${lead.id}-Marked called`
                                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                                    : <PhoneCall className="h-3 w-3 mr-1" />}
                                                Called
                                            </Button>
                                            <Button
                                                size="sm" variant="default" className="h-7 text-xs"
                                                disabled={busy}
                                                onClick={() => quickAction(lead.id, 'mark-booked', 'Marked booked')}
                                            >
                                                {loadingAction === `${lead.id}-Marked booked`
                                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                                    : <CheckCircle className="h-3 w-3 mr-1" />}
                                                Booked
                                            </Button>
                                            <Button
                                                size="sm" variant="outline" className="h-7 text-xs"
                                                disabled={busy}
                                                onClick={() => quickAction(lead.id, 'log-outcome', 'No answer logged', { outcome: 'no_answer' })}
                                            >
                                                {loadingAction === `${lead.id}-No answer logged`
                                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                                    : <PhoneOff className="h-3 w-3 mr-1" />}
                                                No Answer
                                            </Button>
                                            <Button
                                                size="sm" variant="destructive" className="h-7 text-xs"
                                                disabled={busy}
                                                onClick={() => quickAction(lead.id, 'mark-lost', 'Marked lost')}
                                            >
                                                {loadingAction === `${lead.id}-Marked lost`
                                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                                    : <XCircle className="h-3 w-3 mr-1" />}
                                                Lost
                                            </Button>
                                            <Button
                                                size="sm" variant="ghost" className="h-7 text-xs"
                                                disabled={busy}
                                                onClick={() => {
                                                    setNoteOpenFor(noteOpenFor === lead.id ? null : lead.id);
                                                    setNoteText('');
                                                }}
                                            >
                                                <StickyNote className="h-3 w-3 mr-1" />
                                                Note
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Inline add-note */}
                                    {noteOpenFor === lead.id && (
                                        <div className="pt-2 border-t border-slate-100 space-y-2">
                                            <Textarea
                                                value={noteText}
                                                onChange={(e) => setNoteText(e.target.value)}
                                                placeholder="Add an internal note for this lead…"
                                                className="text-xs min-h-[60px]"
                                            />
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm" className="h-7 text-xs"
                                                    disabled={savingNote || !noteText.trim()}
                                                    onClick={() => saveNote(lead.id)}
                                                >
                                                    {savingNote ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                                    Save note
                                                </Button>
                                                <Button
                                                    size="sm" variant="ghost" className="h-7 text-xs"
                                                    onClick={() => { setNoteOpenFor(null); setNoteText(''); }}
                                                >
                                                    Cancel
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
