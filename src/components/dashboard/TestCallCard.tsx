"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, CheckCircle2, AlertCircle, PhoneCall } from 'lucide-react';

/**
 * Test Call card for the Settings page.
 *
 * Mirrors the onboarding wizard's verification flow so the dashboard empty-state
 * CTAs ("Run Test Call" / "Activate Forwarding"), which route here, land on a
 * working control. POSTs /api/verify to place the call, then polls GET /api/verify
 * until the voice webhook confirms the forwarded call (verified = true).
 */
export function TestCallCard({ isConnected }: { isConnected: boolean }) {
    const [verified, setVerified] = useState(false);
    const [calling, setCalling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollCountRef = useRef(0);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        pollCountRef.current = 0;
    }, []);

    // Reflect current verification status on mount.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/verify');
                const data = await res.json();
                if (!cancelled && data.verified) setVerified(true);
            } catch {
                // Non-fatal — leave as unverified.
            }
        })();
        return () => { cancelled = true; stopPolling(); };
    }, [stopPolling]);

    const runTestCall = async () => {
        setCalling(true);
        setError(null);
        try {
            const res = await fetch('/api/verify', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                pollCountRef.current = 0;
                pollRef.current = setInterval(async () => {
                    pollCountRef.current++;
                    try {
                        const pollRes = await fetch('/api/verify');
                        const pollData = await pollRes.json();
                        if (pollData.verified) {
                            setVerified(true);
                            setCalling(false);
                            stopPolling();
                        } else if (pollCountRef.current >= 15) {
                            setCalling(false);
                            setError('Verification timed out. Make sure you declined/ignored the call so it forwarded to your LeadCatcher number, then try again.');
                            stopPolling();
                        }
                    } catch {
                        // Ignore individual poll failures.
                    }
                }, 2000);
            } else {
                setError(data.error || 'Failed to initiate test call');
                setCalling(false);
            }
        } catch {
            setError('Failed to connect to server. Please try again.');
            setCalling(false);
        }
    };

    return (
        <Card id="test-call">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <PhoneCall className="h-5 w-5" />
                    Test Call Forwarding
                </CardTitle>
                <CardDescription>
                    Place a test missed call to confirm calls reach LeadCatcher.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {verified ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm text-green-800 font-medium">Forwarding verified</p>
                            <p className="text-sm text-green-600 mt-1">
                                Missed calls are being captured automatically. You can re-run the test anytime.
                            </p>
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-slate-600">
                        We&apos;ll ring your business phone. <strong>Decline or ignore it</strong> so the
                        call forwards to your LeadCatcher number — that proves forwarding works.
                    </p>
                )}

                {!isConnected && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-700">
                            Connect your phone in the section above before running a test call.
                        </p>
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-600">{error}</p>
                    </div>
                )}

                <Button
                    onClick={runTestCall}
                    disabled={calling || !isConnected}
                    variant={verified ? 'outline' : 'default'}
                    className={verified ? undefined : 'bg-blue-600 hover:bg-blue-700'}
                >
                    {calling ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Calling… decline it to test
                        </>
                    ) : (
                        <>
                            <PhoneCall className="mr-2 h-4 w-4" />
                            {verified ? 'Re-run Test Call' : 'Run Test Call'}
                        </>
                    )}
                </Button>
            </CardContent>
        </Card>
    );
}
