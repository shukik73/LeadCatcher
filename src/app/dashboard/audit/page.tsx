"use client";

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Loader2, RefreshCw, ClipboardCheck, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
    QUESTION_KEYS,
    QUESTION_LABELS,
    QUESTION_WEIGHTS,
    MAX_POSSIBLE_SCORE,
    type QuestionKey,
} from '@/lib/audit-scoring';

interface AuditRow {
    id: string;
    employee_name: string;
    submitted_by: string;
    audit_date: string;
    total_score: number;
    max_possible_score: number;
    store_name: string;
    rd_synced_at: string | null;
    created_at: string;
}

const DEFAULT_ANSWERS: Record<QuestionKey, boolean> = {
    q_proper_greeting: false,
    q_open_ended_questions: false,
    q_location_info: false,
    q_closing_with_name: false,
    q_warranty_mention: false,
    q_timely_answers: false,
    q_alert_demeanor: false,
    q_call_under_2_30: false,
    q_effort_customer_in: false,
};

export default function AuditPage() {
    const searchParams = useSearchParams();

    // Form state
    const [storeName, setStoreName] = useState('');
    const [storeEmail, setStoreEmail] = useState('');
    const [managerEmail, setManagerEmail] = useState('');
    const [employeeName, setEmployeeName] = useState('');
    const [submittedBy, setSubmittedBy] = useState('');
    const [auditDate, setAuditDate] = useState('');
    const [rdLeadId, setRdLeadId] = useState('');
    const [callAnalysisId, setCallAnalysisId] = useState('');
    const [answers, setAnswers] = useState<Record<QuestionKey, boolean>>({ ...DEFAULT_ANSWERS });
    const [devicePriceQuoted, setDevicePriceQuoted] = useState('');
    const [improvements, setImprovements] = useState('');
    const [callStatus, setCallStatus] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Recent audits
    const [audits, setAudits] = useState<AuditRow[]>([]);
    const [auditsLoading, setAuditsLoading] = useState(true);

    // Pre-fill from URL params (from call detail panel)
    useEffect(() => {
        const callId = searchParams.get('call_id');
        const employee = searchParams.get('employee');
        if (callId) setCallAnalysisId(callId);
        if (employee) setEmployeeName(employee);
        // Set default date to now
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        setAuditDate(
            `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
        );
    }, [searchParams]);

    // Calculate live score
    const liveScore = QUESTION_KEYS.reduce(
        (sum, key) => sum + (answers[key] ? QUESTION_WEIGHTS[key] : 0),
        0,
    );
    const livePercentage = MAX_POSSIBLE_SCORE > 0 ? Math.round((liveScore / MAX_POSSIBLE_SCORE) * 100) : 0;

    const scoreColor =
        livePercentage >= 80 ? 'text-green-600' :
            livePercentage >= 60 ? 'text-yellow-600' :
                'text-red-600';

    const fetchAudits = useCallback(async () => {
        setAuditsLoading(true);
        try {
            const res = await fetch('/api/audits/list?limit=10');
            const data = await res.json();
            if (data.success) {
                setAudits(data.audits);
            }
        } catch {
            // Silent fail for list
        } finally {
            setAuditsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAudits();
    }, [fetchAudits]);

    const handleToggle = (key: QuestionKey, checked: boolean) => {
        setAnswers((prev) => ({ ...prev, [key]: checked }));
    };

    const resetForm = () => {
        setStoreName('');
        setStoreEmail('');
        setManagerEmail('');
        setEmployeeName('');
        setSubmittedBy('');
        setRdLeadId('');
        setCallAnalysisId('');
        setAnswers({ ...DEFAULT_ANSWERS });
        setDevicePriceQuoted('');
        setImprovements('');
        setCallStatus('');
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        setAuditDate(
            `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
        );
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!storeName || !employeeName || !submittedBy || !auditDate) {
            toast.error('Please fill in all required fields');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/audits/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    store_name: storeName,
                    store_email: storeEmail || undefined,
                    manager_email: managerEmail || undefined,
                    employee_name: employeeName,
                    submitted_by: submittedBy,
                    audit_date: new Date(auditDate).toISOString(),
                    rd_lead_id: rdLeadId || undefined,
                    call_analysis_id: callAnalysisId || undefined,
                    ...answers,
                    device_price_quoted: devicePriceQuoted || undefined,
                    improvements: improvements || undefined,
                    call_status: callStatus || undefined,
                }),
            });

            const data = await res.json();

            if (data.success) {
                toast.success(`Audit submitted! Score: ${data.total_score}/${data.max_possible_score} (${data.percentage}%)`);
                resetForm();
                fetchAudits();
            } else {
                toast.error(data.error || 'Failed to submit audit');
            }
        } catch {
            toast.error('Failed to submit audit');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSyncRd = async (auditId: string) => {
        try {
            const res = await fetch('/api/audits/sync-rd', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audit_id: auditId }),
            });
            const data = await res.json();
            if (data.success) {
                toast.success(data.already_synced ? 'Already synced' : 'Synced to RepairDesk');
                fetchAudits();
            } else {
                toast.error(data.error || 'Sync failed');
            }
        } catch {
            toast.error('Sync failed');
        }
    };

    return (
        <div className="p-4 md:p-6 space-y-6 max-w-[900px]">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-blue-600" />
                    <h1 className="text-xl font-bold text-slate-800">Phone Call Audit</h1>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Metadata Section */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm">Call Details</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="store_name">Store *</Label>
                            <Input
                                id="store_name"
                                value={storeName}
                                onChange={(e) => setStoreName(e.target.value)}
                                placeholder="Store name"
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="store_email">Store Email</Label>
                            <Input
                                id="store_email"
                                type="email"
                                value={storeEmail}
                                onChange={(e) => setStoreEmail(e.target.value)}
                                placeholder="store@example.com"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="manager_email">Owner/Manager Email</Label>
                            <Input
                                id="manager_email"
                                type="email"
                                value={managerEmail}
                                onChange={(e) => setManagerEmail(e.target.value)}
                                placeholder="manager@example.com"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="employee_name">Employee Who Answered *</Label>
                            <Input
                                id="employee_name"
                                value={employeeName}
                                onChange={(e) => setEmployeeName(e.target.value)}
                                placeholder="Employee name"
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="submitted_by">Person Submitting Audit *</Label>
                            <Input
                                id="submitted_by"
                                value={submittedBy}
                                onChange={(e) => setSubmittedBy(e.target.value)}
                                placeholder="Your name"
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="audit_date">Date/Time *</Label>
                            <Input
                                id="audit_date"
                                type="datetime-local"
                                value={auditDate}
                                onChange={(e) => setAuditDate(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="rd_lead_id">Lead ID (RepairDesk)</Label>
                            <Input
                                id="rd_lead_id"
                                value={rdLeadId}
                                onChange={(e) => setRdLeadId(e.target.value)}
                                placeholder="Copy & paste from RepairDesk"
                            />
                        </div>
                        {callAnalysisId && (
                            <div className="space-y-1.5">
                                <Label>Linked Call</Label>
                                <p className="text-xs text-slate-500 mt-1 truncate">{callAnalysisId}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Quality Checklist */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm">Quality Checklist</CardTitle>
                            <div className={`text-lg font-bold ${scoreColor}`}>
                                {liveScore}/{MAX_POSSIBLE_SCORE}
                                <span className="text-sm font-normal ml-1">({livePercentage}%)</span>
                            </div>
                        </div>
                        {/* Score bar */}
                        <div className="w-full bg-slate-100 rounded-full h-2 mt-2">
                            <div
                                className={`h-2 rounded-full transition-all duration-300 ${
                                    livePercentage >= 80 ? 'bg-green-500' :
                                        livePercentage >= 60 ? 'bg-yellow-500' :
                                            'bg-red-500'
                                }`}
                                style={{ width: `${livePercentage}%` }}
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {QUESTION_KEYS.map((key) => (
                            <div
                                key={key}
                                className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 transition-colors"
                            >
                                <div className="flex-1">
                                    <span className="text-sm text-slate-700">
                                        {QUESTION_LABELS[key]}
                                    </span>
                                    <span className="text-xs text-slate-400 ml-2">
                                        ({QUESTION_WEIGHTS[key]} pts)
                                    </span>
                                </div>
                                <Switch
                                    checked={answers[key]}
                                    onCheckedChange={(checked) => handleToggle(key, checked)}
                                />
                            </div>
                        ))}
                    </CardContent>
                </Card>

                {/* Additional Fields */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm">Additional Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="device_price">Device / Price Quoted</Label>
                                <Input
                                    id="device_price"
                                    value={devicePriceQuoted}
                                    onChange={(e) => setDevicePriceQuoted(e.target.value)}
                                    placeholder="e.g. iPhone 15 / $89"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="call_status">Call Status</Label>
                                <Select value={callStatus} onValueChange={setCallStatus}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="answered">Answered</SelectItem>
                                        <SelectItem value="missed">Missed</SelectItem>
                                        <SelectItem value="voicemail">Voicemail</SelectItem>
                                        <SelectItem value="transferred">Transferred</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="improvements">Improvements Necessary</Label>
                            <Textarea
                                id="improvements"
                                value={improvements}
                                onChange={(e) => setImprovements(e.target.value)}
                                placeholder="Notes on areas for improvement..."
                                className="min-h-[80px]"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Submit */}
                <Button type="submit" disabled={submitting} className="w-full">
                    {submitting ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                        <Send className="h-4 w-4 mr-2" />
                    )}
                    Submit Audit
                </Button>
            </form>

            {/* Recent Audits Table */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">Recent Audits</CardTitle>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={fetchAudits}
                            disabled={auditsLoading}
                        >
                            {auditsLoading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <RefreshCw className="h-3 w-3" />
                            )}
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {auditsLoading && audits.length === 0 ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                        </div>
                    ) : audits.length === 0 ? (
                        <p className="text-sm text-slate-500 text-center py-6">No audits yet</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left text-slate-500">
                                        <th className="pb-2 font-medium">Date</th>
                                        <th className="pb-2 font-medium">Employee</th>
                                        <th className="pb-2 font-medium">Store</th>
                                        <th className="pb-2 font-medium">Score</th>
                                        <th className="pb-2 font-medium">RD Sync</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {audits.map((audit) => {
                                        const pct = audit.max_possible_score > 0
                                            ? Math.round((audit.total_score / audit.max_possible_score) * 100)
                                            : 0;
                                        return (
                                            <tr key={audit.id} className="border-b last:border-0">
                                                <td className="py-2 text-slate-600">
                                                    {new Date(audit.audit_date).toLocaleDateString()}
                                                </td>
                                                <td className="py-2">{audit.employee_name}</td>
                                                <td className="py-2 text-slate-600">{audit.store_name}</td>
                                                <td className="py-2">
                                                    <Badge
                                                        variant={pct >= 80 ? 'default' : pct >= 60 ? 'secondary' : 'destructive'}
                                                    >
                                                        {audit.total_score}/{audit.max_possible_score} ({pct}%)
                                                    </Badge>
                                                </td>
                                                <td className="py-2">
                                                    {audit.rd_synced_at ? (
                                                        <span className="text-xs text-green-600">Synced</span>
                                                    ) : (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 text-xs"
                                                            onClick={() => handleSyncRd(audit.id)}
                                                        >
                                                            Sync
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
