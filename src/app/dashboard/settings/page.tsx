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
import { Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

interface BusinessHours {
    [key: string]: {
        open: string;
        close: string;
        isOpen: boolean;
    };
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function SettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [businessId, setBusinessId] = useState<string | null>(null);

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
            .select('id, sms_template, sms_template_closed, timezone, business_hours, repairdesk_api_key, repairdesk_store_url')
            .eq('user_id', user.id)
            .single();

        if (signal?.cancelled) return;
        if (business) {
            setBusinessId(business.id);
            setSmsTemplate(business.sms_template || "Hi! We missed your call — we were helping another customer. How can we help you? Would you like us to give you a call back in a few?");
            setSmsTemplateClosed(business.sms_template_closed || "Hi! Our store is currently closed. How can we help you? Would you like us to schedule an appointment for when we open?");
            setTimezone(business.timezone || 'America/New_York');
                // Mask API key: show only last 4 chars if present
                if (business.repairdesk_api_key) {
                    const key = business.repairdesk_api_key;
                    setRepairDeskApiKey('••••••••' + key.slice(-4));
                    setHasExistingApiKey(true);
                    setApiKeyModified(false);
                } else {
                    setRepairDeskApiKey('');
                    setHasExistingApiKey(false);
                }
                setRepairDeskSubdomain(business.repairdesk_store_url || '');

            // Initialize hours if empty - create new object to avoid mutating Supabase data
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
        // Data fetching with setState is the standard React effect pattern
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

    const handleSave = async () => {
        if (!businessId) return;
        setSaving(true);

        const updateData: Record<string, unknown> = {
            sms_template: smsTemplate,
            sms_template_closed: smsTemplateClosed || null,
            timezone,
            business_hours: hours,
            repairdesk_store_url: repairDeskSubdomain || null,
        };

        // Only send API key if user explicitly changed it (avoid saving masked value)
        if (apiKeyModified) {
            updateData.repairdesk_api_key = repairDeskApiKey || null;
        }

        const { error } = await supabase
            .from('businesses')
            .update(updateData)
            .eq('id', businessId);

        if (error) {
            console.error('Settings save error:', error);
            toast.error('Failed to save settings', { description: error.message });
        } else {
            toast.success('Settings saved successfully');
        }
        setSaving(false);
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
        <div className="container mx-auto p-6 max-w-4xl space-y-8">
            <h1 className="text-3xl font-bold">Settings</h1>

            {/* SMS Template Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Smart Response Templates</CardTitle>
                    <CardDescription>Customize the messages sent to missed calls based on your business hours.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <Label>During Business Hours</Label>
                        <Textarea
                            value={smsTemplate}
                            onChange={(e) => setSmsTemplate(e.target.value)}
                            placeholder="Hi! We missed your call — we were helping another customer..."
                            className="h-24"
                        />
                        <p className="text-sm text-gray-500">Sent when a call is missed during your open hours. Use {'{{business_name}}'} as a placeholder.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>After Hours / Closed</Label>
                        <Textarea
                            value={smsTemplateClosed}
                            onChange={(e) => setSmsTemplateClosed(e.target.value)}
                            placeholder="Hi! Our store is currently closed..."
                            className="h-24"
                        />
                        <p className="text-sm text-gray-500">Sent when a call is missed outside your business hours. Use {'{{business_name}}'} as a placeholder.</p>
                    </div>
                </CardContent>
            </Card>

            {/* Business Hours Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Business Hours</CardTitle>
                    <CardDescription>Set your operating hours. Smart responses will respect these times.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center gap-4">
                        <Label htmlFor="timezone-select">Timezone</Label>
                        <Select value={timezone} onValueChange={setTimezone}>
                            <SelectTrigger id="timezone-select" className="w-64">
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

                    <div className="space-y-4">
                        {DAYS.map(day => (
                            <div key={day} className="flex items-center justify-between p-2 border rounded-lg">
                                <div className="flex items-center gap-4 w-32">
                                    <Switch
                                        checked={hours[day]?.isOpen ?? true}
                                        onCheckedChange={() => handleToggleDay(day)}
                                        aria-label={`Toggle ${day} business hours`}
                                    />
                                    <span className="capitalize font-medium">{day}</span>
                                </div>

                                {(hours[day]?.isOpen ?? true) ? (
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="time"
                                            value={hours[day]?.open ?? '09:00'}
                                            onChange={(e) => handleHourChange(day, 'open', e.target.value)}
                                            className="w-32"
                                        />
                                        <span>to</span>
                                        <Input
                                            type="time"
                                            value={hours[day]?.close ?? '17:00'}
                                            onChange={(e) => handleHourChange(day, 'close', e.target.value)}
                                            className="w-32"
                                        />
                                    </div>
                                ) : (
                                    <span className="text-gray-400 italic pr-4">Closed</span>
                                )}
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* RepairDesk Integration */}
            <Card>
                <CardHeader>
                    <CardTitle>RepairDesk Integration</CardTitle>
                    <CardDescription>Connect your RepairDesk account to sync customers as leads.</CardDescription>
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
                                // Clear masked placeholder when user focuses the field
                                if (hasExistingApiKey && !apiKeyModified) {
                                    setRepairDeskApiKey('');
                                    setApiKeyModified(true);
                                }
                            }}
                            placeholder={hasExistingApiKey ? 'Key saved (click to change)' : 'Enter your RepairDesk API key'}
                        />
                        <p className="text-sm text-gray-500">
                            Find this in RepairDesk: Store Settings &rarr; Other Information &rarr; API Key.
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
                                className="max-w-48"
                            />
                            <span className="text-sm text-gray-500 whitespace-nowrap">.repairdesk.co</span>
                        </div>
                        <p className="text-sm text-gray-500">Your RepairDesk subdomain. Leave blank to use the default.</p>
                    </div>
                    <div className="flex gap-3 items-center">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleTestRepairDesk}
                            disabled={rdTestStatus === 'testing' || !repairDeskApiKey}
                        >
                            {rdTestStatus === 'testing' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {rdTestStatus === 'success' && <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />}
                            {rdTestStatus === 'error' && <XCircle className="h-4 w-4 mr-2 text-red-600" />}
                            {rdTestStatus === 'idle' && null}
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

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving} size="lg">
                    {saving ? 'Saving...' : 'Save Changes'}
                </Button>
            </div>
        </div>
    );
}
