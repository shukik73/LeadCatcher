"use client";

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Loader2,
    RefreshCw,
    ListTodo,
    CheckCircle,
    Phone,
    User,
    ArrowUp,
    ArrowRight,
    ArrowDown,
    XCircle,
    PlayCircle,
} from 'lucide-react';
import { toast } from 'sonner';

interface ActionItem {
    id: string;
    title: string;
    description: string | null;
    action_type: string;
    priority: string;
    status: string;
    assigned_role: string;
    assigned_to: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    source: string;
    rd_synced_at: string | null;
    completed_at: string | null;
    created_at: string;
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    high: { label: 'High', color: 'bg-red-100 text-red-700 border-red-200', icon: ArrowUp },
    medium: { label: 'Medium', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: ArrowRight },
    low: { label: 'Low', color: 'bg-green-100 text-green-700 border-green-200', icon: ArrowDown },
};

const TYPE_LABELS: Record<string, string> = {
    callback: 'Callback',
    follow_up: 'Follow Up',
    repair_update: 'Repair Update',
    quote_needed: 'Quote Needed',
    escalation: 'Escalation',
    info: 'Info',
};

const ROLE_LABELS: Record<string, string> = {
    owner: 'Owner',
    tech: 'Tech',
    front_desk: 'Front Desk',
};

export default function ActionsPage() {
    const [items, setItems] = useState<ActionItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 0 });
    const [statusFilter, setStatusFilter] = useState('pending');
    const [priorityFilter, setPriorityFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState('all');
    const [roleFilter, setRoleFilter] = useState('all');
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    const fetchItems = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('page', page.toString());
            params.set('limit', '25');
            if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
            if (priorityFilter && priorityFilter !== 'all') params.set('priority', priorityFilter);
            if (typeFilter && typeFilter !== 'all') params.set('action_type', typeFilter);
            if (roleFilter && roleFilter !== 'all') params.set('assigned_role', roleFilter);

            const res = await fetch(`/api/action-items/list?${params.toString()}`);
            const data = await res.json();

            if (data.success) {
                // Sort client-side: high > medium > low priority
                const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
                const sorted = [...(data.items || [])].sort((a: ActionItem, b: ActionItem) => {
                    const pa = priorityOrder[a.priority] ?? 1;
                    const pb = priorityOrder[b.priority] ?? 1;
                    return pa - pb;
                });
                setItems(sorted);
                setPagination(data.pagination);
            } else {
                toast.error(data.error || 'Failed to load actions');
            }
        } catch {
            toast.error('Failed to load actions');
        } finally {
            setLoading(false);
        }
    }, [statusFilter, priorityFilter, typeFilter, roleFilter]);

    useEffect(() => {
        fetchItems(1);
    }, [fetchItems]);

    const updateItem = async (id: string, updates: Record<string, string>) => {
        setUpdatingId(id);
        try {
            const res = await fetch('/api/action-items/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, ...updates }),
            });
            const data = await res.json();
            if (data.success) {
                toast.success('Updated');
                fetchItems(pagination.page);
            } else {
                toast.error(data.error || 'Failed to update');
            }
        } catch {
            toast.error('Failed to update');
        } finally {
            setUpdatingId(null);
        }
    };

    // Count pending items
    const pendingCount = items.filter(i => i.status === 'pending').length;
    const highCount = items.filter(i => i.priority === 'high' && i.status === 'pending').length;

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-[1200px]">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ListTodo className="h-5 w-5 text-blue-600" />
                    <h1 className="text-xl font-bold text-slate-800">Action List</h1>
                    {pendingCount > 0 && (
                        <Badge variant="secondary" className="ml-2">
                            {pendingCount} pending
                        </Badge>
                    )}
                    {highCount > 0 && (
                        <Badge variant="destructive" className="ml-1">
                            {highCount} urgent
                        </Badge>
                    )}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchItems(pagination.page)}
                    disabled={loading}
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                    <SelectTrigger className="w-[130px] h-8 text-xs">
                        <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Priorities</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-[150px] h-8 text-xs">
                        <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="callback">Callback</SelectItem>
                        <SelectItem value="follow_up">Follow Up</SelectItem>
                        <SelectItem value="repair_update">Repair Update</SelectItem>
                        <SelectItem value="quote_needed">Quote Needed</SelectItem>
                        <SelectItem value="escalation">Escalation</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue placeholder="Assigned To" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="tech">Tech</SelectItem>
                        <SelectItem value="front_desk">Front Desk</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Action Items List */}
            {loading && items.length === 0 ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
            ) : items.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <ListTodo className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                        <p className="text-sm text-slate-500">No action items found</p>
                        <p className="text-xs text-slate-400 mt-1">AI-generated actions will appear here after call reviews</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {items.map((item) => {
                        const priorityConf = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
                        const PriorityIcon = priorityConf.icon;
                        const isUpdating = updatingId === item.id;

                        return (
                            <Card key={item.id} className={item.status === 'completed' ? 'opacity-60' : ''}>
                                <CardContent className="py-3 px-4">
                                    <div className="flex items-start gap-3">
                                        {/* Priority indicator */}
                                        <div className={`mt-0.5 flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${priorityConf.color}`}>
                                            <PriorityIcon className="h-3 w-3" />
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="text-sm font-medium text-slate-800 truncate">
                                                    {item.title}
                                                </h3>
                                                <Badge variant="outline" className="text-[10px] shrink-0">
                                                    {TYPE_LABELS[item.action_type] || item.action_type}
                                                </Badge>
                                                <Badge variant="outline" className="text-[10px] shrink-0">
                                                    {ROLE_LABELS[item.assigned_role] || item.assigned_role}
                                                </Badge>
                                            </div>

                                            {item.description && (
                                                <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                                                    {item.description}
                                                </p>
                                            )}

                                            <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                                                {item.customer_name && (
                                                    <span className="flex items-center gap-1">
                                                        <User className="h-3 w-3" />
                                                        {item.customer_name}
                                                    </span>
                                                )}
                                                {item.customer_phone && (
                                                    <span className="flex items-center gap-1">
                                                        <Phone className="h-3 w-3" />
                                                        {item.customer_phone}
                                                    </span>
                                                )}
                                                <span>
                                                    {new Date(item.created_at).toLocaleString()}
                                                </span>
                                                {item.rd_synced_at && (
                                                    <span className="text-green-500">RD Synced</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-1 shrink-0">
                                            {item.status === 'pending' && (
                                                <>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 text-xs"
                                                        disabled={isUpdating}
                                                        onClick={() => updateItem(item.id, { status: 'in_progress' })}
                                                        title="Start"
                                                    >
                                                        {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 text-xs text-green-600 hover:text-green-700"
                                                        disabled={isUpdating}
                                                        onClick={() => updateItem(item.id, { status: 'completed' })}
                                                        title="Complete"
                                                    >
                                                        <CheckCircle className="h-3 w-3" />
                                                    </Button>
                                                </>
                                            )}
                                            {item.status === 'in_progress' && (
                                                <>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 text-xs text-green-600 hover:text-green-700"
                                                        disabled={isUpdating}
                                                        onClick={() => updateItem(item.id, { status: 'completed' })}
                                                        title="Complete"
                                                    >
                                                        <CheckCircle className="h-3 w-3" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 text-xs text-slate-400 hover:text-red-600"
                                                        disabled={isUpdating}
                                                        onClick={() => updateItem(item.id, { status: 'cancelled' })}
                                                        title="Cancel"
                                                    >
                                                        <XCircle className="h-3 w-3" />
                                                    </Button>
                                                </>
                                            )}
                                            {item.status === 'completed' && (
                                                <CheckCircle className="h-4 w-4 text-green-500" />
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-slate-500">
                        Page {pagination.page} of {pagination.totalPages} ({pagination.total} items)
                    </span>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.page <= 1}
                            onClick={() => fetchItems(pagination.page - 1)}
                        >
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.page >= pagination.totalPages}
                            onClick={() => fetchItems(pagination.page + 1)}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
