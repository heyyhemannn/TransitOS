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
  AlertCircle,
  HelpCircle,
  Wifi,
  WifiOff,
  AlertTriangle,
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
import { usePageRole } from '../layout';

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

  // Local SSE-driven state (source of truth for real-time updates)
  const [liveStatus, setLiveStatus] = React.useState<WAStatus | null>(null);
  const [liveQR, setLiveQR] = React.useState<string | null | undefined>(undefined); // undefined = not yet loaded
  const [sseConnected, setSseConnected] = React.useState(false);

  const testForm = useForm<TestMessageFormValues>({
    resolver: zodResolver(testMessageSchema),
    defaultValues: {
      body: 'Hello from TransitOS! This is a secure test connection message.',
    },
  });

  // ─── SSE: Real-time event stream ──────────────────────────────────────────
  React.useEffect(() => {
    // Build the SSE URL using the same base as the API
    const base = process.env.NEXT_PUBLIC_API_URL || '';
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
        : null;

    // EventSource does not support custom headers natively.
    // We use a URL query param to pass the token for the SSE connection.
    // The backend should accept ?token= for SSE routes.
    // As a fallback, we still rely on cookie-based auth if JWT is in cookie.
    const url = `${base}/whatsapp/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    let es: EventSource;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource(url, { withCredentials: true });

      es.onopen = () => {
        setSseConnected(true);
      };

      es.addEventListener('status', (e) => {
        try {
          const data: WAStatus = JSON.parse(e.data);
          setLiveStatus(data);
          // If now connected, clear the QR
          if (data.connected) {
            setLiveQR(null);
          }
          // Invalidate the polling cache too so other components stay in sync
          queryClient.setQueryData(['wa-device-status'], data);
        } catch {
          // ignore parse errors
        }
      });

      es.addEventListener('qr', (e) => {
        try {
          const { qr } = JSON.parse(e.data);
          setLiveQR(qr);
        } catch {
          // ignore parse errors
        }
      });

      es.onerror = () => {
        setSseConnected(false);
        es.close();
        // Auto-reconnect after 5s
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

  // ─── Fallback polling (backs up SSE for initial load & token refresh) ─────
  const { data: polledStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['wa-device-status'],
    queryFn: async () => {
      const res = await api.get<{ data: WAStatus }>('/whatsapp/status');
      return res.data.data;
    },
    // Poll every 5s when offline, 30s when online — SSE takes over in real-time
    refetchInterval: (query) => (query.state.data?.connected ? 30000 : 5000),
    // On first load set live state
    select: (data) => {
      if (!liveStatus) setLiveStatus(data);
      return data;
    },
  });

  // Fallback QR polling (SSE handles real-time, this is backup)
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
      // Only update liveQR from poll if SSE hasn't provided a value yet
      if (liveQR === undefined && data.qr) {
        setLiveQR(data.qr);
      }
      return data;
    },
  });

  // ─── Derived state ─────────────────────────────────────────────────────────
  const status = liveStatus ?? polledStatus;
  const isConnected = status?.connected ?? false;
  const isConnecting = status?.connecting ?? false;
  const isAuthenticating = status?.authenticating ?? false;
  const displayQR = liveQR !== undefined ? liveQR : polledQR?.qr;

  // ─── Test Message Mutation ─────────────────────────────────────────────────
  const sendTestMutation = useMutation({
    mutationFn: async (values: TestMessageFormValues) => {
      await api.post('/whatsapp/send', values);
    },
    onSuccess: () => {
      toast({
        title: 'Message Sent!',
        description: 'Test WhatsApp notification successfully dispatched.',
        variant: 'success',
      });
      testForm.reset({
        phone: '',
        body: 'Hello from TransitOS! This is a secure test connection message.',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to send',
        description:
          err.response?.data?.error ||
          'Ensure WhatsApp client is online and number is active.',
        variant: 'destructive',
      });
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

  // ─── Connection status badge ───────────────────────────────────────────────
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
          <p className="text-sm text-muted-foreground">
            Pair devices, check connection status, and send tests
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge />
          {!canMutate && (
            <Badge
              variant="outline"
              className="text-amber-500 border-amber-500 bg-amber-500/10 font-bold"
            >
              View Only
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            className="gap-2 font-bold"
          >
            <RefreshCw className="h-4 w-4" />
            Sync Status
          </Button>
        </div>
      </div>

      {/* SSE connection indicator */}
      {!sseConnected && (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Real-time stream disconnected — using polling fallback. Status will update every 5 seconds.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* ── Device Connection Card ── */}
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              {isConnected ? (
                <Link2 className="h-5 w-5 text-green-500" />
              ) : (
                <Link2Off className="h-5 w-5 text-muted-foreground" />
              )}
              Device Connection
            </CardTitle>
            <CardDescription>
              Pair with WhatsApp Web via QR to enable auto confirmations
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col items-center justify-center py-6 min-h-[320px]">
            {statusLoading && !status ? (
              /* Initial load */
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Syncing driver gateway logs...</p>
              </div>
            ) : isConnected ? (
              /* Connected state */
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15 text-green-500 shadow-lg shadow-green-500/10">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <div>
                  <h4 className="text-md font-bold text-foreground">Link Established!</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Connected as:{' '}
                    <span className="font-mono font-semibold text-primary">
                      +{status?.phone}
                    </span>
                  </p>
                </div>
                <div className="text-xs text-muted-foreground max-w-xs border rounded-lg p-3 bg-muted/20">
                  ✨ Confirmation notifications and due alerts will now be sent automatically.
                  Keep this session active.
                </div>
              </div>
            ) : isAuthenticating ? (
              /* Scanned — waiting for ready event */
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
                <div>
                  <h4 className="text-md font-bold text-foreground">QR Scanned!</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Authenticating with WhatsApp servers…
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">This usually takes 5–15 seconds.</p>
              </div>
            ) : (
              /* Offline — show QR or generating spinner */
              <div className="flex flex-col items-center text-center space-y-4 w-full">
                {displayQR ? (
                  <div className="relative group border-2 border-slate-200 dark:border-slate-700 p-3 rounded-2xl bg-white shadow-inner">
                    <img
                      src={displayQR}
                      alt="WhatsApp Pair QR Code"
                      className="h-52 w-52 object-contain"
                    />
                    <div className="absolute inset-0 rounded-2xl group-hover:bg-black/5 transition-colors pointer-events-none" />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10">
                    <QrCode className="h-12 w-12 text-muted-foreground animate-pulse mb-3" />
                    <p className="text-sm font-semibold text-muted-foreground">
                      Generating connection key…
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
                      Establishing secure bridge to WhatsApp Web servers.
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleManualRefresh}
                      className="mt-4 text-xs font-bold gap-1 text-primary"
                    >
                      <RefreshCw className="h-3 w-3" /> Retry
                    </Button>
                  </div>
                )}

                <div className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                  Open WhatsApp on your mobile →{' '}
                  <span className="font-semibold text-foreground">Linked Devices</span> → scan QR.
                  <br />
                  <span className="text-amber-600 dark:text-amber-400 mt-1 block">
                    ⚠ QR expires in ~20s. The page will auto-refresh it.
                  </span>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="bg-muted/10 border-t py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <HelpCircle className="h-4 w-4" />
              <span>
                Gateway runs in isolated Chromium threads.{' '}
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  Re-deploying the server will require re-scanning.
                </span>
              </span>
            </div>
          </CardFooter>
        </Card>

        {/* ── Test Gateway Card ── */}
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Test Gateway Channel
            </CardTitle>
            <CardDescription>Dispatch a test WhatsApp message to verify the link</CardDescription>
          </CardHeader>
          <form
            onSubmit={testForm.handleSubmit((values) => sendTestMutation.mutate(values))}
          >
            <CardContent className="space-y-4 min-h-[320px]">
              {!isConnected && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  WhatsApp must be connected to send messages.
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-xs font-bold text-muted-foreground">
                  Recipient Indian Mobile (10-Digit)
                </Label>
                <Input
                  id="phone"
                  placeholder="E.g. 9848022338"
                  className="bg-card border-slate-200 dark:border-slate-800"
                  {...testForm.register('phone')}
                />
                {testForm.formState.errors.phone && (
                  <p className="text-xs text-red-500">
                    {testForm.formState.errors.phone.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="body" className="text-xs font-bold text-muted-foreground">
                  Custom Message Body
                </Label>
                <textarea
                  id="body"
                  rows={6}
                  placeholder="Write test message..."
                  className="w-full p-3 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  {...testForm.register('body')}
                />
                {testForm.formState.errors.body && (
                  <p className="text-xs text-red-500">
                    {testForm.formState.errors.body.message}
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter className="bg-muted/10 border-t py-4 flex justify-end">
              {canMutate ? (
                <Button
                  type="submit"
                  disabled={!isConnected || sendTestMutation.isPending}
                  className="gap-2 font-bold shadow-md shadow-primary/10"
                >
                  {sendTestMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Send Test Message
                    </>
                  )}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Admin access required to send test messages.
                </p>
              )}
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
