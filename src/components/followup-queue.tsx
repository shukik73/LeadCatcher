"use client";

import { UrgencyBadge, CategoryBadge, CallbackStatusBadge } from '@/components/urgency-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Phone, User, Clock, PhoneCall, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

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
    contact_attempts?: number;
    created_at: string;
}

interface FollowUpQueueProps {
    followups: FollowUp[];
    onUpdated: () => void;
    onSelectCall: (id: string) => void;
}

export function FollowUpQueue({ followups, onUpdated, onSelectCall }: FollowUpQueueProps) {
    const [loadingAction, setLoadingAction] = useState<string | null>(null);

    const quickAction = async (callId: string, endpoint: string, body?: Record<string, unknown>, label?: string) => {
        const key = `${callId}-${label}`;
        setLoadingAction(key);
        try {
            const res = await fetch(`/api/calls/${callId}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined,
            });
            const data = await res.json();
            if (data.success || res.ok) {
                toast.success(`${label || 'Action'} completed`);
                onUpdated();
            } else {
                toast.error(data.error || 'Action failed');
            }
        } catch {
            toast.error('Action failed');
        } finally {
            setLoadingAction(null);
        }
    };

    if (followups.length === 0) {
        return (
            <div className="text-center py-12 text-slate-500">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-400" />
                <p className="text-sm">All caught up! No pending follow-ups.</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {followups.map((fu) => {
                const isOverdue = fu.due_by && new Date(fu.due_by) < new Date();
                return (
                    <Card
                        key={fu.id}
                        className={`cursor-pointer transition-colors hover:border-blue-200 ${isOverdue ? 'border-red-200 bg-red-50/30' : ''}`}
                        onClick={() => onSelectCall(fu.id)}
                    >
                        <CardContent className="py-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <User className="h-3 w-3 text-slate-400" />
                                        <span className="font-medium text-sm text-slate-800">
                                            {fu.customer_name || 'Unknown'}
                                        </span>
                                        <span className="text-xs text-slate-500 flex items-center gap-1">
                                            <Phone className="h-2.5 w-2.5" />
                                            {fu.customer_phone || 'N/A'}
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                        <CategoryBadge category={fu.category} />
                                        <UrgencyBadge urgency={fu.urgency} />
                                        <CallbackStatusBadge status={fu.callback_status} />
                                        {fu.owner && (
                                            <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                {fu.owner}
                                            </span>
                                        )}
                                    </div>

                                    <p className="text-xs text-slate-600 truncate">{fu.summary || 'No summary'}</p>

                                    {fu.follow_up_notes && (
                                        <p className="text-xs text-blue-600 mt-1 italic truncate">
                                            Script: {fu.follow_up_notes}
                                        </p>
                                    )}

                                    {fu.due_by && (
                                        <p className={`text-xs mt-1 flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                                            <Clock className="h-3 w-3" />
                                            Due: {new Date(fu.due_by).toLocaleString(undefined, {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: 'numeric',
                                                minute: '2-digit',
                                            })}
                                            {isOverdue && ' (OVERDUE)'}
                                        </p>
                                    )}
                                </div>

                                <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        disabled={loadingAction !== null}
                                        onClick={() => quickAction(fu.id, 'log-contact', undefined, 'Called')}
                                    >
                                        {loadingAction === `${fu.id}-Called` ? <Loader2 className="h-3 w-3 animate-spin" /> : <PhoneCall className="h-3 w-3 mr-1" />}
                                        Called
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="default"
                                        className="h-7 text-xs"
                                        disabled={loadingAction !== null}
                                        onClick={() => quickAction(fu.id, 'log-outcome', { outcome: 'booked' }, 'Booked')}
                                    >
                                        {loadingAction === `${fu.id}-Booked` ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                                        Booked
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-7 text-xs"
                                        disabled={loadingAction !== null}
                                        onClick={() => quickAction(fu.id, 'log-outcome', { outcome: 'lost' }, 'Lost')}
                                    >
                                        {loadingAction === `${fu.id}-Lost` ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3 mr-1" />}
                                        Lost
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
