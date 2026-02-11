"use client";

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageSquare, Phone, Send, User, Loader2, Menu, AlertCircle, RefreshCw } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';
import { logger } from '@/lib/logger';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';

// Types (should ideally be generated from Supabase)
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

export default function Dashboard() {
    const [searchQuery, setSearchQuery] = useState('');
    const [leads, setLeads] = useState<Lead[]>([]);
    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
    const [replyText, setReplyText] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    const updateStatus = async (status: string) => {
        if (!selectedLead) return;
        const { error } = await supabase.from('leads').update({ status }).eq('id', selectedLead.id);
        if (error) {
            toast.error('Failed to update status');
        } else {
            // Update local state
            setSelectedLead(prev => prev ? { ...prev, status } : null);
            setLeads(prev => prev.map(lead =>
                lead.id === selectedLead.id ? { ...lead, status } : lead
            ));
            toast.success(`Marked as ${status}`);
        }
    };

    // ... (Fetch and Realtime effects same) ...
    // Initial Fetch
    useEffect(() => {
        async function fetchLeads() {
            const { data, error } = await supabase
                .from('leads')
                .select(`*, messages (*)`)
                .order('created_at', { ascending: false });

            if (error) {
                logger.error('Error fetching leads', error);
                setError('Failed to load leads. Please try again.');
            } else {
                setError(null);
                const processedLeads = data?.map(lead => ({
                    ...lead,
                    messages: lead.messages?.sort((a: Message, b: Message) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || []
                })) || [];

                setLeads(processedLeads);
                // On desktop, select first. On mobile, maybe don't? standard behavior: select first.
                if (window.innerWidth >= 768 && processedLeads.length > 0) {
                    setSelectedLead(processedLeads[0]);
                }
            }
            setLoading(false);
        }
        fetchLeads();
    }, [supabase]);

    // ... (Realtime effect same) ...
    // Real-time Subscription
    useEffect(() => {
        const channel = supabase
            .channel('dashboard-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
                console.log('Lead change:', payload);
                if (payload.eventType === 'INSERT') {
                    const newLead = payload.new as Lead;
                    setLeads(prev => [{ ...newLead, messages: [] }, ...prev]);
                    toast.success('New Lead Received!', {
                        description: `Missed call from ${newLead.caller_phone}`,
                        action: {
                            label: 'View',
                            onClick: () => {
                                const leadWithMsgs = { ...newLead, messages: [] };
                                setSelectedLead(leadWithMsgs);
                            }
                        }
                    });
                }
            }
            )
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
                const newMsg = payload.new as Message;
                setLeads(prev => prev.map(lead => {
                    if (lead.id === newMsg.lead_id) {
                        return { ...lead, messages: [...lead.messages, newMsg] };
                    }
                    return lead;
                }));
                if (selectedLead?.id === newMsg.lead_id) {
                    setSelectedLead(prev => prev ? { ...prev, messages: [...prev.messages, newMsg] } : null);
                }
            }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [selectedLead, supabase]);

    const handleSendReply = async () => {
        if (!replyText || !selectedLead) return;
        setSending(true);
        try {
            const res = await fetch('/api/messages/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leadId: selectedLead.id, body: replyText })
            });

            if (!res.ok) throw new Error('Failed to send message');
            setReplyText('');
            toast.success('Message sent!');
        } catch (error) {
            console.error('Error sending message:', error);
            toast.error('Failed to send message.');
        }
        setSending(false);
    };

    const handleSelectLead = (lead: Lead) => {
        setSelectedLead(lead);
        setIsMobileMenuOpen(false);
    };

    if (loading) return <DashboardSkeleton />;

    if (error && leads.length === 0) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-50 p-4">
                <div className="max-w-md w-full text-center space-y-4">
                    <div className="flex justify-center">
                        <div className="rounded-full bg-red-100 p-3">
                            <AlertCircle className="h-8 w-8 text-red-600" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-xl font-bold text-slate-900">Failed to Load Leads</h2>
                        <p className="text-slate-500">{error}</p>
                    </div>
                    <Button onClick={() => { setError(null); setLoading(true); window.location.reload(); }} variant="outline" className="gap-2">
                        <RefreshCw className="h-4 w-4" />
                        Retry
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden flex-col md:flex-row">
            {/* Mobile Header */}
            <div className="md:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between">
                <h1 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                    <div className="bg-blue-600 text-white p-1 rounded">
                        <MessageSquare size={14} fill="currentColor" />
                    </div>
                    LeadCatcher
                </h1>
                <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="icon">
                            <Menu className="h-6 w-6" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="p-0 w-80">
                        {/* Hidden Title for Accessibility */}
                        <div className="sr-only">
                            <SheetTitle>Navigation Menu</SheetTitle>
                        </div>
                        <Sidebar
                            leads={leads}
                            selectedLead={selectedLead}
                            searchQuery={searchQuery}
                            onSearchChange={setSearchQuery}
                            onSelectLead={handleSelectLead}
                        />
                    </SheetContent>
                </Sheet>
            </div>

            {/* Desktop Sidebar */}
            <div className="hidden md:flex w-80 bg-white border-r border-slate-200 flex-col">
                <Sidebar
                    leads={leads}
                    selectedLead={selectedLead}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onSelectLead={handleSelectLead}
                />
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col h-[calc(100vh-65px)] md:h-screen">
                {selectedLead ? (
                    <>
                        {/* Header */}
                        <header className="bg-white border-b border-slate-200 p-4 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                                    <User size={20} />
                                </div>
                                <div>
                                    <h2 className="font-bold text-slate-900">{selectedLead.caller_phone}</h2>
                                    <p className="text-xs text-slate-500">{selectedLead.caller_name || 'Unknown Caller'}</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.open(`tel:${selectedLead.caller_phone}`, '_self')}
                                >
                                    <Phone className="h-4 w-4 mr-2" /> Call
                                </Button>
                                <Select value={selectedLead.status} onValueChange={updateStatus}>
                                    <SelectTrigger className="w-[130px] h-8 text-xs" size="sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="New">New</SelectItem>
                                        <SelectItem value="Contacted">Contacted</SelectItem>
                                        <SelectItem value="Booked">Booked</SelectItem>
                                        <SelectItem value="Closed">Closed</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </header>

                        {/* Messages */}
                        <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50/50 flex flex-col-reverse">
                            <div className="flex-1" />
                            {selectedLead.messages.map(msg => (
                                <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] md:max-w-[70%] p-3 rounded-2xl ${msg.direction === 'outbound' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm'}`}>
                                        <p className="text-sm">{msg.body}</p>
                                        <p className={`text-[10px] mt-1 ${msg.direction === 'outbound' ? 'text-blue-100' : 'text-slate-400'}`}>
                                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                </div>
                            ))}
                            {selectedLead.messages.length === 0 && (
                                <div className="text-center text-slate-400 text-sm py-10">Start the conversation...</div>
                            )}
                        </div>

                        {/* Input */}
                        <div className="p-4 bg-white border-t border-slate-200">
                            <div className="flex gap-2">
                                <div className="flex-1 relative">
                                    <Input
                                        placeholder="Type a message..."
                                        value={replyText}
                                        onChange={(e) => {
                                            const text = e.target.value;
                                            if (text.length <= 1600) {
                                                setReplyText(text);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSendReply();
                                            }
                                        }}
                                        className="pr-16"
                                        maxLength={1600}
                                        aria-label="Type your reply message"
                                    />
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                                        <span className={replyText.length > 1520 ? 'text-orange-500' : ''}>
                                            {replyText.length}/1600
                                        </span>
                                    </div>
                                </div>
                                <Button size="icon" onClick={handleSendReply} disabled={sending || !replyText.trim()}>
                                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                </Button>
                            </div>
                            <p className="text-xs text-slate-400 mt-2 text-center">Reply STOP to opt out.</p>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-400 p-8 text-center">
                        Select a lead to view conversation
                    </div>
                )}
            </div>
        </div>
    );
}
