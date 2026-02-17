'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log error (in production, this would send to Sentry/error tracking)
        logger.error('Application error occurred', error);
    }, [error]);

    return (
        <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-slate-50 p-4">
            <div className="max-w-md w-full text-center space-y-4">
                <div className="flex justify-center">
                    <div className="rounded-full bg-red-100 p-3">
                        <AlertCircle className="h-8 w-8 text-red-600" />
                    </div>
                </div>
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-slate-900">Something went wrong!</h2>
                    <p className="text-slate-500">
                        We apologize for the inconvenience. An unexpected error occurred.
                    </p>
                    {process.env.NODE_ENV === 'development' && error.message && (
                        <p className="text-xs text-slate-400 font-mono bg-slate-100 p-2 rounded mt-2">
                            {error.message}
                        </p>
                    )}
                </div>
                <div className="flex gap-2 justify-center">
                    <Button onClick={() => reset()} variant="outline" className="gap-2">
                        <RefreshCw className="h-4 w-4" />
                        Try again
                    </Button>
                    <Button onClick={() => window.location.assign('/')} variant="ghost">
                        Go home
                    </Button>
                </div>
            </div>
        </div>
    );
}
