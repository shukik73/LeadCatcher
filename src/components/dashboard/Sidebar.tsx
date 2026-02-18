"use client";

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, MessageSquare, Settings, LogOut, Phone, Wrench, CreditCard } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';

interface Lead {
    id: string;
    caller_phone: string;
    caller_name: string | null;
    status: string;
    source?: string;
    created_at: string;
    business_id: string;
    messages: Message[];
}

interface Message {
    id: string;
    direction: 'inbound' | 'outbound';
    body: string;
    created_at: string;
    lead_id: string;
}

interface SidebarProps {
    leads: Lead[];
    selectedLead: Lead | null;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onSelectLead: (lead: Lead) => void;
}

export function Sidebar({
    leads,
    selectedLead,
    searchQuery,
    onSearchChange,
    onSelectLead,
}: SidebarProps) {
    const router = useRouter();
    const supabase = createSupabaseBrowserClient();

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.push('/login');
    };

    const filteredLeads = leads.filter(lead =>
        (lead.caller_name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
        lead.caller_phone.includes(searchQuery) ||
        lead.messages.some(m => m.body.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b border-slate-100">
                <h1 className="font-bold text-xl text-slate-800 flex items-center gap-2">
                    <div className="bg-blue-600 text-white p-1 rounded">
                        <MessageSquare size={14} fill="currentColor" />
                    </div>
                    LeadCatcher
                </h1>
            </div>
            <div className="p-4">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                        placeholder="Search leads..."
                        className="pl-9 bg-slate-50"
                        value={searchQuery}
                        aria-label="Search leads by name, phone, or message content"
                        onChange={(e) => onSearchChange(e.target.value)}
                    />
                </div>
            </div>
            <div className="flex-1 overflow-y-auto" role="listbox" aria-label="Lead list">
                {filteredLeads.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-sm">No leads match your search.</div>
                ) : (
                    filteredLeads.map(lead => (
                        <div
                            key={lead.id}
                            onClick={() => onSelectLead(lead)}
                            role="option"
                            aria-selected={selectedLead?.id === lead.id}
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onSelectLead(lead);
                                }
                            }}
                            className={`p-4 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors ${selectedLead?.id === lead.id ? 'bg-blue-50/50 border-l-4 border-l-blue-600' : 'border-l-4 border-l-transparent'}`}
                        >
                            <div className="flex justify-between mb-1">
                                <span className="font-semibold text-slate-900">{lead.caller_name || lead.caller_phone}</span>
                                <span className="text-xs text-slate-400">{formatDistanceToNow(new Date(lead.created_at))}</span>
                            </div>
                            <p className="text-sm text-slate-500 truncate">
                                {lead.messages.length > 0 ? lead.messages[lead.messages.length - 1].body : 'Missed Call'}
                            </p>
                            <div className="mt-2 flex gap-2">
                                <Badge variant="secondary" className="text-xs">{lead.status}</Badge>
                                {lead.source === 'repairdesk' && (
                                    <Badge variant="outline" className="text-xs gap-1">
                                        <Wrench className="h-3 w-3" />
                                        RepairDesk
                                    </Badge>
                                )}
                                {(!lead.source || lead.source === 'phone') && (
                                    <Badge variant="outline" className="text-xs gap-1">
                                        <Phone className="h-3 w-3" />
                                        Call
                                    </Badge>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>
            {/* Footer with Settings and Sign Out */}
            <div className="p-4 border-t border-slate-100 space-y-2">
                <Button
                    variant="ghost"
                    className="w-full justify-start text-slate-600 hover:text-slate-900"
                    onClick={() => router.push('/dashboard/settings')}
                >
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                </Button>
                <Button
                    variant="ghost"
                    className="w-full justify-start text-slate-600 hover:text-slate-900"
                    onClick={() => router.push('/dashboard/billing')}
                >
                    <CreditCard className="h-4 w-4 mr-2" />
                    Billing
                </Button>
                <Button
                    variant="ghost"
                    className="w-full justify-start text-slate-600 hover:text-red-600"
                    onClick={handleSignOut}
                >
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                </Button>
            </div>
        </div>
    );
}
