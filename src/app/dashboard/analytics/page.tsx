"use client";

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
    Loader2, BarChart3, PhoneCall, PhoneMissed, MessageSquare,
    Users, DollarSign, TrendingUp, ArrowRight, Trophy,
} from 'lucide-react';
import { toast } from 'sonner';

interface FunnelData {
    funnel: {
        total_calls: number; missed_calls: number; answered_calls: number;
        sms_sent: number; total_leads: number; contacted: number;
        booked: number; lost: number; revenue: number;
    };
    rates: {
        missed_to_contact: number; contact_to_book: number; overall_conversion: number;
    };
    leaderboard: Array<{ name: string; calls: number; booked: number; revenue: number }>;
    period: number;
}

export default function AnalyticsPage() {
    const [data, setData] = useState<FunnelData | null>(null);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState('30');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/analytics/funnel?period=${period}`);
            const json = await res.json();
            if (json.success) {
                setData(json);
            } else {
                toast.error(json.error || 'Failed to load analytics');
            }
        } catch {
            toast.error('Failed to load analytics');
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    if (loading && !data) {
        return (
            <div className="flex justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
        );
    }

    const f = data?.funnel;
    const r = data?.rates;

    return (
        <div className="p-4 md:p-6 space-y-6 max-w-[1200px]">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-blue-600" />
                    <h1 className="text-xl font-bold text-slate-800">Lead Conversion</h1>
                </div>
                <Select value={period} onValueChange={setPeriod}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="7">Last 7 days</SelectItem>
                        <SelectItem value="30">Last 30 days</SelectItem>
                        <SelectItem value="90">Last 90 days</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {f && r && (
                <>
                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <KPICard
                            icon={PhoneCall}
                            label="Total Calls"
                            value={f.total_calls}
                            color="text-blue-600"
                        />
                        <KPICard
                            icon={PhoneMissed}
                            label="Missed Calls"
                            value={f.missed_calls}
                            color="text-red-500"
                        />
                        <KPICard
                            icon={Users}
                            label="Booked"
                            value={f.booked}
                            color="text-green-600"
                        />
                        <KPICard
                            icon={DollarSign}
                            label="Revenue Captured"
                            value={`$${f.revenue.toLocaleString()}`}
                            color="text-emerald-600"
                        />
                    </div>

                    {/* Conversion Funnel */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <TrendingUp className="h-4 w-4" />
                                Conversion Funnel
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <FunnelStep
                                    label="Missed Calls"
                                    value={f.missed_calls}
                                    color="bg-red-100 text-red-700"
                                />
                                <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />
                                <FunnelStep
                                    label="SMS Sent"
                                    value={f.sms_sent}
                                    color="bg-blue-100 text-blue-700"
                                />
                                <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />
                                <FunnelStep
                                    label="Replied"
                                    value={f.contacted}
                                    color="bg-yellow-100 text-yellow-700"
                                    rate={r.missed_to_contact}
                                />
                                <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />
                                <FunnelStep
                                    label="Booked"
                                    value={f.booked}
                                    color="bg-green-100 text-green-700"
                                    rate={r.contact_to_book}
                                />
                            </div>

                            <div className="mt-4 pt-3 border-t flex items-center justify-between text-sm">
                                <span className="text-slate-500">Overall Conversion</span>
                                <span className="font-bold text-lg text-green-600">
                                    {r.overall_conversion}%
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Quick Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Card>
                            <CardContent className="py-4 text-center">
                                <MessageSquare className="h-5 w-5 mx-auto text-blue-500 mb-2" />
                                <p className="text-2xl font-bold text-slate-800">{f.sms_sent}</p>
                                <p className="text-xs text-slate-500">SMS Messages Sent</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="py-4 text-center">
                                <Users className="h-5 w-5 mx-auto text-green-500 mb-2" />
                                <p className="text-2xl font-bold text-slate-800">{f.total_leads}</p>
                                <p className="text-xs text-slate-500">Total Leads Captured</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="py-4 text-center">
                                <PhoneMissed className="h-5 w-5 mx-auto text-orange-500 mb-2" />
                                <p className="text-2xl font-bold text-slate-800">{f.lost}</p>
                                <p className="text-xs text-slate-500">Lost Opportunities</p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Leaderboard */}
                    {data.leaderboard.length > 0 && (
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <Trophy className="h-4 w-4 text-yellow-500" />
                                    Employee Leaderboard
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b text-left text-slate-500">
                                                <th className="pb-2 font-medium">#</th>
                                                <th className="pb-2 font-medium">Name</th>
                                                <th className="pb-2 font-medium text-right">Calls</th>
                                                <th className="pb-2 font-medium text-right">Booked</th>
                                                <th className="pb-2 font-medium text-right">Revenue</th>
                                                <th className="pb-2 font-medium text-right">Rate</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.leaderboard.map((emp, idx) => (
                                                <tr key={emp.name} className="border-b last:border-0">
                                                    <td className="py-2 text-slate-400">{idx + 1}</td>
                                                    <td className="py-2 font-medium">{emp.name}</td>
                                                    <td className="py-2 text-right">{emp.calls}</td>
                                                    <td className="py-2 text-right">
                                                        <Badge variant={emp.booked > 0 ? 'default' : 'secondary'}>
                                                            {emp.booked}
                                                        </Badge>
                                                    </td>
                                                    <td className="py-2 text-right text-green-600">
                                                        ${emp.revenue.toLocaleString()}
                                                    </td>
                                                    <td className="py-2 text-right">
                                                        {emp.calls > 0 ? Math.round((emp.booked / emp.calls) * 100) : 0}%
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </>
            )}
        </div>
    );
}

function KPICard({ icon: Icon, label, value, color }: {
    icon: React.ElementType; label: string; value: number | string; color: string;
}) {
    return (
        <Card>
            <CardContent className="py-4">
                <div className="flex items-center gap-2 mb-1">
                    <Icon className={`h-4 w-4 ${color}`} />
                    <span className="text-xs text-slate-500">{label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-800">{value}</p>
            </CardContent>
        </Card>
    );
}

function FunnelStep({ label, value, color, rate }: {
    label: string; value: number; color: string; rate?: number;
}) {
    return (
        <div className="text-center">
            <div className={`inline-block px-4 py-2 rounded-lg ${color}`}>
                <p className="text-lg font-bold">{value}</p>
            </div>
            <p className="text-xs text-slate-500 mt-1">{label}</p>
            {rate != null && (
                <p className="text-[10px] text-slate-400">{rate}% conversion</p>
            )}
        </div>
    );
}
