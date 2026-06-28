'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  IndianRupee,
  Route as RouteIcon,
  TrendingUp,
  Percent,
  CheckCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { usePageRole } from '../layout';


// Helper to format currency
const formatCurrency = (paise: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
};

export default function ReportsPage() {
  const { canMutate } = usePageRole();
  const [activeTab, setActiveTab] = React.useState<'collections' | 'routes'>('collections');


  // Date Range state for Daily reports
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const [startDate, setStartDate] = React.useState(thirtyDaysAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = React.useState(now.toISOString().split('T')[0]);

  // 1. Fetch monthly stats
  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ['reports-monthly-chart'],
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

  // 2. Fetch route metrics
  const { data: routeMetrics, isLoading: routesLoading } = useQuery({
    queryKey: ['reports-route-performance'],
    queryFn: async () => {
      const res = await api.get<{
        data: Array<{
          routeId: string;
          routeName: string;
          totalStudents: number;
          paidStudents: number;
          pendingStudents: number;
          collectionRate: number;
        }>;
      }>('/reports/route-performance');
      return res.data.data;
    },
  });

  // 3. Fetch daily logs
  const { data: dailyReports, isLoading: dailyLoading } = useQuery({
    queryKey: ['reports-daily-logs', startDate, endDate],
    queryFn: async () => {
      const res = await api.get<{
        data: Array<{
          date: string;
          totalCollected: number;
          paymentCount: number;
          pendingCount: number;
        }>;
      }>('/reports/daily', {
        params: { startDate, endDate },
      });
      return res.data.data;
    },
  });

  // Client-side CSV Exporter
  const handleExportCSV = () => {
    if (!dailyReports || dailyReports.length === 0) return;

    const headers = ['Date', 'Payments Processed', 'Amount Collected (INR)', 'Pending Defaults'];
    const rows = dailyReports.map((report) => [
      new Date(report.date).toLocaleDateString('en-IN'),
      report.paymentCount,
      (report.totalCollected / 100).toFixed(2),
      report.pendingCount,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `daily_collection_report_${startDate}_to_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Financial &amp; Route Analytics</h2>
          <p className="text-sm text-muted-foreground">Monitor collections overview and route KPIs</p>
        </div>
        <div className="flex items-center gap-2">
          {!canMutate && (
            <Badge variant="outline" className="text-amber-500 border-amber-500 bg-amber-500/10 font-bold">
              View Only
            </Badge>
          )}
          {/* Tab switch buttons */}
          <div className="flex bg-muted/60 p-1 rounded-lg border">
            <Button
              variant={activeTab === 'collections' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('collections')}
              className="font-bold"
            >
              Collections Over Time
            </Button>
            <Button
              variant={activeTab === 'routes' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('routes')}
              className="font-bold"
            >
              Route Collection Rates
            </Button>
          </div>
        </div>
      </div>

      {/* TAB CONTENT: COLLECTIONS OVER TIME */}
      {activeTab === 'collections' && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Monthly Trend Area Chart */}
            <Card className="lg:col-span-2 border-slate-200 dark:border-slate-800 bg-card shadow-md">
              <CardHeader>
                <CardTitle className="text-md font-bold">Revenue Trends Tally</CardTitle>
                <CardDescription>Target billing vs. actual collections per month</CardDescription>
              </CardHeader>
              <CardContent className="h-80 pl-2">
                {monthlyLoading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                    Calculating billing schedules...
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
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
                      />
                      <Legend wrapperStyle={{ fontSize: '13px', paddingTop: '10px' }} />
                      <Line type="monotone" dataKey="Expected" stroke="#6366f1" strokeWidth={3} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="Collected" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Date boundaries filter */}
            <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
              <div>
                <CardHeader>
                  <CardTitle className="text-md font-bold">Tally Boundaries</CardTitle>
                  <CardDescription>Configure logs date window filters</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground">From Date</label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bg-card border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground">To Date</label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="bg-card border-slate-200 dark:border-slate-800"
                    />
                  </div>
                </CardContent>
              </div>

              <div className="p-6 border-t bg-muted/10 hidden md:block">
                <Button
                  onClick={handleExportCSV}
                  disabled={!dailyReports || dailyReports.length === 0}
                  className="w-full gap-2 font-bold shadow-md shadow-primary/10"
                >
                  <Download className="h-4 w-4" />
                  Export Daily Logs (CSV)
                </Button>
              </div>
            </Card>
          </div>

          {/* Daily Reports Tally Table */}
          <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-md font-bold">Daily Collection Log Tally</CardTitle>
                <CardDescription>Summary audits recorded for the selected window</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Date</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Tally Count</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Total Collected</th>
                    <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Remaining Defaults</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyLoading ? (
                    Array.from({ length: 3 }).map((_, idx) => (
                      <tr key={idx} className="border-b animate-pulse">
                        <td className="p-4"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                        <td className="p-4"><div className="h-4 w-12 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                        <td className="p-4"><div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                        <td className="p-4"><div className="h-4 w-12 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                      </tr>
                    ))
                  ) : dailyReports && dailyReports.length > 0 ? (
                    dailyReports.map((report) => (
                      <tr key={report.date} className="border-b hover:bg-muted/10 transition-colors">
                        <td className="p-4 font-semibold text-foreground">
                          {new Date(report.date).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="p-4 font-medium text-foreground">
                          {report.paymentCount} payments processed
                        </td>
                        <td className="p-4 font-black text-success">
                          {formatCurrency(report.totalCollected)}
                        </td>
                        <td className="p-4 font-bold text-destructive">
                          {report.pendingCount} students pending
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-muted-foreground">
                        <Calendar className="h-10 w-10 stroke-1 mx-auto mb-2" />
                        No Daily Tally Logs found for this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB CONTENT: ROUTE PERFORMANCE */}
      {activeTab === 'routes' && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {routesLoading ? (
            Array.from({ length: 3 }).map((_, idx) => (
              <Card key={idx} className="animate-pulse border-slate-200 dark:border-slate-800 bg-card">
                <CardHeader className="space-y-2">
                  <div className="h-4 w-1/3 bg-slate-200 dark:bg-slate-800 rounded" />
                  <div className="h-6 w-2/3 bg-slate-200 dark:bg-slate-800 rounded" />
                </CardHeader>
                <CardContent className="h-24 bg-card" />
              </Card>
            ))
          ) : routeMetrics && routeMetrics.length > 0 ? (
            routeMetrics.map((route) => (
              <Card
                key={route.routeId}
                className="border-slate-200 dark:border-slate-800 bg-card hover:shadow-xl transition-all duration-300 group"
              >
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div>
                    <CardTitle className="text-md font-bold group-hover:text-primary transition-colors">
                      {route.routeName}
                    </CardTitle>
                    <CardDescription>Collections metric scorecard</CardDescription>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-inner">
                    <RouteIcon className="h-5 w-5" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Progress Tally Bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-muted-foreground uppercase tracking-wider">Collection Rate</span>
                      <span className="text-foreground font-extrabold">{route.collectionRate}%</span>
                    </div>
                    {/* Custom fully styled progress bar */}
                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800/80 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full transition-all duration-500',
                          route.collectionRate >= 80
                            ? 'bg-success'
                            : route.collectionRate >= 50
                            ? 'bg-warning'
                            : 'bg-destructive',
                        )}
                        style={{ width: `${route.collectionRate}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center border-t pt-4">
                    <div>
                      <div className="text-[10px] font-bold text-muted-foreground uppercase">Routed</div>
                      <div className="text-lg font-black text-foreground">{route.totalStudents}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-success uppercase">Paid</div>
                      <div className="text-lg font-black text-success">{route.paidStudents}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-destructive uppercase">Pending</div>
                      <div className="text-lg font-black text-destructive">{route.pendingStudents}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="col-span-full py-16 text-center text-muted-foreground">
              <RouteIcon className="h-12 w-12 stroke-1 mx-auto mb-2" />
              No active routes found to evaluate.
            </div>
          )}
        </div>
      )}

      {/* Mobile Sticky Export Bar - Admin/Manager with mutation only */}
      {activeTab === 'collections' && canMutate && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 p-3 bg-card border-t border-slate-200 dark:border-slate-800 flex justify-center z-40">
          <Button
            onClick={handleExportCSV}
            disabled={!dailyReports || dailyReports.length === 0}
            className="w-full max-w-md gap-2 font-bold shadow-md shadow-primary/10 h-11"
          >
            <Download className="h-4 w-4" />
            Export Daily Logs (CSV)
          </Button>
        </div>
      )}
    </div>
  );
}
