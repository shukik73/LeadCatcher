"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { UrgencyBadge, CallbackStatusBadge } from '@/components/urgency-badge';
import {
    Sun, RefreshCw, Loader2, Phone, PhoneCall, User, Clock,
    CheckCircle, AlertTriangle, TrendingUp, PhoneOff, DollarSign,
    CalendarCheck, ArrowRight, Flame, X,
} from 'lucide-react';
import { toast } from 'sonner';

interface RecoveryStats {
    missed_calls: number;
    sms_sent: number;
    customer_replies: number;
    booked_leads: number;
    recovery_rate: number;
    estimated_recovered_revenue: number;
}

interface CallbackLead {
    id: string;
    sourceType?: 'call_analysis' | 'action_item';
    customerName: string | null;
    customerPhone: string | null;
    urgency: string | null;
    callbackStatus: string | null;
    dueBy: string | null;
    summary: string | null;
    followUpNotes: string | null;
    createdAt: string;
}

interface HotLeadsSummary {
    total: number;
    dueNow: number;
    highUrgency: number;
    bookedToday: number | null;
}

const PERIOD_DAYS = 30;
const MAX_CALLBACKS = 6;
// A missed call older than this is cold — chasing it reads as spam, so it drops
// off Today automatically (it still lives in the full Queue / Calls history).
const STALE_HOURS = 72;

function greeting(date: Date): string {
    const h = date.getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
}

function formatMoney(n: number): string {
    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
    }).format(n || 0);
}

function StatCard({
    label, value, sub, icon: Icon, accent,
}: {
    label: string;
    value: string | number;
    sub?: string;
    icon: React.ComponentType<{ className?: string }>;
    accent?: string;
}) {
    return (
        <Card>
            <CardContent className="py-4">
                <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    <Icon className={`h-4 w-4 ${accent ?? 'text-slate-400'}`} />
                </div>
                <p className={`text-2xl font-bold mt-1 ${accent ?? 'text-slate-800'}`}>{value}</p>
                {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
            </CardContent>
        </Card>
    );
}

function RecoveryFunnel({ stats }: { stats: RecoveryStats | null }) {
    if (!stats || stats.missed_calls === 0) return null;

    const stages = [
        { label: 'Missed calls', value: stats.missed_calls, color: 'bg-slate-400' },
        { label: 'Auto-texted', value: stats.sms_sent, color: 'bg-blue-400' },
        { label: 'Replied', value: stats.customer_replies, color: 'bg-indigo-500' },
        { label: 'Booked', value: stats.booked_leads, color: 'bg-green-500' },
    ];
    const max = Math.max(stats.missed_calls, 1);

    return (
        <Card>
            <CardContent className="py-4 space-y-3">
                <p className="text-xs font-medium text-slate-500">
                    Recovery funnel · last {PERIOD_DAYS} days
                </p>
                <div className="space-y-2">
                    {stages.map((s, i) => {
                        const pct = Math.round((s.value / max) * 100);
                        const prev = i > 0 ? stages[i - 1].value : null;
                        const conv = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
                        return (
                            <div key={s.label} className="flex items-center gap-3">
                                <span className="w-24 shrink-0 text-xs text-slate-600">{s.label}</span>
                                <div className="h-6 flex-1 overflow-hidden rounded bg-slate-100">
                                    <div
                                        className={`flex h-full items-center justify-end rounded px-2 ${s.color}`}
                                        style={{ width: `${s.value > 0 ? Math.max(pct, 8) : 0}%` }}
                                    >
                                        {s.value > 0 && (
                                            <span className="text-[11px] font-semibold text-white">{s.value}</span>
                                        )}
                                    </div>
                                </div>
                                <span className="w-12 shrink-0 text-right text-[11px] text-slate-400">
                                    {conv != null ? `${conv}%` : ''}
                                </span>
                            </div>
                        );
                    })}
                </div>
                <p className="text-[11px] text-slate-400">
                    Percentages show stage-to-stage conversion. Aim to lift the drop from replied to booked.
                </p>
            </CardContent>
        </Card>
    );
}

export default function TodayPage() {
    const router = useRouter();
    const [stats, setStats] = useState<RecoveryStats | null>(null);
    const [callbacks, setCallbacks] = useState<CallbackLead[]>([]);
    const [summary, setSummary] = useState<HotLeadsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actioningId, setActioningId] = useState<string | null>(null);
    const [bookingId, setBookingId] = useState<string | null>(null);
    const [bookingValue, setBookingValue] = useState('');
    const [now] = useState(() => new Date());

    const load = useCallback(async (silent = false) => {
        if (!silent) {
            setLoading(true);
            setError(null);
        }
        try {
            const [recoveryRes, hotRes] = await Promise.all([
                fetch(`/api/analytics/recovery?period=${PERIOD_DAYS}`),
                fetch('/api/hot-leads'),
            ]);
            const recovery = await recoveryRes.json();
            const hot = await hotRes.json();

            if (recoveryRes.ok && recovery.success) {
                setStats(recovery as RecoveryStats);
            }
            if (hotRes.ok && hot.success) {
                // Only call-analysis leads are actionable for one-tap callbacks.
                setCallbacks(
                    (hot.leads as CallbackLead[] || []).filter(
                        (l) => l.sourceType !== 'action_item',
                    ),
                );
                setSummary(hot.summary || null);
            }
            if ((!recoveryRes.ok || !recovery.success) && (!hotRes.ok || !hot.success)) {
                // On a silent refresh, keep the last good data rather than flashing an error.
                if (!silent) setError(recovery.error || hot.error || 'Failed to load your dashboard');
            }
        } catch {
            if (!silent) setError('Failed to load your dashboard');
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // Live refresh — keep Today current as a leave-it-open wall-board.
    // Silent (no spinner), and paused while the owner is mid-booking so a
    // background refresh never wipes an open job-value form.
    const bookingIdRef = useRef<string | null>(null);
    bookingIdRef.current = bookingId;
    useEffect(() => {
        const refreshIfIdle = () => {
            if (bookingIdRef.current === null && document.visibilityState === 'visible') {
                load(true);
            }
        };
        const id = setInterval(refreshIfIdle, 60000);
        document.addEventListener('visibilitychange', refreshIfIdle);
        return () => {
            clearInterval(id);
            document.removeEventListener('visibilitychange', refreshIfIdle);
        };
    }, [load]);

    const markBooked = async (leadId: string, value?: number) => {
        setActioningId(leadId);
        try {
            const res = await fetch(`/api/calls/${leadId}/mark-booked`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(value != null ? { booked_value: value } : {}),
            });
            const data = await res.json();
            if (res.ok && (data.success || data.id)) {
                toast.success(
                    value != null ? `Booked — ${formatMoney(value)} recovered 🎉` : 'Marked booked 🎉',
                );
                setCallbacks((prev) => prev.filter((l) => l.id !== leadId));
                setBookingId(null);
                setBookingValue('');
                // Reflect the win in the KPI row immediately.
                setStats((prev) => prev && ({
                    ...prev,
                    booked_leads: prev.booked_leads + 1,
                    estimated_recovered_revenue: prev.estimated_recovered_revenue + (value ?? 0),
                }));
            } else {
                toast.error(data.error || 'Could not update');
            }
        } catch {
            toast.error('Could not update');
        } finally {
            setActioningId(null);
        }
    };

    const confirmBooking = (leadId: string) => {
        const raw = bookingValue.trim();
        const parsed = raw === '' ? undefined : Number(raw);
        if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
            toast.error('Enter a valid job value');
            return;
        }
        markBooked(leadId, parsed);
    };

    // Clear a lead off Today without booking it — "handled / not chasing this one".
    const dismiss = async (leadId: string) => {
        setActioningId(leadId);
        try {
            const res = await fetch(`/api/calls/${leadId}/mark-lost`, { method: 'POST' });
            const data = await res.json();
            if (res.ok && (data.success || data.id)) {
                setCallbacks((prev) => prev.filter((l) => l.id !== leadId));
            } else {
                toast.error(data.error || 'Could not dismiss');
            }
        } catch {
            toast.error('Could not dismiss');
        } finally {
            setActioningId(null);
        }
    };

    const dueNow = summary?.dueNow ?? 0;
    // Auto-expire stale leads off Today: a call older than STALE_HOURS is cold.
    const staleCutoff = Date.now() - STALE_HOURS * 3600_000;
    const freshCallbacks = callbacks.filter(
        (l) => !l.createdAt || new Date(l.createdAt).getTime() >= staleCutoff,
    );
    const topCallbacks = freshCallbacks.slice(0, MAX_CALLBACKS);

    return (
        <div className="p-4 md:p-6 space-y-5 max-w-5xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Sun className="h-5 w-5 text-amber-500" />
                        {greeting(now)}
                    </h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                        {now.toLocaleDateString(undefined, {
                            weekday: 'long', month: 'long', day: 'numeric',
                        })}
                        {summary && (
                            <>
                                {' · '}
                                {dueNow > 0
                                    ? <span className="text-red-600 font-medium">{dueNow} callback{dueNow === 1 ? '' : 's'} due now</span>
                                    : <span className="text-green-600 font-medium">You&apos;re all caught up</span>}
                            </>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-400" title="This screen updates automatically every minute">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                        Live
                    </span>
                    <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {error && (
                <div className="text-center py-12 text-slate-500">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-red-400" />
                    <p className="text-sm">{error}</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => load()}>
                        <RefreshCw className="h-4 w-4 mr-1" /> Retry
                    </Button>
                </div>
            )}

            {!error && (
                <>
                    {/* Money-forward KPI row (last 30 days) */}
                    <div>
                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                            Last {PERIOD_DAYS} days
                        </p>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <StatCard
                                label="Recovered revenue"
                                value={stats ? formatMoney(stats.estimated_recovered_revenue) : '—'}
                                sub="from booked callbacks"
                                icon={DollarSign}
                                accent="text-green-600"
                            />
                            <StatCard
                                label="Jobs booked"
                                value={stats?.booked_leads ?? '—'}
                                sub={stats ? `${stats.recovery_rate}% recovery rate` : undefined}
                                icon={CalendarCheck}
                            />
                            <StatCard
                                label="Missed calls"
                                value={stats?.missed_calls ?? '—'}
                                sub={stats ? `${stats.sms_sent} auto-texts sent` : undefined}
                                icon={PhoneOff}
                            />
                            <StatCard
                                label="Customer replies"
                                value={stats?.customer_replies ?? '—'}
                                sub="conversations re-opened"
                                icon={TrendingUp}
                            />
                        </div>
                    </div>

                    {/* Recovery funnel — where leads leak between stages */}
                    <RecoveryFunnel stats={stats} />

                    {/* Needs attention now — the callback queue */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                                <Flame className="h-4 w-4 text-orange-500" />
                                Needs your attention
                            </h2>
                            {callbacks.length > 0 && (
                                <Button
                                    variant="ghost" size="sm" className="h-7 text-xs text-slate-500"
                                    onClick={() => router.push('/dashboard/hot-leads')}
                                >
                                    View all ({summary?.total ?? callbacks.length})
                                    <ArrowRight className="h-3 w-3 ml-1" />
                                </Button>
                            )}
                        </div>

                        {loading && callbacks.length === 0 ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="h-7 w-7 animate-spin text-slate-300" />
                            </div>
                        ) : topCallbacks.length === 0 ? (
                            <Card>
                                <CardContent className="py-10 text-center">
                                    <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-400" />
                                    <p className="text-sm font-medium text-slate-700">Nothing needs a callback right now.</p>
                                    <p className="text-xs text-slate-400 mt-1">
                                        New missed calls and AI follow-ups will show up here automatically.
                                    </p>
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="space-y-2">
                                {topCallbacks.map((lead) => {
                                    const isOverdue = lead.dueBy && new Date(lead.dueBy) < now;
                                    const busy = actioningId === lead.id;
                                    return (
                                        <Card
                                            key={lead.id}
                                            className={isOverdue ? 'border-red-200 bg-red-50/30' : undefined}
                                        >
                                            <CardContent className="py-3 space-y-2">
                                                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                                            <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                            <span className="font-medium text-sm text-slate-800 truncate">
                                                                {lead.customerName || lead.customerPhone || 'Unknown caller'}
                                                            </span>
                                                            <UrgencyBadge urgency={lead.urgency} />
                                                            <CallbackStatusBadge status={lead.callbackStatus} />
                                                        </div>
                                                        <p className="text-xs text-slate-600 line-clamp-2">
                                                            {lead.summary || 'Missed call — follow up to win the job.'}
                                                        </p>
                                                        {lead.dueBy && (
                                                            <p className={`text-xs mt-1 flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                                                                <Clock className="h-3 w-3" />
                                                                Due {new Date(lead.dueBy).toLocaleString(undefined, {
                                                                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                                                                })}
                                                                {isOverdue && ' (overdue)'}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-2 shrink-0">
                                                        {lead.customerPhone && (
                                                            <Button
                                                                size="sm" variant="outline" className="h-8 text-xs"
                                                                onClick={() => window.open(`tel:${lead.customerPhone}`, '_self')}
                                                            >
                                                                <PhoneCall className="h-3.5 w-3.5 mr-1" />
                                                                Call
                                                            </Button>
                                                        )}
                                                        <Button
                                                            size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700"
                                                            disabled={busy}
                                                            onClick={() => {
                                                                setBookingId(bookingId === lead.id ? null : lead.id);
                                                                setBookingValue('');
                                                            }}
                                                        >
                                                            {busy
                                                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                : <><CheckCircle className="h-3.5 w-3.5 mr-1" />Booked</>}
                                                        </Button>
                                                        <Button
                                                            size="sm" variant="ghost" className="h-8 px-2 text-xs text-slate-400 hover:text-slate-700"
                                                            disabled={busy}
                                                            title="Clear from Today — not chasing this one"
                                                            onClick={() => dismiss(lead.id)}
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                </div>

                                                {/* Inline booked-value capture — makes recovered revenue exact */}
                                                {bookingId === lead.id && (
                                                    <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center gap-2">
                                                        <div className="relative flex-1">
                                                            <DollarSign className="h-3.5 w-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                                                            <Input
                                                                type="number" min="0" step="1" inputMode="decimal"
                                                                placeholder="Job value (optional)"
                                                                className="h-8 text-xs pl-7"
                                                                value={bookingValue}
                                                                autoFocus
                                                                onChange={(e) => setBookingValue(e.target.value)}
                                                                onKeyDown={(e) => { if (e.key === 'Enter') confirmBooking(lead.id); }}
                                                            />
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <Button
                                                                size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700"
                                                                disabled={busy}
                                                                onClick={() => confirmBooking(lead.id)}
                                                            >
                                                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirm booked'}
                                                            </Button>
                                                            <Button
                                                                size="sm" variant="ghost" className="h-8 text-xs"
                                                                disabled={busy}
                                                                onClick={() => { setBookingId(null); setBookingValue(''); }}
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

                    {/* Quick links */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <button
                            onClick={() => router.push('/dashboard')}
                            className="text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                        >
                            <Phone className="h-5 w-5 text-blue-500 mb-2" />
                            <p className="text-sm font-medium text-slate-800">Open inbox</p>
                            <p className="text-xs text-slate-500">Reply to every conversation</p>
                        </button>
                        <button
                            onClick={() => router.push('/dashboard/followups')}
                            className="text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                        >
                            <Clock className="h-5 w-5 text-amber-500 mb-2" />
                            <p className="text-sm font-medium text-slate-800">Follow-ups</p>
                            <p className="text-xs text-slate-500">Scheduled callbacks &amp; reminders</p>
                        </button>
                        <button
                            onClick={() => router.push('/dashboard/analytics')}
                            className="text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                        >
                            <TrendingUp className="h-5 w-5 text-green-500 mb-2" />
                            <p className="text-sm font-medium text-slate-800">Analytics</p>
                            <p className="text-xs text-slate-500">Trends &amp; recovery over time</p>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
