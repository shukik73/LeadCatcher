'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TIMEZONES } from '@/lib/timezones';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, XCircle, RefreshCw, Save } from 'lucide-react';

interface BusinessHours {
    [key: string]: {
        open: string;
        close: string;
        isOpen: boolean;
    };
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Preset SMS templates for business hours
const OPEN_PRESETS = [
    "Hi! We missed your call — we were helping another customer. How can we help you? Would you like us to give you a call back in a few?",
    "Hey there! Sorry we missed your call, we were busy at the service desk helping another customer. How can we assist you? Reply here and we'll get right back to you!",
    "Hi! We're sorry we couldn't answer — all of our team members are currently assisting other customers. Text us what you need and we'll respond ASAP!",
    "Hey! We just missed your call but we're here. Let us know how we can help and we'll get back to you in just a moment!",
];

// Preset SMS templates for after hours
const CLOSED_PRESETS = [
    "Hi! Our store is currently closed. How can we help you? Would you like us to schedule an appointment for when we open?",
    "Hey there! We're closed for the day but got your call. Text us what you need and we'll get back to you first thing when we open!",
    "Hi! We're currently closed but your call is important to us. Leave us a message here and we'll reach out as soon as we're back!",
    "Hey! Thanks for calling. We're closed right now but we'll be back soon. Reply with how we can help and we'll follow up when we open!",
];

export default function SettingsPage() {
    const [loading, setLoading] = useState(true);

    // Form State
    const [smsTemplate, setSmsTemplate] = useState('');
    const [smsTemplateClosed, setSmsTemplateClosed] = useState('');
    const [timezone, setTimezone] = useState('America/New_York');
    const [hours, setHours] = useState<BusinessHours>(() => {
        const init: BusinessHours = {};
        DAYS.forEach(day => { init[day] = { open: '09:00', close: '17:00', isOpen: true }; });
        return init;
    });

    // RepairDesk State
    const [repairDeskApiKey, setRepairDeskApiKey] = useState('');
    const [repairDeskSubdomain, setRepairDeskSubdomain] = useState('');
    const [hasExistingApiKey, setHasExistingApiKey] = useState(false);
    const [apiKeyModified, setApiKeyModified] = useState(false);
    const [rdTestStatus, setRdTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [rdTestError, setRdTestError] = useState('');
    const [syncing, setSyncing] = useState(false);

    // Per-section saving states
    const [savingTemplates, setSavingTemplates] = useState(false);
    const [savingHours, setSavingHours] = useState(false);
    const [savingApi, setSavingApi] = useState(false);

    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    const fetchSettings = useCallback(async (signal?: { cancelled: boolean }) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (signal?.cancelled) return;
        if (!user) {
            setLoading(false);
            return;
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id, sms_template, sms_template_closed, timezone, business_hours, repairdesk_store_url')
            .eq('user_id', user.id)
            .single();

        if (signal?.cancelled) return;
        if (business) {
            setSmsTemplate(business.sms_template || OPEN_PRESETS[0]);
            setSmsTemplateClosed(business.sms_template_closed || CLOSED_PRESETS[0]);
            setTimezone(business.timezone || 'America/New_York');
            setRepairDeskSubdomain(business.repairdesk_store_url || '');

            // Check if API key exists without fetching the raw value
            const { count } = await supabase
                .from('businesses')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .not('repairdesk_api_key', 'is', null);

            if (count && count > 0) {
                setRepairDeskApiKey('');
                setHasExistingApiKey(true);
                setApiKeyModified(false);
            } else {
                setRepairDeskApiKey('');
                setHasExistingApiKey(false);
            }

            const existingHours = (business.business_hours as BusinessHours) || {};
            const initialHours: BusinessHours = {};
            DAYS.forEach(day => {
                initialHours[day] = existingHours[day] || { open: '09:00', close: '17:00', isOpen: true };
            });
            setHours(initialHours);
        }
        setLoading(false);
    }, [supabase]);

    useEffect(() => {
        const signal = { cancelled: false };
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchSettings(signal);
        return () => { signal.cancelled = true; };
    }, [fetchSettings]);

    const handleHourChange = (day: string, field: 'open' | 'close', value: string) => {
        setHours(prev => {
            const current = prev[day] || { open: '09:00', close: '17:00', isOpen: true };
            return { ...prev, [day]: { ...current, [field]: value } };
        });
    };

    const handleToggleDay = (day: string) => {
        setHours(prev => {
            const current = prev[day] || { open: '09:00', close: '17:00', isOpen: true };
            return { ...prev, [day]: { ...current, isOpen: !current.isOpen } };
        });
    };

    // Server-side save via API route (bypasses trigger issues)
    const saveSettings = async (data: Record<string, unknown>) => {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        const result = await res.json();
        if (!res.ok) {
            throw new Error(result.error || 'Failed to save');
        }
        return result;
    };

    const handleSaveTemplates = async () => {
        setSavingTemplates(true);
        try {
            await saveSettings({
                sms_template: smsTemplate,
                sms_template_closed: smsTemplateClosed || null,
            });
            toast.success('Response templates saved!');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to save templates');
        }
        setSavingTemplates(false);
    };

    const handleSaveHours = async () => {
        setSavingHours(true);
        try {
            await saveSettings({
                timezone,
                business_hours: hours,
            });
            toast.success('Business hours saved!');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to save hours');
        }
        setSavingHours(false);
    };

    const handleSaveApi = async () => {
        setSavingApi(true);
        try {
            const data: Record<string, unknown> = {
                repairdesk_store_url: repairDeskSubdomain || null,
            };
            if (apiKeyModified) {
                data.repairdesk_api_key = repairDeskApiKey || null;
            }
            await saveSettings(data);
            if (apiKeyModified && repairDeskApiKey) {
                setHasExistingApiKey(true);
                setApiKeyModified(false);
            }
            toast.success('API settings saved!');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to save API settings');
        }
        setSavingApi(false);
    };

    const handleTestRepairDesk = async () => {
        if (!repairDeskApiKey) {
            toast.error('Enter your RepairDesk API key first');
            return;
        }
        setRdTestStatus('testing');
        setRdTestError('');
        try {
            const res = await fetch('/api/repairdesk/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: repairDeskApiKey, subdomain: repairDeskSubdomain || undefined }),
            });
            const data = await res.json();
            if (data.success) {
                setRdTestStatus('success');
                setRdTestError('');
                toast.success('Connected to RepairDesk!');
            } else {
                setRdTestStatus('error');
                const errorDetail = data.baseUrl
                    ? `${data.message} (Tried: ${data.baseUrl})`
                    : data.message || 'Connection failed';
                setRdTestError(errorDetail);
                toast.error(data.message || 'Connection failed');
            }
        } catch {
            setRdTestStatus('error');
            setRdTestError('Network error — could not reach the server');
            toast.error('Connection test failed');
        }
    };

    const handleSyncRepairDesk = async () => {
        setSyncing(true);
        try {
            const res = await fetch('/api/repairdesk/sync', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                toast.success(`Synced ${data.synced} customers from RepairDesk`);
            } else {
                toast.error(data.error || 'Sync failed');
            }
        } catch {
            toast.error('Sync failed');
        }
        setSyncing(false);
    };

    if (loading) return <div className="p-8">Loading settings...</div>;

    return (
        <div className="container mx-auto p-6 max-w-6xl space-y-8">
            <h1 className="text-3xl font-bold">Settings</h1>

            {/* Smart Response Templates */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Smart Response Templates</CardTitle>
                            <CardDescription>Choose a preset or write your own message for missed calls.</CardDescription>
                        </div>
                        <Button onClick={handleSaveTemplates} disabled={savingTemplates} size="sm" className="gap-2">
                            {savingTemplates ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Save Templates
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-3">
                        <Label className="text-base font-semibold">During Business Hours</Label>
                        <div className="flex flex-wrap gap-2">
                            {OPEN_PRESETS.map((preset, i) => (
                                <Button
                                    key={i}
                                    variant={smsTemplate === preset ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setSmsTemplate(preset)}
                                    className="text-xs h-auto py-1.5 px-3"
                                >
                                    Option {i + 1}
                                </Button>
                            ))}
                        </div>
                        <Textarea
                            value={smsTemplate}
                            onChange={(e) => setSmsTemplate(e.target.value)}
                            placeholder="Hi! We missed your call..."
                            className="h-24"
                        />
                        <p className="text-sm text-gray-500">Use {'{{business_name}}'} as a placeholder for your business name.</p>
                    </div>
                    <div className="space-y-3">
                        <Label className="text-base font-semibold">After Hours / Closed</Label>
                        <div className="flex flex-wrap gap-2">
                            {CLOSED_PRESETS.map((preset, i) => (
                                <Button
                                    key={i}
                                    variant={smsTemplateClosed === preset ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setSmsTemplateClosed(preset)}
                                    className="text-xs h-auto py-1.5 px-3"
                                >
                                    Option {i + 1}
                                </Button>
                            ))}
                        </div>
                        <Textarea
                            value={smsTemplateClosed}
                            onChange={(e) => setSmsTemplateClosed(e.target.value)}
                            placeholder="Hi! Our store is currently closed..."
                            className="h-24"
                        />
                        <p className="text-sm text-gray-500">Use {'{{business_name}}'} as a placeholder for your business name.</p>
                    </div>
                </CardContent>
            </Card>

            {/* Two-column: Business Hours + RepairDesk Integration */}
            <div className="grid lg:grid-cols-2 gap-6">
                {/* Business Hours */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>Business Hours</CardTitle>
                                <CardDescription>Smart responses respect these times.</CardDescription>
                            </div>
                            <Button onClick={handleSaveHours} disabled={savingHours} size="sm" className="gap-2">
                                {savingHours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Save Hours
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-4">
                            <Label htmlFor="timezone-select">Timezone</Label>
                            <Select value={timezone} onValueChange={setTimezone}>
                                <SelectTrigger id="timezone-select" className="w-full">
                                    <SelectValue placeholder="Select timezone" />
                                </SelectTrigger>
                                <SelectContent>
                                    {TIMEZONES.map(tz => (
                                        <SelectItem key={tz.value} value={tz.value}>
                                            {tz.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            {DAYS.map(day => (
                                <div key={day} className="flex items-center justify-between p-2 border rounded-lg">
                                    <div className="flex items-center gap-3 w-28">
                                        <Switch
                                            checked={hours[day]?.isOpen ?? true}
                                            onCheckedChange={() => handleToggleDay(day)}
                                            aria-label={`Toggle ${day} business hours`}
                                        />
                                        <span className="capitalize text-sm font-medium">{day.slice(0, 3)}</span>
                                    </div>

                                    {(hours[day]?.isOpen ?? true) ? (
                                        <div className="flex items-center gap-1">
                                            <Input
                                                type="time"
                                                value={hours[day]?.open ?? '09:00'}
                                                onChange={(e) => handleHourChange(day, 'open', e.target.value)}
                                                className="w-28 text-sm"
                                            />
                                            <span className="text-xs text-gray-400">to</span>
                                            <Input
                                                type="time"
                                                value={hours[day]?.close ?? '17:00'}
                                                onChange={(e) => handleHourChange(day, 'close', e.target.value)}
                                                className="w-28 text-sm"
                                            />
                                        </div>
                                    ) : (
                                        <span className="text-gray-400 italic text-sm pr-4">Closed</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* RepairDesk Integration */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>RepairDesk Integration</CardTitle>
                                <CardDescription>Connect RepairDesk to sync customers.</CardDescription>
                            </div>
                            <Button onClick={handleSaveApi} disabled={savingApi} size="sm" className="gap-2">
                                {savingApi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Save API
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="rd-api-key">API Key</Label>
                            <Input
                                id="rd-api-key"
                                type="password"
                                value={repairDeskApiKey}
                                onChange={(e) => {
                                    setRepairDeskApiKey(e.target.value);
                                    setApiKeyModified(true);
                                }}
                                onFocus={() => {
                                    if (hasExistingApiKey && !apiKeyModified) {
                                        setRepairDeskApiKey('');
                                        setApiKeyModified(true);
                                    }
                                }}
                                placeholder={hasExistingApiKey ? 'Key saved (click to change)' : 'Enter your RepairDesk API key'}
                            />
                            <p className="text-sm text-gray-500">
                                RepairDesk: Store Settings &rarr; Other Info &rarr; API Key.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="rd-subdomain">Subdomain (optional)</Label>
                            <div className="flex items-center gap-1">
                                <Input
                                    id="rd-subdomain"
                                    type="text"
                                    value={repairDeskSubdomain}
                                    onChange={(e) => setRepairDeskSubdomain(e.target.value)}
                                    placeholder="yourshop"
                                    className="max-w-40"
                                />
                                <span className="text-sm text-gray-500 whitespace-nowrap">.repairdesk.co</span>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleTestRepairDesk}
                                disabled={rdTestStatus === 'testing' || !repairDeskApiKey}
                            >
                                {rdTestStatus === 'testing' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                {rdTestStatus === 'success' && <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />}
                                {rdTestStatus === 'error' && <XCircle className="h-4 w-4 mr-2 text-red-600" />}
                                Test Connection
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleSyncRepairDesk}
                                disabled={syncing || !repairDeskApiKey}
                            >
                                {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                Sync Customers
                            </Button>
                        </div>
                        {rdTestError && (
                            <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md">{rdTestError}</p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
