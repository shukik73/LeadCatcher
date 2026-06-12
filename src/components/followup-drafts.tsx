"use client";

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Send, SkipForward, Pencil, Sparkles, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

interface FollowUpDraft {
    id: string;
    customer_name: string | null;
    customer_phone: string;
    reason: string | null;
    draft_sms: string;
    ai_generated: boolean;
    created_at: string;
}

/**
 * Owner-approval queue for AI-drafted follow-up SMS.
 * Nothing here sends automatically — every message needs a tap.
 */
export function FollowUpDrafts() {
    const [drafts, setDrafts] = useState<FollowUpDraft[]>([]);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [generating, setGenerating] = useState(false);

    const fetchDrafts = useCallback(async () => {
        try {
            const res = await fetch('/api/followups/drafts');
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) setDrafts(data.drafts || []);
        } catch {
            // Non-fatal: the section just stays empty
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDrafts();
    }, [fetchDrafts]);

    const generate = async () => {
        setGenerating(true);
        try {
            const res = await fetch('/api/followups/generate', { method: 'POST' });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                toast.success(
                    data.created > 0
                        ? `${data.created} follow-up draft${data.created === 1 ? '' : 's'} ready`
                        : 'No new follow-ups to draft right now',
                );
                await fetchDrafts();
            } else {
                toast.error(data?.error || 'Could not generate drafts');
            }
        } catch {
            toast.error('Could not generate drafts');
        } finally {
            setGenerating(false);
        }
    };

    const act = async (id: string, action: 'approve' | 'skip', sms?: string) => {
        setActing(id);
        try {
            const res = await fetch(`/api/followups/drafts/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...(sms ? { sms } : {}) }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                toast.success(action === 'approve' ? 'Follow-up sent' : 'Skipped');
                setDrafts((prev) => prev.filter((d) => d.id !== id));
                setEditingId(null);
            } else {
                toast.error(data?.error || `${action} failed`);
            }
        } catch {
            toast.error(`${action} failed`);
        } finally {
            setActing(null);
        }
    };

    if (loading) return null;

    const GenerateButton = (
        <Button size="sm" variant="outline" onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            <span className="ml-1">Find follow-ups now</span>
        </Button>
    );

    // Empty state still shows the on-demand trigger so the owner can pull
    // drafts between the 9am/1pm/6pm digests.
    if (drafts.length === 0) {
        return (
            <Card className="border-slate-200">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div>
                        <h2 className="font-semibold text-slate-800 text-sm">No follow-up drafts right now</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Chase customers who asked about a repair or sale but never came in.
                        </p>
                    </div>
                    {GenerateButton}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-amber-600" />
                        <h2 className="font-semibold text-slate-800">
                            Drafted follow-ups — your approval needed ({drafts.length})
                        </h2>
                    </div>
                    {GenerateButton}
                </div>
                <p className="text-xs text-slate-500 -mt-2">
                    Customers who talked about a repair or sale but never came in. Review each text — nothing sends without you.
                </p>

                {drafts.map((draft) => (
                    <div key={draft.id} className="rounded-lg border bg-white p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium text-slate-800">
                                {draft.customer_name || 'Unknown customer'}
                                <span className="ml-2 text-xs font-normal text-slate-500">{draft.customer_phone}</span>
                            </div>
                            {!draft.ai_generated && (
                                <Badge variant="outline" className="text-xs">generic draft</Badge>
                            )}
                        </div>
                        {draft.reason && (
                            <p className="text-xs text-slate-500 italic">{draft.reason}</p>
                        )}

                        {editingId === draft.id ? (
                            <Textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                maxLength={320}
                                rows={3}
                                className="text-sm"
                            />
                        ) : (
                            <p className="text-sm text-slate-700 rounded bg-slate-50 p-2">{draft.draft_sms}</p>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <Button
                                size="sm"
                                disabled={acting === draft.id}
                                onClick={() => act(
                                    draft.id,
                                    'approve',
                                    editingId === draft.id ? editText.trim() : undefined,
                                )}
                            >
                                {acting === draft.id
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <Send className="h-3.5 w-3.5" />}
                                <span className="ml-1">Approve &amp; send</span>
                            </Button>
                            {editingId === draft.id ? (
                                <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                                    Cancel edit
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => { setEditingId(draft.id); setEditText(draft.draft_sms); }}
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                    <span className="ml-1">Edit</span>
                                </Button>
                            )}
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={acting === draft.id}
                                onClick={() => act(draft.id, 'skip')}
                            >
                                <SkipForward className="h-3.5 w-3.5" />
                                <span className="ml-1">Skip</span>
                            </Button>
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
