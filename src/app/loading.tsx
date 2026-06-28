import { Loader2 } from 'lucide-react';

export default function Loading() {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-muted">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
    );
}
