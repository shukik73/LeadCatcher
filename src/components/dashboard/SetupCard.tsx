"use client";

import { useState, useEffect, useMemo } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, Circle, Phone, MessageSquare, PhoneCall, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface SetupState {
    phoneConnected: boolean;
    autoReplyEnabled: boolean;
    testCallDone: boolean;
}

const STEPS = [
    { key: 'phoneConnected', label: 'Connect business phone forwarding', icon: Phone },
    { key: 'autoReplyEnabled', label: 'Enable missed-call auto-reply', icon: MessageSquare },
    { key: 'testCallDone', label: 'Place a test missed call', icon: PhoneCall },
] as const;

export function SetupCard() {
    const [setup, setSetup] = useState<SetupState>({
        phoneConnected: false,
        autoReplyEnabled: false,
        testCallDone: false,
    });
    const [loading, setLoading] = useState(true);
    const [dismissed, setDismissed] = useState(false);
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);
    const router = useRouter();

    useEffect(() => {
        async function checkSetup() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { setLoading(false); return; }

            const { data: business } = await supabase
                .from('businesses')
                .select('forwarding_number, sms_template, verified')
                .eq('user_id', user.id)
                .single();

            if (business) {
                setSetup({
                    phoneConnected: !!business.forwarding_number,
                    autoReplyEnabled: !!business.sms_template,
                    testCallDone: !!business.verified,
                });
            }
            setLoading(false);
        }
        checkSetup();
    }, [supabase]);

    const completedCount = [setup.phoneConnected, setup.autoReplyEnabled, setup.testCallDone].filter(Boolean).length;
    const allComplete = completedCount === 3;
    const percent = Math.round((completedCount / 3) * 100);

    if (loading || dismissed) return null;
    if (allComplete) {
        return (
            <Card className="border-green-200 bg-green-50 mx-4 mt-4 md:mx-6">
                <CardContent className="py-4 flex items-center gap-3">
                    <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="font-semibold text-green-800">LeadCatcher is Live</p>
                        <p className="text-sm text-green-600">Missed calls will be captured automatically.</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setDismissed(true)} className="text-green-600">
                        Dismiss
                    </Button>
                </CardContent>
            </Card>
        );
    }

    const nextStep = !setup.phoneConnected ? 'phoneConnected'
        : !setup.autoReplyEnabled ? 'autoReplyEnabled'
        : 'testCallDone';

    const handleContinue = () => {
        if (nextStep === 'phoneConnected' || nextStep === 'autoReplyEnabled') {
            router.push('/dashboard/settings');
        } else {
            router.push('/dashboard/settings');
        }
    };

    return (
        <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-white mx-4 mt-4 md:mx-6">
            <CardContent className="py-5 space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 text-lg">Get Live in 3 Steps</h3>
                    <span className="text-sm font-medium text-blue-600">{percent}% complete</span>
                </div>

                {/* Progress bar */}
                <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-500"
                        style={{ width: `${percent}%` }}
                    />
                </div>

                {/* Steps */}
                <div className="space-y-3">
                    {STEPS.map((step) => {
                        const done = setup[step.key];
                        return (
                            <div key={step.key} className="flex items-center gap-3">
                                {done ? (
                                    <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                                ) : (
                                    <Circle className="h-5 w-5 text-slate-300 flex-shrink-0" />
                                )}
                                <step.icon className={`h-4 w-4 flex-shrink-0 ${done ? 'text-green-500' : 'text-slate-400'}`} />
                                <span className={`text-sm ${done ? 'text-slate-500 line-through' : 'text-slate-700 font-medium'}`}>
                                    {step.label}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <Button onClick={handleContinue} className="bg-blue-600 hover:bg-blue-700 gap-2">
                    Continue Setup
                    <ArrowRight className="h-4 w-4" />
                </Button>
            </CardContent>
        </Card>
    );
}
