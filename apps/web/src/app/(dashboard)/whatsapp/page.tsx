'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  QrCode,
  Link2,
  Link2Off,
  Send,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Wifi,
  WifiOff,
  AlertTriangle,
  HelpCircle,
  RotateCcw,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/lib/auth';
import { usePageRole } from '../RoleContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const testMessageSchema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian mobile number'),
  body: z.string().min(1, 'Message body is required'),
});

type TestMessageFormValues = z.infer<typeof testMessageSchema>;

interface WAStatus {
  connected: boolean;
  phone: string | null;
  connecting?: boolean;
  authenticating?: boolean;
}

export default function WhatsAppPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canMutate } = usePageRole();
  const storeToken = useAuthStore((s) => s.accessToken);

  // Local SSE-driven state (source of truth for real-time updates)
  const [liveStatus, setLiveStatus] = React.useState<WAStatus | null>(null);
  const [liveQR, setLiveQR] = React.useState<string | null | undefined>(undefined);
  const [sseConnected, setSseConnected] = React.useState(false);

  const testForm = useForm<TestMessageFormValues>({
    resolver: zodResolver(testMessageSchema),
    defaultValues: { body: 'Hello from TransitOS! This is a secure test connection message.' },
  });

  // ─── SSE: Real-time event stream ──────────────────────────────────────────────
  React.useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL || '';
    const token = storeToken || useAuthStore.getState().accessToken;
    const url = `${base}/whatsapp/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    let es: EventSource;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource(url, { withCredentials: true });

      es.onopen = () => setSseConnected(true);

      es.addEventListener('status', (e) => {
        try {
          const data: WAStatus = JSON.parse(e.data);
          setLiveStatus(data);
          if (data.connected) setLiveQR(null);
          queryClient.setQueryData(['wa-device-status'], data);
        } catch { /* ignore */ }
      });

      es.addEventListener('qr', (e) => {
        try {
          const { qr } = JSON.parse(e.data);
          setLiveQR(qr);
        } catch { /* ignore */ }
      });

      es.onerror = () => {
        setSseConnected(false);
        es.close();
        retryTimeout = setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      clearTimeout(retryTimeout);
      es?.close();
      setSseConnected(false);
    };
  }, [queryClient]);

  // ─── Fallback polling ─────────────────────────────────────────────────────────
  const { data: polledStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['wa-device-status'],
    queryFn: async () => {
      const res = await api.get<{ data: WAStatus }>('/whatsapp/status');
      return res.data.data;
    },
    refetchInterval: (query) => (query.state.data?.connected ? 30000 : 5000),
    select: (data) => {
      if (!liveStatus) setLiveStatus(data);
      return data;
    },
  });

  const { data: polledQR, isLoading: qrLoading } = useQuery({
    queryKey: ['wa-qr-code'],
    queryFn: async () => {
      const res = await api.get<{ data: { qr: string | null } }>('/whatsapp/qr');
      return res.data.data;
    },
    enabled: liveStatus !== null ? !liveStatus.connected : true,
    refetchInterval: () => {
      const connected = liveStatus?.connected ?? polledStatus?.connected ?? false;
      return connected ? false : 8000;
    },
    select: (data) => {
      if (liveQR === undefined && data.qr) setLiveQR(data.qr);
      return data;
    },
  });

  // ─── Derived state ────────────────────────────────────────────────────────────
  const status = liveStatus ?? polledStatus;
  const isConnected = status?.connected ?? false;
  const isConnecting = status?.connecting ?? false;
  const isAuthenticating = status?.authenticating ?? false;
  const displayQR = liveQR !== undefined ? liveQR : polledQR?.qr;

  // ─── Test Message Mutation ────────────────────────────────────────────────────
  const sendTestMutation = useMutation({
    mutationFn: async (values: TestMessageFormValues) => {
      await api.post('/whatsapp/send', values);
    },
    onSuccess: () => {
      toast({ title: 'Message Sent!', description: 'Test WhatsApp notification dispatched.', variant: 'success' as any });
      testForm.reset({ phone: '', body: 'Hello from TransitOS! This is a secure test connection message.' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.error || 'Ensure WhatsApp is online.', variant: 'destructive' });
    },
  });

  // ─── Broadcast Mutation ───────────────────────────────────────────────────────
  const broadcastMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { sent: number; failed: number } }>('/whatsapp/broadcast-unpaid');
      return res.data.data;
    },
    onSuccess: (data) => {
      toast({ title: 'Broadcast Complete', description: `Sent: ${data?.sent ?? '?'}, Failed: ${data?.failed ?? 0}.`, variant: 'success' as any });
    },
    onError: (err: any) => {
      toast({ title: 'Broadcast Failed', description: err.response?.data?.error || 'Failed', variant: 'destructive' });
    },
  });

  // ─── Manual Trigger ───────────────────────────────────────────────────────────
  const [triggerSchool, setTriggerSchool] = React.useState('');
  const [triggerReminderType, setTriggerReminderType] = React.useState('REMINDER_1');
  const [customText, setCustomText] = React.useState('');

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { sentCount: number; failedCount: number } }>('/whatsapp/trigger-reminder', {
        school: triggerSchool,
        reminderType: triggerReminderType,
        customText: customText.trim() || undefined,
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      toast({ title: 'Trigger Complete', description: `Sent: ${data?.sentCount ?? 0}, Failed: ${data?.failedCount ?? 0}`, variant: 'success' as any });
      setCustomText('');
    },
    onError: (err: any) => {
      toast({ title: 'Trigger Failed', description: err.response?.data?.error || 'Failed', variant: 'destructive' });
    },
  });

  const handleManualRefresh = async () => {
    const [statusRes, qrRes] = await Promise.all([
      api.get<{ data: WAStatus }>('/whatsapp/status'),
      api.get<{ data: { qr: string | null } }>('/whatsapp/qr'),
    ]);
    setLiveStatus(statusRes.data.data);
    setLiveQR(qrRes.data.data.qr);
    toast({ title: 'Status Synced', description: 'WhatsApp device state refreshed.' });
  };

  // ─── Status Badge ─────────────────────────────────────────────────────────────
  function StatusBadge() {
    if (isConnected) {
      return (
        <Badge className="bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30 gap-1.5 font-bold">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          Online
        </Badge>
      );
    }
    if (isAuthenticating || isConnecting) {
      return (
        <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 gap-1.5 font-bold">
          <Loader2 className="h-3 w-3 animate-spin" />
          {isAuthenticating ? 'Authenticating…' : 'Connecting…'}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-muted-foreground gap-1.5 font-bold">
        <WifiOff className="h-3 w-3" />
        Offline
      </Badge>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">WhatsApp Gateway</h2>
          <p className="text-sm text-muted-foreground">Pair devices, send broadcasts, and view message logs</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge />
          {!canMutate && (
            <Badge variant="outline" className="text-amber-500 border-amber-500 bg-amber-500/10 font-bold">View Only</Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleManualRefresh} className="gap-2 font-bold">
            <RefreshCw className="h-4 w-4" />
            Sync Status
          </Button>
        </div>
      </div>

      {!sseConnected && (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Real-time stream disconnected — using polling fallback.
        </div>
      )}

      {/* ── Section 1: Device + Test Message ── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Device Connection Card */}
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              {isConnected ? <Link2 className="h-5 w-5 text-green-500" /> : <Link2Off className="h-5 w-5 text-muted-foreground" />}
              Device Connection
            </CardTitle>
            <CardDescription>Pair with WhatsApp Web via QR to enable auto confirmations</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-6 min-h-[320px]">
            {statusLoading && !status ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Syncing gateway logs...</p>
              </div>
            ) : isConnected ? (
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15 text-green-500 shadow-lg shadow-green-500/10">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <div>
                  <h4 className="text-md font-bold text-foreground">Link Established!</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Connected as: <span className="font-mono font-semibold text-primary">+{status?.phone}</span>
                  </p>
                </div>
                <div className="text-xs text-muted-foreground max-w-xs border rounded-lg p-3 bg-muted/20">
                  ✨ Confirmation notifications and due alerts will now be sent automatically. Keep this session active.
                </div>
              </div>
            ) : isAuthenticating ? (
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
                <div>
                  <h4 className="text-md font-bold text-foreground">QR Scanned!</h4>
                  <p className="text-sm text-muted-foreground mt-1">Authenticating with WhatsApp servers…</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center space-y-4 w-full">
                {displayQR ? (
                  <div className="relative group border-2 border-slate-200 dark:border-slate-700 p-3 rounded-2xl bg-white shadow-inner">
                    <img src={displayQR} alt="WhatsApp Pair QR Code" className="h-52 w-52 object-contain" />
                    <div className="absolute inset-0 rounded-2xl group-hover:bg-black/5 transition-colors pointer-events-none" />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10">
                    <QrCode className="h-12 w-12 text-muted-foreground animate-pulse mb-3" />
                    <p className="text-sm font-semibold text-muted-foreground">Generating connection key…</p>
                    <Button size="sm" variant="ghost" onClick={handleManualRefresh} className="mt-4 text-xs font-bold gap-1 text-primary">
                      <RefreshCw className="h-3 w-3" /> Retry
                    </Button>
                  </div>
                )}
                <div className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                  Open WhatsApp → <span className="font-semibold text-foreground">Linked Devices</span> → scan QR.
                  <br />
                  <span className="text-amber-600 dark:text-amber-400 mt-1 block">⚠ QR refreshes every ~60s.</span>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-muted/10 border-t py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <HelpCircle className="h-4 w-4" />
              <span>
                Session persists across restarts via DB.{' '}
                <span className="text-amber-600 dark:text-amber-400 font-medium">Re-scan only needed if session expires.</span>
              </span>
            </div>
          </CardFooter>
        </Card>

        {/* Test Gateway Card */}
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Test Gateway Channel
            </CardTitle>
            <CardDescription>Dispatch a test WhatsApp message to verify the link</CardDescription>
          </CardHeader>
          <form onSubmit={testForm.handleSubmit((values) => sendTestMutation.mutate(values))}>
            <CardContent className="space-y-4 min-h-[320px]">
              {!isConnected && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  WhatsApp must be connected to send messages.
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-xs font-bold text-muted-foreground uppercase">Recipient Mobile (10-Digit)</Label>
                <Input id="phone" placeholder="E.g. 9848022338" className="min-h-[48px] text-base" {...testForm.register('phone')} />
                {testForm.formState.errors.phone && (
                  <p className="text-xs text-red-500">{testForm.formState.errors.phone.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="body" className="text-xs font-bold text-muted-foreground uppercase">Message Body</Label>
                <textarea
                  id="body"
                  rows={6}
                  placeholder="Write test message..."
                  className="w-full p-3 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  {...testForm.register('body')}
                />
                {testForm.formState.errors.body && (
                  <p className="text-xs text-red-500">{testForm.formState.errors.body.message}</p>
                )}
              </div>
            </CardContent>
            <CardFooter className="bg-muted/10 border-t py-4 flex justify-end">
              {canMutate ? (
                <Button type="submit" disabled={!isConnected || sendTestMutation.isPending} className="gap-2 font-bold shadow-md shadow-primary/10">
                  {sendTestMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
                  ) : (
                    <><Send className="h-4 w-4" /> Send Test Message</>
                  )}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground italic">Admin access required to send test messages.</p>
              )}
            </CardFooter>
          </form>
        </Card>
      </div>

      {/* ── Section 2: Broadcast ── */}
      {canMutate && (
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Send className="h-5 w-5 text-blue-500" />
              Broadcast Reminder
            </CardTitle>
            <CardDescription>Send a WhatsApp fee reminder to all unpaid students this month</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isConnected && (
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                WhatsApp must be connected to broadcast.
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Sends a fee reminder to all students whose payment is unpaid or overdue for the current month. Messages are staggered to avoid WhatsApp rate limits.
            </p>
          </CardContent>
          <CardFooter className="bg-muted/10 border-t py-4 flex justify-end">
            <Button
              disabled={!isConnected || broadcastMutation.isPending}
              className="gap-2 font-bold shadow-md shadow-primary/10"
              onClick={() => broadcastMutation.mutate()}
            >
              {broadcastMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
              ) : (
                <><Send className="h-4 w-4" /> Broadcast to All Unpaid</>
              )}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* ── Section 3: Manual School Trigger ── */}
      {canMutate && (
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Wifi className="h-5 w-5 text-indigo-500" />
              Manual School Trigger
            </CardTitle>
            <CardDescription>Manually fire a reminder batch for a specific school now</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isConnected && (
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                WhatsApp must be connected.
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-bold text-muted-foreground uppercase">School</Label>
                <Select onValueChange={setTriggerSchool}>
                  <SelectTrigger className="min-h-[48px] text-sm">
                    <SelectValue placeholder="Select school…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DPS PHASE 2">DPS Phase 2</SelectItem>
                    <SelectItem value="UNICENT">Unicent</SelectItem>
                    <SelectItem value="DPS BRINDAVANAM">DPS Brindavanam</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold text-muted-foreground uppercase">Reminder Type</Label>
                <Select defaultValue="REMINDER_1" onValueChange={setTriggerReminderType}>
                  <SelectTrigger className="min-h-[48px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="REMINDER_1">Reminder 1 (Friendly)</SelectItem>
                    <SelectItem value="REMINDER_2">Reminder 2 (Urgent)</SelectItem>
                    <SelectItem value="FINAL">Final Notice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2 pt-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase">
                Custom Broadcast Message (Optional)
              </Label>
              <textarea
                rows={4}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Enter custom broadcast message. If left blank, the selected Reminder Type template will be sent. Placeholders like {parentName} and {studentName} will be resolved automatically."
                className="w-full p-3 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground/60"
              />
              <p className="text-[10px] text-muted-foreground">
                Note: Messages (including custom broadcasts and standard reminders) are sent only to <strong>unpaid students</strong> of the selected school.
              </p>
            </div>
          </CardContent>
          <CardFooter className="bg-muted/10 border-t py-4 flex justify-end">
            <Button
              disabled={!isConnected || !triggerSchool || triggerMutation.isPending}
              className="gap-2 font-bold shadow-md shadow-primary/10"
              onClick={() => triggerMutation.mutate()}
            >
              {triggerMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Triggering…</>
              ) : (
                <><Send className="h-4 w-4" /> Trigger Now</>
              )}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* ── Section 4: Message Logs ── */}
      <MessageLogsCard queryClient={queryClient} />
    </div>
  );
}

// ─── Message Logs Card ────────────────────────────────────────────────────────────
function MessageLogsCard({ queryClient }: { queryClient: ReturnType<typeof import('@tanstack/react-query').useQueryClient> }) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = React.useState('ALL');
  const [retryingId, setRetryingId] = React.useState<string | null>(null);

  const { data: logs, isLoading } = useQuery({
    queryKey: ['whatsapp-logs', statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      const res = await api.get<{
        data: Array<{
          id: string;
          phone: string;
          type: string;
          status: string;
          body: string;
          createdAt: string;
          student: { name: string } | null;
        }>;
      }>('/whatsapp/logs', { params });
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const retryMutation = useMutation({
    mutationFn: async (logId: string) => {
      setRetryingId(logId);
      await api.post(`/whatsapp/logs/${logId}/retry`);
    },
    onSuccess: () => {
      toast({
        title: 'Message Retried',
        description: 'Message was successfully re-sent via WhatsApp.',
        variant: 'success' as any,
      });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-logs'] });
    },
    onError: (err: any) => {
      toast({
        title: 'Retry Failed',
        description: err.response?.data?.error || 'Could not retry message. Is WhatsApp connected?',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setRetryingId(null);
    },
  });

  const STATUS_COLORS: Record<string, string> = {
    SENT: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    FAILED: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    PENDING: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  };

  return (
    <Card className="border-slate-200 dark:border-slate-800 shadow-md">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            Message Logs
          </CardTitle>
          <CardDescription>Recent WhatsApp messages sent through the system</CardDescription>
        </div>
        <Select defaultValue="ALL" onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="SENT">Sent</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b">
                  {['Date', 'Student', 'Type', 'Phone', 'Status', 'Preview', 'Action'].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs?.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-3 font-semibold text-foreground">{log.student?.name ?? '—'}</td>
                    <td className="py-3 px-3 text-xs font-mono text-muted-foreground">{log.type}</td>
                    <td className="py-3 px-3 text-xs font-mono text-muted-foreground">{log.phone}</td>
                    <td className="py-3 px-3">
                      <Badge className={`border font-bold text-[10px] uppercase ${STATUS_COLORS[log.status] ?? ''}`}>
                        {log.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 max-w-[180px]">
                      <p className="text-xs text-muted-foreground truncate" title={log.body}>{log.body}</p>
                    </td>
                    <td className="py-3 px-3">
                      {log.status === 'FAILED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 gap-1.5 text-[11px] font-bold border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30 disabled:opacity-50"
                          disabled={retryingId === log.id}
                          onClick={() => retryMutation.mutate(log.id)}
                          title="Retry sending this message"
                        >
                          {retryingId === log.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          {retryingId === log.id ? 'Sending…' : 'Retry'}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {(!logs || logs.length === 0) && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30 stroke-1" />
                      No messages found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
