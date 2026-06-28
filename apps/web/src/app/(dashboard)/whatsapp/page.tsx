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
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { usePageRole } from '../layout';


const testMessageSchema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian mobile number'),
  body: z.string().min(1, 'Message body is required'),
});

type TestMessageFormValues = z.infer<typeof testMessageSchema>;

export default function WhatsAppPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canMutate } = usePageRole();
  const [sendingTest, setSendingTest] = React.useState(false);


  const testForm = useForm<TestMessageFormValues>({
    resolver: zodResolver(testMessageSchema),
    defaultValues: {
      body: 'Hello from TransitOS! This is a secure test connection message.',
    },
  });

  // 1. Query WhatsApp connection status (poll every 5s if offline)
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ['wa-device-status'],
    queryFn: async () => {
      const res = await api.get<{ data: { connected: boolean; phone: string | null } }>(
        '/whatsapp/status',
      );
      return res.data.data;
    },
    refetchInterval: (query) => {
      // If client is not connected, poll every 5s to monitor QR scan completion
      return query.state.data?.connected ? 30000 : 5000;
    },
  });

  // 2. Query active base64 QR code (poll every 10s if offline)
  const { data: qrData, isLoading: qrLoading, refetch: refetchQR } = useQuery({
    queryKey: ['wa-qr-code'],
    queryFn: async () => {
      const res = await api.get<{ data: { qr: string | null } }>('/whatsapp/qr');
      return res.data.data;
    },
    enabled: status ? !status.connected : true,
    refetchInterval: (query) => {
      return status?.connected ? false : 8000;
    },
  });

  // 3. Send Test Message Mutation
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
        description: err.response?.data?.error || 'Ensure WhatsApp client is online and number is active.',
        variant: 'destructive',
      });
    },
  });

  const handleManualRefresh = async () => {
    await Promise.all([refetchStatus(), refetchQR()]);
    toast({ title: 'Status Synced', description: 'WhatsApp device logs refreshed.' });
  };

  const isConnected = status?.connected ?? false;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">WhatsApp Gateway</h2>
          <p className="text-sm text-muted-foreground">Pair devices, check connection status, and send tests</p>
        </div>
        <div className="flex items-center gap-2">
          {!canMutate && (
            <Badge variant="outline" className="text-amber-500 border-amber-500 bg-amber-500/10 font-bold">
              View Only
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleManualRefresh} className="gap-2 font-bold">
            <RefreshCw className="h-4 w-4" />
            Sync Status
          </Button>
        </div>

      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Connection Widget */}
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              {isConnected ? (
                <Link2 className="h-5 w-5 text-success" />
              ) : (
                <Link2Off className="h-5 w-5 text-muted-foreground" />
              )}
              Device Connection
            </CardTitle>
            <CardDescription>Pair with WhatsApp Web via QR to enable auto confirmations</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-6 min-h-[320px]">
            {statusLoading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Syncing driver gateway logs...</p>
              </div>
            ) : isConnected ? (
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success shadow-lg shadow-success/10">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <div>
                  <h4 className="text-md font-bold text-foreground">Link Established!</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Connected phone profile wid: <span className="font-mono font-semibold text-primary">{status?.phone}</span>
                  </p>
                </div>
                <div className="text-xs text-muted-foreground max-w-xs border rounded-lg p-3 bg-muted/20">
                  ✨ Confirmation notifications and due alerts will now be sent automatically. Keep this session active.
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center space-y-4 w-full">
                {qrData?.qr ? (
                  <div className="relative group border p-3 rounded-2xl bg-white shadow-inner">
                    {/* Render raw base64 PNG data URL directly */}
                    <img
                      src={qrData.qr}
                      alt="WhatsApp Pair QR Code"
                      className="h-52 w-52 object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10">
                    <QrCode className="h-12 w-12 text-muted-foreground animate-pulse mb-3" />
                    <p className="text-sm font-semibold text-muted-foreground">Generating connection key...</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
                      Establishing secure bridge to WhatsApp Web servers.
                    </p>
                  </div>
                )}
                {!qrLoading && !qrData?.qr && (
                  <Button size="sm" variant="ghost" onClick={handleManualRefresh} className="text-xs font-bold gap-1 text-primary">
                    <RefreshCw className="h-3 w-3 animate-spin" /> Retry Key
                  </Button>
                )}
                <div className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                  Open WhatsApp on your mobile phone, navigate to <span className="font-semibold text-foreground">Linked Devices</span>, and scan the QR code.
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-muted/10 border-t py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <HelpCircle className="h-4 w-4" />
              <span>Gateway instances run in isolated chromium browser threads.</span>
            </div>
          </CardFooter>
        </Card>

        {/* Send Test Message */}
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
                  <p className="text-xs text-red-500">{testForm.formState.errors.phone.message}</p>
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
                  <p className="text-xs text-red-500">{testForm.formState.errors.body.message}</p>
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
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Send Test Message
                    </>
                  )}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground italic">Admin access required to send test messages.</p>
              )}
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
