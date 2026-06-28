'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Upload,
  Search,
  IndianRupee,
  FileSpreadsheet,
  Download,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/lib/auth';

const manualPaymentSchema = z.object({
  studentId: z.string().min(1, 'Please select a student'),
  amount: z.number().positive('Amount must be a positive number'),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
  transactionId: z.string().optional().or(z.literal('')),
  method: z.enum(['UPI', 'CASH', 'BANK_TRANSFER']),
  remarks: z.string().optional().or(z.literal('')),
});

type ManualPaymentFormValues = z.infer<typeof manualPaymentSchema>;

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { accessToken } = useAuthStore();

  // Filters State
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = React.useState<string>(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = React.useState<string>(String(now.getFullYear()));
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const limit = 15;

  // Dialog states
  const [manualOpen, setManualOpen] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [importSummary, setImportSummary] = React.useState<any | null>(null);

  const handleReconcileManually = (row: any) => {
    manualForm.reset({
      studentId: '',
      amount: row.credit ? parseFloat(row.credit) : 0,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      method: 'UPI',
      transactionId: row.transactionId || '',
      remarks: row.description || '',
    });
    setUploadOpen(false);
    setImportSummary(null);
    setManualOpen(true);
  };

  // Forms setup
  const manualForm = useForm<ManualPaymentFormValues>({
    resolver: zodResolver(manualPaymentSchema),
    defaultValues: {
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      method: 'UPI',
      remarks: '',
      transactionId: '',
    },
  });

  // 1. Fetch historical payments
  const { data: paymentsData, isLoading: paymentsLoading } = useQuery({
    queryKey: ['payments-list', selectedMonth, selectedYear, search, page],
    queryFn: async () => {
      const params: Record<string, any> = {
        page,
        limit,
        month: selectedMonth,
        year: selectedYear,
      };
      if (search) params.search = search;

      const res = await api.get<{
        data: {
          payments: any[];
          total: number;
          page: number;
          totalPages: number;
        };
      }>('/payments', { params });
      return res.data.data;
    },
    refetchInterval: 5000,
  });

  // 2. Fetch active students for dropdown selection
  const { data: students } = useQuery({
    queryKey: ['students-selection-list'],
    queryFn: async () => {
      const res = await api.get<{ data: { students: any[] } }>('/students?limit=200&status=ACTIVE');
      return res.data.data.students;
    },
  });

  // 3. Manual Payment Mutation
  const manualMutation = useMutation({
    mutationFn: async (values: ManualPaymentFormValues) => {
      await api.post('/payments', values);
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Manual payment recorded successfully', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['payments-list'] });
      setManualOpen(false);
      manualForm.reset();
    },
    onError: (err: any) => {
      toast({
        title: 'Submission failed',
        description: err.response?.data?.error || 'Failed to record manual payment',
        variant: 'destructive',
      });
    },
  });

  // 4. CSV Upload Mutation
  const csvMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post<{ data: any }>('/payments/import-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      toast({
        title: 'CSV Import Completed',
        description: `Successfully processed bank statement credits. Matched: ${data.matched}, Unmatched: ${data.unmatched}`,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['payments-list'] });
      if (data.unmatched > 0) {
        setImportSummary(data);
      } else {
        setUploadOpen(false);
        setSelectedFile(null);
      }
    },
    onError: (err: any) => {
      toast({
        title: 'CSV Upload Failed',
        description: err.response?.data?.error || 'Ensure file matches PhonePe export schema.',
        variant: 'destructive',
      });
    },
  });

  // 5. Open signed URL in new tab helper
  const handleDownloadReceipt = async (paymentId: string) => {
    try {
      const res = await api.get<{ data: string }>(`/payments/${paymentId}/receipt`);
      // Since receipt endpoint issues redirect or signed URL, let's open the redirect URL
      if (typeof window !== 'undefined') {
        window.open(`http://localhost:4000/api/v1/payments/${paymentId}/receipt?token=${accessToken}`, '_blank');
      }
    } catch {
      toast({ title: 'Receipt Unavailable', description: 'Failed to build secure signed download link', variant: 'destructive' });
    }
  };

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

  const monthsList = [
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];

  const yearsList = ['2024', '2025', '2026'];

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Payments Directory</h2>
          <p className="text-sm text-muted-foreground">Manage collection history, upload CSV logs, and matching reports</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setUploadOpen(true)} className="gap-2 font-bold">
            <Upload className="h-4 w-4" />
            Upload CSV
          </Button>
          <Button onClick={() => setManualOpen(true)} className="gap-2 font-bold shadow-md shadow-primary/20">
            <Plus className="h-4 w-4" />
            Manual Payment
          </Button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search student or TXID..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9 bg-card border-slate-200 dark:border-slate-800"
          />
        </div>

        <Select value={selectedMonth} onValueChange={(val: string) => { setSelectedMonth(val); setPage(1); }}>
          <SelectTrigger className="bg-card border-slate-200 dark:border-slate-800">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {monthsList.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedYear} onValueChange={(val: string) => { setSelectedYear(val); setPage(1); }}>
          <SelectTrigger className="bg-card border-slate-200 dark:border-slate-800">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {yearsList.map((y) => (
              <SelectItem key={y} value={y}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Main Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-card overflow-hidden shadow-md">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Reference ID</th>
              <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Student Match</th>
              <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Billing Period</th>
              <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Amount</th>
              <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Method</th>
              <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Tally Status</th>
              <th className="p-4 text-xs font-bold text-muted-foreground uppercase text-right">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {paymentsLoading ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} className="border-b animate-pulse">
                  <td className="p-4"><div className="h-4 w-28 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                  <td className="p-4"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                  <td className="p-4"><div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                  <td className="p-4"><div className="h-4 w-12 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                  <td className="p-4"><div className="h-4 w-12 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                  <td className="p-4"><div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                  <td className="p-4 text-right"><div className="h-6 w-16 bg-slate-200 dark:bg-slate-800 rounded inline-block" /></td>
                </tr>
              ))
            ) : paymentsData?.payments && paymentsData.payments.length > 0 ? (
              paymentsData.payments.map((payment) => (
                <tr key={payment.id} className="border-b hover:bg-muted/10 transition-colors">
                  <td className="p-4">
                    <span className="font-mono text-xs font-bold text-foreground bg-accent/30 px-2 py-1 rounded">
                      {payment.transactionId || 'MANUAL-ENTRY'}
                    </span>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {new Date(payment.paidAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="font-bold text-foreground">{payment.student?.name}</div>
                    <div className="text-xs text-muted-foreground">{payment.student?.school}</div>
                  </td>
                  <td className="p-4 font-medium text-foreground">
                    {getMonthName(payment.month)} {payment.year}
                  </td>
                  <td className="p-4 font-black text-success">
                    ₹{(payment.amount / 100).toFixed(0)}
                  </td>
                  <td className="p-4">
                    <Badge variant="outline" className="font-bold text-foreground">
                      {payment.method}
                    </Badge>
                  </td>
                  <td className="p-4">
                    {payment.status === 'PAID' ? (
                      <div className="flex items-center gap-1 text-success">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="text-xs font-bold">MATCHED</span>
                      </div>
                    ) : payment.status === 'UNMATCHED' ? (
                      <div className="flex items-center gap-1 text-warning">
                        <Clock className="h-4 w-4" />
                        <span className="text-xs font-bold">UNMATCHED</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-destructive">
                        <AlertCircle className="h-4 w-4" />
                        <span className="text-xs font-bold">FAILED</span>
                      </div>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownloadReceipt(payment.id)}
                      className="gap-1 font-bold text-primary hover:text-indigo-600"
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </Button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  <IndianRupee className="h-10 w-10 stroke-1 mx-auto mb-2" />
                  No payments matching filters found for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination controls */}
        {paymentsData && paymentsData.totalPages > 1 && (
          <div className="flex items-center justify-between border-t p-4 bg-muted/10">
            <span className="text-xs text-muted-foreground">
              Page {paymentsData.page} of {paymentsData.totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === paymentsData.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          MANUAL PAYMENT DIALOG
          ───────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tally Manual Payment</DialogTitle>
            <DialogDescription>Record a manual collection cash / check entry</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={manualForm.handleSubmit((values) => manualMutation.mutate(values))}
            className="space-y-4"
          >
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Select Student</label>
                <select
                  className="w-full p-2 border rounded-md bg-card text-foreground"
                  {...manualForm.register('studentId')}
                >
                  <option value="">Choose Student...</option>
                  {students?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.school})
                    </option>
                  ))}
                </select>
                {manualForm.formState.errors.studentId && (
                  <p className="text-[10px] text-red-500">{manualForm.formState.errors.studentId.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-muted-foreground">Billing Month</label>
                  <select
                    className="w-full p-2 border rounded-md bg-card text-foreground"
                    {...manualForm.register('month', { valueAsNumber: true })}
                  >
                    {monthsList.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-muted-foreground">Billing Year</label>
                  <select
                    className="w-full p-2 border rounded-md bg-card text-foreground"
                    {...manualForm.register('year', { valueAsNumber: true })}
                  >
                    {yearsList.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-muted-foreground">Amount Paid (INR)</label>
                  <Input
                    type="number"
                    placeholder="E.g. 2500"
                    {...manualForm.register('amount', { valueAsNumber: true })}
                  />
                  {manualForm.formState.errors.amount && (
                    <p className="text-[10px] text-red-500">{manualForm.formState.errors.amount.message}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-muted-foreground">Payment Method</label>
                  <select
                    className="w-full p-2 border rounded-md bg-card text-foreground"
                    {...manualForm.register('method')}
                  >
                    <option value="UPI">UPI</option>
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Transaction ID (Reference)</label>
                <Input placeholder="E.g. TXN12345678" {...manualForm.register('transactionId')} />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Remarks (Optional)</label>
                <Input placeholder="E.g. Paid in-person" {...manualForm.register('remarks')} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setManualOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={manualMutation.isPending}>
                {manualMutation.isPending ? 'Saving...' : 'Tally Payment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────────────────────
          CSV IMPORT DIALOG
          ───────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={uploadOpen} onOpenChange={(open) => {
        setUploadOpen(open);
        if (!open) {
          setSelectedFile(null);
          setImportSummary(null);
        }
      }}>
        <DialogContent className={importSummary ? "max-w-2xl max-h-[85vh] flex flex-col" : "max-w-md"}>
          <DialogHeader>
            <DialogTitle>
              {importSummary ? "CSV Import Report & Reconciliation" : "Import PhonePe CSV"}
            </DialogTitle>
            <DialogDescription>
              {importSummary 
                ? "Review matched results and manually resolve any unmatched bank credit logs."
                : "Upload bank statement exports. Matching engine will parse transactions and auto-credit students."
              }
            </DialogDescription>
          </DialogHeader>

          {importSummary ? (
            <div className="space-y-4 my-2 flex-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
                  <div className="text-xs text-muted-foreground font-semibold">Matched</div>
                  <div className="text-lg font-bold text-emerald-500">{importSummary.matched}</div>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                  <div className="text-xs text-muted-foreground font-semibold">Unmatched</div>
                  <div className="text-lg font-bold text-amber-500">{importSummary.unmatched}</div>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2">
                  <div className="text-xs text-muted-foreground font-semibold">Duplicates</div>
                  <div className="text-lg font-bold text-blue-500">{importSummary.duplicates}</div>
                </div>
                <div className="bg-slate-500/10 border border-slate-500/20 rounded-lg p-2">
                  <div className="text-xs text-muted-foreground font-semibold">Total</div>
                  <div className="text-lg font-bold text-slate-300">{importSummary.total}</div>
                </div>
              </div>

              {importSummary.unmatchedRows && importSummary.unmatchedRows.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Unmatched Transactions ({importSummary.unmatchedRows.length})
                  </h4>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-muted/20">
                    {importSummary.unmatchedRows.map((row: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2 last:border-b-0 last:pb-0 gap-4">
                        <div className="space-y-0.5">
                          <div className="text-xs font-semibold text-foreground">
                            {row.description || 'No description'}
                          </div>
                          <div className="flex gap-2 text-[10px] text-muted-foreground">
                            <span>Ref: {row.transactionId || 'N/A'}</span>
                            <span>•</span>
                            <span>Amt: ₹{row.credit}</span>
                          </div>
                        </div>
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          className="h-7 text-xs font-bold gap-1"
                          onClick={() => handleReconcileManually(row)}
                        >
                          Tally Manual
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 my-2">
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-800 rounded-xl p-8 hover:bg-muted/10 transition cursor-pointer relative">
                <Input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                />
                <FileSpreadsheet className="h-10 w-10 text-muted-foreground mb-2" />
                <span className="text-sm font-semibold">
                  {selectedFile ? selectedFile.name : 'Click to select CSV export'}
                </span>
                <span className="text-xs text-muted-foreground mt-1">PhonePe transaction format (.csv)</span>
              </div>
            </div>
          )}

          <DialogFooter>
            {importSummary ? (
              <Button
                type="button"
                onClick={() => {
                  setUploadOpen(false);
                  setImportSummary(null);
                  setSelectedFile(null);
                }}
              >
                Close Report
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setUploadOpen(false);
                    setSelectedFile(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!selectedFile || csvMutation.isPending}
                  onClick={() => {
                    if (selectedFile) csvMutation.mutate(selectedFile);
                  }}
                >
                  {csvMutation.isPending ? 'Processing...' : 'Start Matching Engine'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
