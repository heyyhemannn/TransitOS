'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  Users,
  Route as RouteIcon,
  IndianRupee,
  MessageSquare,
  ArrowUpRight,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';

// Helper to format currency
const formatCurrency = (paise: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
};

import { usePageRole } from '../layout';

export default function DashboardPage() {
  const { toast } = useToast();
  const { canMutate } = usePageRole();

  const broadcastMutation = useMutation({
    mutationFn: async () => {
      await api.post('/whatsapp/broadcast-unpaid');
    },
    onSuccess: () => {
      toast({
        title: 'Broadcast Started',
        description: 'WhatsApp due reminders have been queued for all unpaid students.',
        variant: 'success',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Broadcast Failed',
        description: err.response?.data?.error || 'Failed to dispatch reminders. Check gateway pairing.',
        variant: 'destructive',
      });
    },
  });

  // 1. Fetch dashboard Stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await api.get<{
        data: {
          totalStudents: number;
          activeRoutes: number;
          expectedRevenue: number;
          receivedRevenue: number;
          pendingRevenue: number;
          whatsappStatus: boolean;
        };
      }>('/reports/stats');
      return res.data.data;
    },
    refetchInterval: 5000,
  });

  // 2. Fetch monthly aggregate data for chart
  const { data: monthlyData, isLoading: chartLoading } = useQuery({
    queryKey: ['monthly-chart'],
    queryFn: async () => {
      const res = await api.get<{
        data: Array<{
          monthName: string;
          collected: number;
          expected: number;
          pending: number;
        }>;
      }>('/reports/monthly');
      // Format data values from paise to rupees for clean chart rendering
      return res.data.data.map((item) => ({
        ...item,
        Collected: item.collected / 100,
        Expected: item.expected / 100,
        Pending: item.pending / 100,
      }));
    },
  });

  // 3. Fetch recent payments
  const { data: recentPayments, isLoading: paymentsLoading } = useQuery({
    queryKey: ['recent-payments-feed'],
    queryFn: async () => {
      const res = await api.get<{
        data: Array<{
          id: string;
          amount: number;
          month: number;
          year: number;
          method: string;
          paidAt: string;
          student: {
            name: string;
            parentName: string;
            school: string;
          };
        }>;
      }>('/payments?limit=5');
      return res.data.data;
    },
    refetchInterval: 5000,
  });

  const getMonthName = (m: number) => {
    return [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ][m - 1];
  };

  const dashboardLoading = statsLoading || chartLoading || paymentsLoading;

  if (dashboardLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Card key={idx} className="animate-pulse border-slate-800 bg-slate-900/40">
              <CardHeader className="space-y-2">
                <div className="h-4 w-1/2 rounded bg-slate-800" />
                <div className="h-8 w-3/4 rounded bg-slate-800" />
              </CardHeader>
            </Card>
          ))}
        </div>
        <Card className="h-96 animate-pulse border-slate-800 bg-slate-900/40" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* WhatsApp warning banner if disconnected */}
      {stats && !stats.whatsappStatus && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-warning/20 bg-warning/10 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning animate-bounce" />
            <div className="text-sm">
              <span className="font-bold text-foreground">WhatsApp Client Disconnected:</span>
              <span className="text-muted-foreground ml-1">
                Auto billing messages and payment confirmation receipts are currently paused.
              </span>
            </div>
          </div>
          {canMutate && (
            <Link href="/whatsapp">
              <Button size="sm" variant="warning" className="font-bold shadow-md shadow-warning/15">
                Pair Device Now
              </Button>
            </Link>
          )}
        </div>
      )}

      {/* KPI Stats widgets grid */}
      <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Students */}
        <Card className="relative overflow-hidden border-slate-200 dark:border-slate-800 bg-card hover:shadow-xl transition-all duration-300 group">
          <div className="absolute right-0 top-0 h-24 w-24 translate-x-4 translate-y-[-10px] rounded-full bg-blue-500/5 group-hover:scale-125 transition-transform" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm font-semibold text-muted-foreground">Active Students</span>
            <Users className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black tracking-tight text-foreground">
              {stats?.totalStudents ?? 0}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Enrolled and routed students</p>
          </CardContent>
        </Card>

        {/* Expected Revenue */}
        <Card className="relative overflow-hidden border-slate-200 dark:border-slate-800 bg-card hover:shadow-xl transition-all duration-300 group">
          <div className="absolute right-0 top-0 h-24 w-24 translate-x-4 translate-y-[-10px] rounded-full bg-indigo-500/5 group-hover:scale-125 transition-transform" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm font-semibold text-muted-foreground">Target Revenue</span>
            <IndianRupee className="h-5 w-5 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black tracking-tight text-foreground">
              {formatCurrency(stats?.expectedRevenue ?? 0)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Current billing cycle potential</p>
          </CardContent>
        </Card>

        {/* Received Revenue */}
        <Card className="relative overflow-hidden border-slate-200 dark:border-slate-800 bg-card hover:shadow-xl transition-all duration-300 group">
          <div className="absolute right-0 top-0 h-24 w-24 translate-x-4 translate-y-[-10px] rounded-full bg-success/5 group-hover:scale-125 transition-transform" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm font-semibold text-muted-foreground">Collected</span>
            <CheckCircle2 className="h-5 w-5 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black tracking-tight text-success">
              {formatCurrency(stats?.receivedRevenue ?? 0)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Payments validated and matched
            </p>
          </CardContent>
        </Card>

        {/* Outstanding Receivables */}
        <Card className="relative overflow-hidden border-slate-200 dark:border-slate-800 bg-card hover:shadow-xl transition-all duration-300 group">
          <div className="absolute right-0 top-0 h-24 w-24 translate-x-4 translate-y-[-10px] rounded-full bg-destructive/5 group-hover:scale-125 transition-transform" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm font-semibold text-muted-foreground">Outstanding</span>
            <TrendingUp className="h-5 w-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black tracking-tight text-destructive">
              {formatCurrency(stats?.pendingRevenue ?? 0)}
            </div>
            <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-100 dark:border-slate-900">
              <span className="text-xs text-muted-foreground">Pending balance invoices</span>
              {canMutate && (
                <Button 
                  size="sm" 
                  variant="destructive" 
                  className="h-6 text-[10px] font-bold px-2 py-0.5"
                  onClick={() => broadcastMutation.mutate()}
                  disabled={!stats?.pendingRevenue || broadcastMutation.isPending}
                >
                  {broadcastMutation.isPending ? 'Sending...' : 'Remind All'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recharts Bar Chart */}
        <Card className="lg:col-span-2 border-slate-200 dark:border-slate-800 bg-card shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-bold">Revenue Collection Overview</CardTitle>
            <CardDescription>Monthly target collections vs. received payments (INR)</CardDescription>
          </CardHeader>
          <CardContent className="h-80 pl-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={monthlyData}
                margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/30" />
                <XAxis dataKey="monthName" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    borderColor: 'hsl(var(--border))',
                    borderRadius: '8px',
                    color: 'hsl(var(--card-foreground))',
                  }}
                  cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                />
                <Legend wrapperStyle={{ fontSize: '13px', paddingTop: '10px' }} />
                <Bar dataKey="Expected" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={30} />
                <Bar dataKey="Collected" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent Payments Feed */}
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
          <div>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-lg font-bold">Recent Payments</CardTitle>
                <CardDescription>Latest transactions recorded</CardDescription>
              </div>
              <Link href="/payments">
                <Button variant="ghost" size="sm" className="gap-1 font-bold text-primary">
                  View All
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="space-y-4">
              {recentPayments && recentPayments.length > 0 ? (
                recentPayments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <p className="text-sm font-bold text-foreground truncate">
                        {payment.student.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {payment.student.school} • {getMonthName(payment.month)} {payment.year}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-success">
                        +₹{(payment.amount / 100).toFixed(0)}
                      </p>
                      <p className="text-xs text-muted-foreground">{payment.method}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Receipt className="h-10 w-10 stroke-1 mb-2" />
                  <p className="text-sm">No payment records found.</p>
                </div>
              )}
            </CardContent>
          </div>

          <div className="p-6 border-t">
            <div className="grid grid-cols-2 gap-4">
              <Link href="/students">
                <Button variant="outline" className="w-full font-bold gap-2">
                  <Users className="h-4 w-4" />
                  Manage Students
                </Button>
              </Link>
              <Link href="/routes">
                <Button variant="outline" className="w-full font-bold gap-2">
                  <RouteIcon className="h-4 w-4" />
                  View Routes
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
