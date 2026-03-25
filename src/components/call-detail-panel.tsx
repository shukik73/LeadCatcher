"use client";

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UrgencyBadge, SentimentBadge, CategoryBadge, CallbackStatusBadge } from '@/components/urgency-badge';
import { AudioPlayer } from '@/components/audio-player';
import { RepairDeskTicketCard } from '@/components/repairdesk-ticket-card';
import { Phone, User, Clock, MessageSquare, CheckCircle, XCircle, PhoneCall, UserPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export interface CallAnalysis {
    id: string;
    source_call_id: string;
    customer_name: string | null;
    customer_phone: string | null;
    call_status: string;
    call_duration: number | null;
    recording_url: string | null;
    transcript: string | null;
    summary: string | null;
    sentiment: string | null;
    category: string | null;
    urgency: string | null;
    follow_up_needed: boolean;
    follow_up_notes: string | null;
    callback_status: string;
    owner: string | null;
    due_by: string | null;
    coaching_note: string | null;
    booked_value: number | null;
    last_contacted_at: string | null;
    contact_attempts: number;
    internal_notes: string | null;
    rd_ticket_id: string | null;
    rd_ticket_status: string | null;
    rd_synced_at: string | null;
    outcome_notes: string | null;
    created_at: string;
}

interface CallDetailPanelProps {
    call: CallAnalysis | null;
    open: boolean;
    onClose: () => void;
    onUpdated: () => void;
}

export function CallDetailPanel({ call, open, onClose, onUpdated }: CallDetailPanelProps) {
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [noteText, setNoteText] = useState('');
    const [ownerInput, setOwnerInput] = useState('');
    const [outcomeNotes, setOutcomeNotes] = useState('');
    const [bookedValue, setBookedValue] = useState('');

    if (!call) return null;

    const callAction = async (url: string, body?: Record<string, unknown>, actionName?: string) => {
        const name = actionName || 'action';
        setActionLoading(name);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined,
            });
            const data = await res.json();
            if (data.success || res.ok) {
                toast.success(`${name} completed`);
                onUpdated();
            } else {
                toast.error(data.error || `Failed to ${name}`);
            }
        } catch {
            toast.error(`Failed to ${name}`);
        } finally {
            setActionLoading(null);
        }
    };

    const isOverdue = call.due_by && new Date(call.due_by) < new Date() && call.callback_status === 'pending';

    return (
        <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
            <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        {call.customer_name || 'Unknown Caller'}
                    </SheetTitle>
                    <SheetDescription className="flex items-center gap-2">
                        <Phone className="h-3 w-3" />
                        {call.customer_phone || 'No phone'}
                        <span className="text-slate-400">|</span>
                        {new Date(call.created_at).toLocaleString()}
                    </SheetDescription>
                </SheetHeader>

                <div className="space-y-4 px-4 pb-4">
                    {/* Badges */}
                    <div className="flex flex-wrap gap-2">
                        <CategoryBadge category={call.category} />
                        <UrgencyBadge urgency={call.urgency} />
                        <SentimentBadge sentiment={call.sentiment} />
                        <CallbackStatusBadge status={call.callback_status} />
                        {isOverdue && (
                            <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                                <Clock className="h-3 w-3" /> OVERDUE
                            </span>
                        )}
                    </div>

                    {/* Summary */}
                    {call.summary && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Summary</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-slate-700">{call.summary}</p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Recording */}
                    {call.recording_url && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Recording</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <AudioPlayer src={call.recording_url} />
                            </CardContent>
                        </Card>
                    )}

                    {/* Transcript */}
                    {call.transcript && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Transcript</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-slate-600 whitespace-pre-wrap max-h-48 overflow-y-auto">
                                    {call.transcript}
                                </p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Follow-up Notes */}
                    {call.follow_up_notes && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-1">
                                    <MessageSquare className="h-3 w-3" />
                                    Suggested Callback Script
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-slate-700 italic">{call.follow_up_notes}</p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Coaching Note */}
                    {call.coaching_note && (
                        <Card className="border-amber-200 bg-amber-50/50">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm text-amber-800">Coaching Note</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-amber-700">{call.coaching_note}</p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Contact History */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm">Contact History</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-slate-600 space-y-1">
                            <p>Attempts: {call.contact_attempts}</p>
                            {call.last_contacted_at && (
                                <p>Last contact: {new Date(call.last_contacted_at).toLocaleString()}</p>
                            )}
                            {call.owner && <p>Owner: {call.owner}</p>}
                            {call.due_by && <p>Due by: {new Date(call.due_by).toLocaleString()}</p>}
                            {call.booked_value != null && <p>Booked value: ${call.booked_value}</p>}
                        </CardContent>
                    </Card>

                    {/* Internal Notes */}
                    {call.internal_notes && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Internal Notes</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <pre className="text-xs text-slate-600 whitespace-pre-wrap max-h-32 overflow-y-auto">
                                    {call.internal_notes}
                                </pre>
                            </CardContent>
                        </Card>
                    )}

                    {/* RepairDesk */}
                    <RepairDeskTicketCard
                        callId={call.id}
                        customerPhone={call.customer_phone}
                        rdTicketId={call.rd_ticket_id}
                        rdTicketStatus={call.rd_ticket_status}
                        rdSyncedAt={call.rd_synced_at}
                        onSynced={onUpdated}
                    />

                    {/* Quick Actions */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm">Actions</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {/* Log Contact */}
                            <Button
                                size="sm"
                                variant="outline"
                                className="w-full justify-start"
                                disabled={actionLoading !== null}
                                onClick={() => callAction(`/api/calls/${call.id}/log-contact`, undefined, 'Log contact')}
                            >
                                {actionLoading === 'Log contact' ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <PhoneCall className="h-3 w-3 mr-2" />}
                                Log Contact Attempt
                            </Button>

                            {/* Assign Owner */}
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Owner name"
                                    value={ownerInput}
                                    onChange={(e) => setOwnerInput(e.target.value)}
                                    className="h-8 text-xs flex-1"
                                />
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!ownerInput.trim() || actionLoading !== null}
                                    onClick={() => {
                                        callAction(`/api/calls/${call.id}/assign-owner`, { owner: ownerInput.trim() }, 'Assign owner');
                                        setOwnerInput('');
                                    }}
                                >
                                    <UserPlus className="h-3 w-3 mr-1" />
                                    Assign
                                </Button>
                            </div>

                            {/* Add Note */}
                            <div className="space-y-1">
                                <Textarea
                                    placeholder="Add internal note..."
                                    value={noteText}
                                    onChange={(e) => setNoteText(e.target.value)}
                                    className="text-xs min-h-[60px]"
                                />
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!noteText.trim() || actionLoading !== null}
                                    onClick={() => {
                                        callAction(`/api/calls/${call.id}/add-note`, { note: noteText.trim() }, 'Add note');
                                        setNoteText('');
                                    }}
                                >
                                    {actionLoading === 'Add note' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                                    Add Note
                                </Button>
                            </div>

                            {/* Log Outcome */}
                            <div className="border-t pt-3 space-y-2">
                                <p className="text-xs font-medium text-slate-500">Log Outcome</p>
                                <Textarea
                                    placeholder="Outcome notes (optional)..."
                                    value={outcomeNotes}
                                    onChange={(e) => setOutcomeNotes(e.target.value)}
                                    className="text-xs min-h-[40px]"
                                />
                                <Input
                                    type="number"
                                    placeholder="Booked value ($)"
                                    value={bookedValue}
                                    onChange={(e) => setBookedValue(e.target.value)}
                                    className="h-8 text-xs"
                                />
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="default"
                                        className="flex-1"
                                        disabled={actionLoading !== null}
                                        onClick={() => {
                                            callAction(`/api/calls/${call.id}/log-outcome`, {
                                                outcome: 'booked',
                                                notes: outcomeNotes || undefined,
                                                booked_value: bookedValue ? parseFloat(bookedValue) : undefined,
                                            }, 'Mark booked');
                                            setOutcomeNotes('');
                                            setBookedValue('');
                                        }}
                                    >
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Booked
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        className="flex-1"
                                        disabled={actionLoading !== null}
                                        onClick={() => {
                                            callAction(`/api/calls/${call.id}/log-outcome`, {
                                                outcome: 'lost',
                                                notes: outcomeNotes || undefined,
                                            }, 'Mark lost');
                                            setOutcomeNotes('');
                                        }}
                                    >
                                        <XCircle className="h-3 w-3 mr-1" />
                                        Lost
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </SheetContent>
        </Sheet>
    );
}
