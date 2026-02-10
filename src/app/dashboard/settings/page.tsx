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
    const [timezone, setTimezone] = useState('America/New_York');
    const [hours, setHours] = useState<BusinessHours>({});

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
            .select('id, sms_template, timezone, business_hours')
            .eq('user_id', user.id)
            .single();

        if (signal?.cancelled) return;
        if (business) {
            setBusinessId(business.id);
            setSmsTemplate(business.sms_template || "Sorry we missed you. We'll get back to you shortly.");
            setTimezone(business.timezone || 'America/New_York');

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
        setHours(prev => ({
            ...prev,
            [day]: { ...prev[day], [field]: value }
        }));
    };

    const handleToggleDay = (day: string) => {
        setHours(prev => ({
            ...prev,
            [day]: { ...prev[day], isOpen: !prev[day].isOpen }
        }));
    };

    const handleSave = async () => {
        if (!businessId) return;
        setSaving(true);

        const { error } = await supabase
            .from('businesses')
            .update({
                sms_template: smsTemplate,
                timezone,
                business_hours: hours
            })
            .eq('id', businessId);

        if (error) {
            toast.error('Failed to save settings');
        } else {
            toast.success('Settings saved successfully');
        }
        setSaving(false);
    };

    if (loading) return <div className="p-8">Loading settings...</div>;

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-8">
            <h1 className="text-3xl font-bold">Settings</h1>

            {/* SMS Template Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Smart Response Template</CardTitle>
                    <CardDescription>Customize the message sent to missed calls.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>SMS Template</Label>
                        <Textarea
                            value={smsTemplate}
                            onChange={(e) => setSmsTemplate(e.target.value)}
                            placeholder="Sorry we missed you..."
                            className="h-24"
                        />
                        <p className="text-sm text-gray-500">Use {'{{business_name}}'} as a placeholder.</p>
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
                                        checked={hours[day]?.isOpen}
                                        onCheckedChange={() => handleToggleDay(day)}
                                        aria-label={`Toggle ${day} business hours`}
                                    />
                                    <span className="capitalize font-medium">{day}</span>
                                </div>

                                {hours[day]?.isOpen ? (
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="time"
                                            value={hours[day].open}
                                            onChange={(e) => handleHourChange(day, 'open', e.target.value)}
                                            className="w-32"
                                        />
                                        <span>to</span>
                                        <Input
                                            type="time"
                                            value={hours[day].close}
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

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving} size="lg">
                    {saving ? 'Saving...' : 'Save Changes'}
                </Button>
            </div>
        </div>
    );
}
