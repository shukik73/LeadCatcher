'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Dashboard error:', error);
    }, [error]);

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center">
            <AlertTriangle className="h-10 w-10 text-red-400 mb-4" />
            <h2 className="text-lg font-semibold text-slate-800 mb-2">Something went wrong</h2>
            <p className="text-sm text-slate-500 mb-4 max-w-md">
                An error occurred while loading this page. This might be a temporary issue.
            </p>
            <Button onClick={reset} variant="outline">
                Try again
            </Button>
        </div>
    );
}
