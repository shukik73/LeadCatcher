"use client";

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Loader2, RefreshCw, Users, TrendingUp, AlertTriangle,
    Phone, CheckCircle, XCircle, Clock, GraduationCap
} from 'lucide-react';
import { toast } from 'sonner';

interface OwnerStats {
    owner: string;
    total_calls: number;
    calls_booked: number;
    calls_lost: number;
    calls_pending: number;
    booked_rate: number;
    avg_response_minutes: number | null;
    coaching_notes: string[];
}

interface CoachingSummary {
    period_start: string;
    period_end: string;
    total_calls: number;
    by_owner: OwnerStats[];
    top_coaching_notes: string[];
    common_patterns: { pattern: string; count: number }[];
    high_urgency_count: number;
    overdue_count: number;
}

export default function CoachingPage() {
    const [summary, setSummary] = useState<CoachingSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState('week');

    const fetchSummary = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/coaching/summary?period=${period}`);
            const data = await res.json();
            if (data.success) {
                setSummary(data.summary);
            } else {
                toast.error(data.error || 'Failed to load coaching data');
            }
        } catch {
            toast.error('Failed to load coaching data');
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => {
        fetchSummary();
    }, [fetchSummary]);

    return (
        <div className="p-4 md:p-6 space-y-6 max-w-5xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <GraduationCap className="h-5 w-5" />
                        Coaching Dashboard
                    </h1>
                    <p className="text-sm text-slate-500">
                        Review staff performance and coaching opportunities
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={period} onValueChange={setPeriod}>
                        <SelectTrigger className="w-[120px] h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="day">Today</SelectItem>
                            <SelectItem value="week">This Week</SelectItem>
                            <SelectItem value="month">This Month</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={fetchSummary} disabled={loading}>
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {loading && !summary ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
            ) : summary ? (
                <>
                    {/* Overview Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <StatCard
                            icon={<Phone className="h-4 w-4 text-blue-500" />}
                            label="Total Calls"
                            value={summary.total_calls}
                        />
                        <StatCard
                            icon={<Users className="h-4 w-4 text-indigo-500" />}
                            label="Staff Active"
                            value={summary.by_owner.length}
                        />
                        <StatCard
                            icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
                            label="High Urgency"
                            value={summary.high_urgency_count}
                        />
                        <StatCard
                            icon={<Clock className="h-4 w-4 text-orange-500" />}
                            label="Overdue"
                            value={summary.overdue_count}
                            highlight={summary.overdue_count > 0}
                        />
                    </div>

                    {/* Staff Performance */}
                    {summary.by_owner.length > 0 && (
                        <div>
                            <h2 className="text-sm font-semibold text-slate-700 mb-3">Staff Performance</h2>
                            <div className="grid gap-3 md:grid-cols-2">
                                {summary.by_owner.map((owner) => (
                                    <Card key={owner.owner}>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm flex items-center justify-between">
                                                <span className="flex items-center gap-2">
                                                    <Users className="h-4 w-4 text-slate-400" />
                                                    {owner.owner}
                                                </span>
                                                <Badge variant="outline" className="text-xs">
                                                    {owner.total_calls} calls
                                                </Badge>
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            {/* Metrics row */}
                                            <div className="grid grid-cols-3 gap-2 text-center">
                                                <div>
                                                    <p className="text-lg font-bold text-green-600">{owner.booked_rate}%</p>
                                                    <p className="text-xs text-slate-500">Booked</p>
                                                </div>
                                                <div>
                                                    <p className="text-lg font-bold text-slate-700">
                                                        <span className="text-green-600">{owner.calls_booked}</span>
                                                        <span className="text-slate-400 mx-1">/</span>
                                                        <span className="text-red-500">{owner.calls_lost}</span>
                                                    </p>
                                                    <p className="text-xs text-slate-500">Won / Lost</p>
                                                </div>
                                                <div>
                                                    <p className="text-lg font-bold text-slate-700">
                                                        {owner.avg_response_minutes != null
                                                            ? owner.avg_response_minutes < 60
                                                                ? `${owner.avg_response_minutes}m`
                                                                : `${Math.round(owner.avg_response_minutes / 60)}h`
                                                            : '—'}
                                                    </p>
                                                    <p className="text-xs text-slate-500">Avg Response</p>
                                                </div>
                                            </div>

                                            {/* Coaching notes for this owner */}
                                            {owner.coaching_notes.length > 0 && (
                                                <div className="border-t pt-2">
                                                    <p className="text-xs font-medium text-amber-700 mb-1">Coaching Notes:</p>
                                                    <ul className="space-y-1">
                                                        {owner.coaching_notes.map((note, i) => (
                                                            <li key={i} className="text-xs text-slate-600 pl-2 border-l-2 border-amber-200">
                                                                {note}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Common Patterns */}
                    {summary.common_patterns.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <TrendingUp className="h-4 w-4" />
                                    Common Coaching Patterns
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Recurring themes from AI call analysis
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-wrap gap-2">
                                    {summary.common_patterns.map((p) => (
                                        <Badge
                                            key={p.pattern}
                                            variant="outline"
                                            className="text-xs bg-amber-50 text-amber-800 border-amber-200"
                                        >
                                            {p.pattern} ({p.count})
                                        </Badge>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Top Coaching Notes */}
                    {summary.top_coaching_notes.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm">Top Coaching Notes</CardTitle>
                                <CardDescription className="text-xs">
                                    AI-generated improvement suggestions from call reviews
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ol className="space-y-2">
                                    {summary.top_coaching_notes.map((note, i) => (
                                        <li key={i} className="flex gap-2 text-sm">
                                            <span className="text-amber-600 font-bold shrink-0">{i + 1}.</span>
                                            <span className="text-slate-700">{note}</span>
                                        </li>
                                    ))}
                                </ol>
                            </CardContent>
                        </Card>
                    )}

                    {summary.total_calls === 0 && (
                        <div className="text-center py-12 text-slate-500">
                            <GraduationCap className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                            <p className="text-sm">No call data for this period.</p>
                            <p className="text-xs mt-1">Calls analyzed via the system will appear here with coaching insights.</p>
                        </div>
                    )}
                </>
            ) : null}
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
    highlight = false,
}: {
    icon: React.ReactNode;
    label: string;
    value: number;
    highlight?: boolean;
}) {
    return (
        <Card className={highlight ? 'border-red-200 bg-red-50/30' : ''}>
            <CardContent className="py-3 flex items-center gap-3">
                {icon}
                <div>
                    <p className={`text-lg font-bold ${highlight ? 'text-red-600' : 'text-slate-800'}`}>{value}</p>
                    <p className="text-xs text-slate-500">{label}</p>
                </div>
            </CardContent>
        </Card>
    );
}
