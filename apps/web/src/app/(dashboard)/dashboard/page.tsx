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
  Calendar,
  ChevronDown,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';

// Premium color palette for charts/donut segments
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6'];

// Helper to format currency
const formatCurrency = (paise: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Generate last 12 months including current
function getLast12Months() {
  const options: { month: number; year: number; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return options;
}

import { usePageRole } from '../RoleContext';

export default function DashboardPage() {
  const { toast } = useToast();
  const { canMutate } = usePageRole();

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = React.useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = React.useState(now.getFullYear());
  const [monthDropdownOpen, setMonthDropdownOpen] = React.useState(false);

  const monthOptions = getLast12Months();
  const isCurrentMonth = selectedMonth === now.getMonth() + 1 && selectedYear === now.getFullYear();
  const selectedLabel = `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`;

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

  // 1. Fetch dashboard Stats — filtered by selected month/year
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats', selectedMonth, selectedYear],
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
      }>(`/reports/stats?month=${selectedMonth}&year=${selectedYear}`);
      return res.data.data;
    },
    refetchInterval: isCurrentMonth ? 30000 : false,
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
      return res.data.data.map((item) => ({
        ...item,
        Collected: item.collected / 100,
        Expected: item.expected / 100,
        Pending: item.pending / 100,
      }));
    },
  });

  // 3. Fetch recent payments — filtered by selected month/year
  const { data: recentPayments, isLoading: paymentsLoading } = useQuery({
    queryKey: ['recent-payments-feed', selectedMonth, selectedYear],
    queryFn: async () => {
      const res = await api.get<{
        data: {
          payments: Array<{
            id: string;
            amount: number;
            month: number;
            year: number;
            method: string;
            status: string;
            paidAt: string;
            student: {
              name: string;
              parentName: string;
              school: string;
            };
          }>;
        };
      }>(`/payments?limit=5&month=${selectedMonth}&year=${selectedYear}`);
      return res.data.data.payments;
    },
    refetchInterval: isCurrentMonth ? 30000 : false,
  });

  // 4. Fetch school-wise performance — filtered by selected month/year
  const { data: schoolData, isLoading: schoolLoading } = useQuery({
    queryKey: ['school-performance', selectedMonth, selectedYear],
    queryFn: async () => {
      const res = await api.get<{
        data: Array<{
          school: string;
          expected: number;
          collected: number;
          pending: number;
          studentCount: number;
          rate: number;
        }>;
      }>(`/reports/school-performance?month=${selectedMonth}&year=${selectedYear}`);
      return res.data.data.map(item => ({
        ...item,
        Expected: item.expected / 100,
        Collected: item.collected / 100,
        Pending: item.pending / 100,
      }));
    },
    refetchInterval: isCurrentMonth ? 30000 : false,
  });

  const getMonthName = (m: number) => MONTH_NAMES[m - 1]?.slice(0, 3) ?? '';

  const dashboardLoading = statsLoading || chartLoading || paymentsLoading || schoolLoading;

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

      {/* ── Dashboard Header with Month Selector ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isCurrentMonth ? 'Live data for current billing cycle' : `Historical data — ${selectedLabel}`}
          </p>
        </div>

        {/* Month/Year Dropdown */}
        <div className="relative">
          <button
            id="month-selector"
            onClick={() => setMonthDropdownOpen((v) => !v)}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold shadow-sm transition-all',
              'bg-card hover:bg-muted border-slate-200 dark:border-slate-700',
              isCurrentMonth
                ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/5'
                : 'text-indigo-500 border-indigo-500/30 bg-indigo-500/5',
            )}
          >
            <Calendar className="h-4 w-4" />
            <span>{selectedLabel}</span>
            {isCurrentMonth && (
              <span className="text-[10px] bg-emerald-500/10 text-emerald-500 font-black px-1.5 py-0.5 rounded ml-1">
                LIVE
              </span>
            )}
            <ChevronDown className={cn('h-4 w-4 transition-transform', monthDropdownOpen && 'rotate-180')} />
          </button>

          {monthDropdownOpen && (
            <div className="absolute right-0 top-full mt-2 z-50 w-52 rounded-xl border border-slate-200 dark:border-slate-700 bg-card shadow-xl overflow-hidden">
              {monthOptions.map((opt) => {
                const isSelected = opt.month === selectedMonth && opt.year === selectedYear;
                const isCurrent = opt.month === now.getMonth() + 1 && opt.year === now.getFullYear();
                return (
                  <button
                    key={`${opt.month}-${opt.year}`}
                    onClick={() => {
                      setSelectedMonth(opt.month);
                      setSelectedYear(opt.year);
                      setMonthDropdownOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold transition-colors text-left',
                      isSelected
                        ? 'bg-indigo-500/10 text-indigo-500'
                        : 'hover:bg-muted text-foreground',
                    )}
                  >
                    <span>{opt.label}</span>
                    {isCurrent && (
                      <span className="text-[9px] bg-emerald-500/10 text-emerald-500 font-black px-1.5 rounded">
                        NOW
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Click outside to close dropdown */}
      {monthDropdownOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMonthDropdownOpen(false)} />
      )}

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
            <p className="mt-1 text-xs text-muted-foreground">{selectedLabel} billing potential</p>
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
              {canMutate && isCurrentMonth && (
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

      {/* Overall Progress Target Tracker */}
      {stats && (
        <Card className="border-slate-200 dark:border-slate-800 bg-card p-6 shadow-md relative overflow-hidden group">
          <div className="absolute right-0 top-0 h-40 w-40 translate-x-12 translate-y-[-10px] rounded-full bg-emerald-500/5 group-hover:scale-110 transition-transform" />
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
                Overall Collection Target — {selectedLabel}
              </h3>
              <p className="text-2xl font-black text-foreground">
                {stats.expectedRevenue > 0
                  ? `${Math.round((stats.receivedRevenue / stats.expectedRevenue) * 100)}% Collected`
                  : '0% Collected'}
              </p>
              <p className="text-xs text-muted-foreground">
                Collected {formatCurrency(stats.receivedRevenue)} out of total {formatCurrency(stats.expectedRevenue)} expected
              </p>
            </div>

            <div className="flex-1 max-w-md w-full">
              <div className="flex justify-between items-center mb-1.5 text-xs font-black text-muted-foreground uppercase">
                <span>Monthly Target Achievement</span>
                <span>{stats.expectedRevenue > 0 ? Math.round((stats.receivedRevenue / stats.expectedRevenue) * 100) : 0}%</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-3 rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-1000 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                  style={{ width: `${stats.expectedRevenue > 0 ? Math.min(100, (stats.receivedRevenue / stats.expectedRevenue) * 100) : 0}%` }}
                />
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 2-Column charts: Monthly Trend Area Chart & School Donut Chart */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Recharts Area Chart - Monthly Performance */}
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-bold">Revenue Collection Trend</CardTitle>
            <CardDescription>Monthly target collections vs. received payments (INR)</CardDescription>
          </CardHeader>
          <CardContent className="h-80 pl-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={monthlyData}
                margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorExpected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorCollected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/30" />
                <XAxis dataKey="monthName" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    borderColor: 'hsl(var(--border))',
                    borderRadius: '8px',
                    color: 'hsl(var(--card-foreground))',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Area type="monotone" dataKey="Expected" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorExpected)" />
                <Area type="monotone" dataKey="Collected" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorCollected)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* School-Wise Expected Contribution Donut Chart */}
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-lg font-bold">School Target Contribution</CardTitle>
            <CardDescription>Share of total expected revenue by school — {selectedLabel}</CardDescription>
          </CardHeader>
          <CardContent className="h-80 flex items-center justify-center">
            {schoolData && schoolData.length > 0 ? (
              <div className="w-full h-full relative flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={schoolData}
                      dataKey="Expected"
                      nameKey="school"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={85}
                      paddingAngle={4}
                    >
                      {schoolData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: any) => [`₹${value.toLocaleString('en-IN')}`, 'Expected Contribution']}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--card-foreground))',
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      iconType="circle"
                      wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">
                No school contribution data available.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 2-Column Details: School Contributions Table & Recent Payments Feed */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
        {/* School Leaderboard / Table Details */}
        <Card className="lg:col-span-2 border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
          <div>
            <CardHeader>
              <CardTitle className="text-lg font-bold">School Wise Contributions</CardTitle>
              <CardDescription>Detailed collections and progress metrics — {selectedLabel}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {schoolData && schoolData.length > 0 ? (
                schoolData.map((item) => (
                  <div key={item.school} className="space-y-2 border-b pb-4 last:border-0 last:pb-0">
                    <div className="flex justify-between items-center text-sm font-bold">
                      <span className="truncate text-foreground max-w-[280px]">{item.school}</span>
                      <span className={cn(
                        "text-xs px-2.5 py-0.5 rounded font-black",
                        item.rate >= 90
                          ? "bg-emerald-500/10 text-emerald-500"
                          : item.rate >= 50
                          ? "bg-amber-500/10 text-amber-500"
                          : "bg-rose-500/10 text-rose-500"
                      )}>
                        {item.rate}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>{item.studentCount} Active Students</span>
                      <span className="font-semibold text-foreground">
                        ₹{item.Collected.toLocaleString('en-IN')} Collected / <span className="text-muted-foreground font-normal">₹{item.Expected.toLocaleString('en-IN')} Expected</span>
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          item.rate >= 90
                            ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                            : item.rate >= 50
                            ? "bg-gradient-to-r from-amber-500 to-orange-400"
                            : "bg-gradient-to-r from-rose-500 to-red-400"
                        )}
                        style={{ width: `${item.rate}%` }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <p className="text-sm">No school contribution data available.</p>
                </div>
              )}
            </CardContent>
          </div>
        </Card>

        {/* Recent Payments Feed */}
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
          <div>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-lg font-bold">Recent Payments</CardTitle>
                <CardDescription>{selectedLabel} transactions</CardDescription>
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
                      <p className={cn(
                        "text-sm font-bold",
                        payment.status === 'PAID' ? "text-success" :
                        payment.status === 'PENDING' ? "text-amber-500" : "text-destructive"
                      )}>
                        {payment.status === 'PAID' ? '+' : ''}₹{(payment.amount / 100).toFixed(0)}
                      </p>
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        <span className={cn(
                          "text-[9px] px-1.5 py-0.2 rounded font-black uppercase",
                          payment.status === 'PAID' ? "bg-emerald-500/10 text-emerald-500" :
                          payment.status === 'PENDING' ? "bg-amber-500/10 text-amber-500" :
                          "bg-rose-500/10 text-rose-500"
                        )}>
                          {payment.status}
                        </span>
                        <span className="text-[10px] text-muted-foreground">• {payment.method}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Receipt className="h-10 w-10 stroke-1 mb-2" />
                  <p className="text-sm">No payments found for {selectedLabel}.</p>
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

