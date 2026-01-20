import Wizard from '@/components/onboarding/Wizard';
import { MessageSquare } from 'lucide-react';

export default function OnboardingPage() {
    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4">
            <div className="w-full max-w-2xl flex items-center gap-2 mb-10">
                <div className="bg-blue-600 text-white p-1.5 rounded-md">
                    <MessageSquare size={16} fill="currentColor" />
                </div>
                <span className="font-bold text-slate-900">LeadCatcher Setup</span>
            </div>

            <Wizard />
        </div>
    );
}
