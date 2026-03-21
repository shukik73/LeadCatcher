"use client";

import { useState } from 'react';
import { CheckCircle2, XCircle, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ForwardingStatusProps {
    isConnected: boolean;
    forwardingNumber: string;
    carrier: string;
    formatPhoneDisplay: (phone: string) => string;
}

export function ForwardingStatus({ isConnected, forwardingNumber, carrier, formatPhoneDisplay }: ForwardingStatusProps) {
    const [copied, setCopied] = useState(false);

    const dialCode = carrier === 'Verizon' ? '*71' : '*72';
    const fullDialCode = `${dialCode}${forwardingNumber.replace(/\D/g, '')}`;

    const handleCopy = async () => {
        await navigator.clipboard.writeText(fullDialCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (isConnected) {
        return (
            <div className="rounded-lg border-2 border-green-200 bg-green-50 p-5 space-y-3">
                <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                    <span className="font-semibold text-green-800 text-lg">Forwarding Active</span>
                </div>
                <p className="text-sm text-green-700">
                    Missed calls to your business line are forwarded to {formatPhoneDisplay(forwardingNumber)}.
                </p>
                {carrier && (
                    <div className="bg-white rounded-lg border border-green-200 p-4 space-y-2">
                        <p className="text-sm text-slate-600">
                            Dial this code from your business line to enable forwarding:
                        </p>
                        <div className="flex items-center gap-2">
                            <code className="text-lg font-mono font-bold text-slate-900 bg-slate-100 px-3 py-1.5 rounded">
                                {fullDialCode}
                            </code>
                            <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
                                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                                {copied ? 'Copied' : 'Copy'}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="rounded-lg border-2 border-red-200 bg-red-50 p-5">
            <div className="flex items-center gap-2">
                <XCircle className="h-6 w-6 text-red-500" />
                <span className="font-semibold text-red-800 text-lg">Forwarding Not Active</span>
            </div>
            <p className="text-sm text-red-600 mt-2">
                Connect your business phone to start capturing missed calls.
            </p>
        </div>
    );
}
