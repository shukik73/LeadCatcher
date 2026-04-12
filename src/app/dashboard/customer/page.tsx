"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
    Loader2, Phone, User, MessageSquare, PhoneCall,
    ArrowDownLeft, ArrowUpRight, ListTodo, Search,
    CheckCircle, Clock, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

interface TimelineEvent {
    type: 'call' | 'message' | 'action';
    timestamp: string;
    data: Record<string, unknown>;
}

interface TimelineData {
    phone: string;
    customer_name: string | null;
    timeline: TimelineEvent[];
    stats: { total_calls: number; total_messages: number; pending_actions: number };
}

export default function CustomerPage() {
    const searchParams = useSearchParams();
    const [phone, setPhone] = useState(searchParams.get('phone') || '');
    const [searchInput, setSearchInput] = useState(searchParams.get('phone') || '');
    const [data, setData] = useState<TimelineData | null>(null);
    const [loading, setLoading] = useState(false);

    const fetchTimeline = useCallback(async (phoneNumber: string) => {
        if (!phoneNumber.trim()) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/customer/timeline?phone=${encodeURIComponent(phoneNumber)}`);
            const json = await res.json();
            if (json.success) {
                setData(json);
                setPhone(phoneNumber);
            } else {
                toast.error(json.error || 'Failed to load');
            }
        } catch {
            toast.error('Failed to load customer data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const p = searchParams.get('phone');
        if (p) fetchTimeline(p);
    }, [searchParams, fetchTimeline]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (searchInput.trim()) fetchTimeline(searchInput.trim());
    };

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-[900px]">
            <div className="flex items-center gap-2">
                <User className="h-5 w-5 text-blue-600" />
                <h1 className="text-xl font-bold text-slate-800">Customer Timeline</h1>
            </div>

            {/* Search bar */}
            <form onSubmit={handleSearch} className="flex gap-2">
                <Input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Enter phone number (e.g. +15551234567)"
                    className="flex-1"
                />
                <Button type="submit" disabled={loading || !searchInput.trim()}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
            </form>

            {/* Customer header */}
            {data && (
                <>
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                                        <User className="h-5 w-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <h2 className="font-semibold text-slate-800">
                                            {data.customer_name || 'Unknown Customer'}
                                        </h2>
                                        <p className="text-sm text-slate-500 flex items-center gap-1">
                                            <Phone className="h-3 w-3" /> {data.phone}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex gap-4 text-center">
                                    <div>
                                        <p className="text-lg font-bold text-slate-800">{data.stats.total_calls}</p>
                                        <p className="text-xs text-slate-500">Calls</p>
                                    </div>
                                    <div>
                                        <p className="text-lg font-bold text-slate-800">{data.stats.total_messages}</p>
                                        <p className="text-xs text-slate-500">Messages</p>
                                    </div>
                                    <div>
                                        <p className="text-lg font-bold text-slate-800">{data.stats.pending_actions}</p>
                                        <p className="text-xs text-slate-500">Pending</p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Timeline */}
                    <div className="space-y-2">
                        {data.timeline.length === 0 ? (
                            <Card>
                                <CardContent className="py-8 text-center text-sm text-slate-500">
                                    No interactions found for this customer
                                </CardContent>
                            </Card>
                        ) : (
                            data.timeline.map((event, idx) => (
                                <TimelineCard key={`${event.type}-${idx}`} event={event} />
                            ))
                        )}
                    </div>
                </>
            )}

            {!data && !loading && (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Search className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                        <p className="text-sm text-slate-500">Search for a customer by phone number</p>
                        <p className="text-xs text-slate-400 mt-1">See all calls, messages, and actions in one place</p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function TimelineCard({ event }: { event: TimelineEvent }) {
    const time = new Date(event.timestamp).toLocaleString();
    const s = (val: unknown) => val != null ? String(val) : '';

    if (event.type === 'call') {
        const d = event.data;
        const isMissed = d.call_status === 'missed';
        return (
            <Card className={isMissed ? 'border-l-4 border-l-red-400' : 'border-l-4 border-l-green-400'}>
                <CardContent className="py-3 px-4">
                    <div className="flex items-center gap-2 mb-1">
                        <PhoneCall className={`h-4 w-4 ${isMissed ? 'text-red-500' : 'text-green-500'}`} />
                        <span className="text-sm font-medium">
                            {isMissed ? 'Missed Call' : 'Call'} {d.call_duration ? `(${s(d.call_duration)}s)` : ''}
                        </span>
                        {d.urgency != null && (
                            <Badge variant={d.urgency === 'high' ? 'destructive' : 'secondary'} className="text-[10px]">
                                {s(d.urgency)}
                            </Badge>
                        )}
                        {d.category != null && (
                            <Badge variant="outline" className="text-[10px]">
                                {s(d.category).replace(/_/g, ' ')}
                            </Badge>
                        )}
                        {d.ai_quality_total != null && (
                            <Badge variant="outline" className="text-[10px]">
                                {`Quality: ${s(d.ai_quality_total)}%`}
                            </Badge>
                        )}
                        <span className="text-xs text-slate-400 ml-auto">{time}</span>
                    </div>
                    {d.summary != null && <p className="text-xs text-slate-600 mt-1">{s(d.summary)}</p>}
                    {d.coaching_note != null && (
                        <p className="text-xs text-amber-600 mt-1 italic">{s(d.coaching_note)}</p>
                    )}
                </CardContent>
            </Card>
        );
    }

    if (event.type === 'message') {
        const d = event.data;
        const isInbound = d.direction === 'inbound';
        return (
            <Card className={`border-l-4 ${isInbound ? 'border-l-blue-400' : 'border-l-slate-300'}`}>
                <CardContent className="py-3 px-4">
                    <div className="flex items-center gap-2 mb-1">
                        {isInbound ? (
                            <ArrowDownLeft className="h-4 w-4 text-blue-500" />
                        ) : (
                            <ArrowUpRight className="h-4 w-4 text-slate-400" />
                        )}
                        <span className="text-sm font-medium">
                            {isInbound ? 'Customer SMS' : 'Sent SMS'}
                        </span>
                        {d.is_ai_generated === true && (
                            <Badge variant="secondary" className="text-[10px]">AI</Badge>
                        )}
                        <span className="text-xs text-slate-400 ml-auto">{time}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{s(d.body)}</p>
                </CardContent>
            </Card>
        );
    }

    if (event.type === 'action') {
        const d = event.data;
        const isCompleted = d.status === 'completed';
        return (
            <Card className={`border-l-4 ${isCompleted ? 'border-l-green-300' : 'border-l-yellow-400'}`}>
                <CardContent className="py-3 px-4">
                    <div className="flex items-center gap-2 mb-1">
                        {isCompleted ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : d.priority === 'high' ? (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                        ) : (
                            <ListTodo className="h-4 w-4 text-yellow-500" />
                        )}
                        <span className="text-sm font-medium">{s(d.title)}</span>
                        <Badge variant="outline" className="text-[10px]">
                            {s(d.action_type).replace(/_/g, ' ')}
                        </Badge>
                        <span className="text-xs text-slate-400 ml-auto">{time}</span>
                    </div>
                    {d.description != null && <p className="text-xs text-slate-600 mt-1">{s(d.description)}</p>}
                </CardContent>
            </Card>
        );
    }

    return null;
}
