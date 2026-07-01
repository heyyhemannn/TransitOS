'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  User,
  School,
  Phone,
  MapPin,
  Clock,
  IndianRupee,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  Edit2,
  Loader2,
  Receipt,
  MessageSquare,
  Calendar,
  Bus,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
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
import { usePageRole } from '../../layout';
import Link from 'next/link';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Payment {
  id: string;
  month: number;
  year: number;
  paidAt: string | null;
  amount: number;
  method: string;
  status: 'PAID' | 'PENDING' | 'OVERDUE';
  transactionId: string | null;
  receiptUrl: string | null;
}

interface FeeSchedule {
  id: string;
  month: number;
  year: number;
  dueDate: string;
  amount: number;
  isPaid: boolean;
}

interface Student {
  id: string;
  name: string;
  school: string;
  class: string;
  parentName: string;
  fatherMobile: string;
  motherMobile: string | null;
  whatsappNumber: string;
  monthlyFee: number;
  joiningDate: string;
  status: 'ACTIVE' | 'INACTIVE';
  pickupAddress: string;
  dropAddress: string | null;
  pickupTime: string | null;
  dropTime: string | null;
  vehicleNumber: string | null;
  route: { id: string; name: string; vehicleNumber: string | null } | null;
  payments: Payment[];
  feeSchedules: FeeSchedule[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const formatCurrency = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

// ─── Payment Status Badge ──────────────────────────────────────────────────────
function StatusBadge({ status }: { status: 'PAID' | 'PENDING' | 'OVERDUE' }) {
  const config = {
    PAID: { cls: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20', icon: CheckCircle2 },
    PENDING: { cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', icon: AlertCircle },
    OVERDUE: { cls: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20', icon: AlertTriangle },
  }[status];
  const Icon = config.icon;
  return (
    <Badge className={cn('gap-1 font-bold border', config.cls)}>
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  );
}

// ─── Mark as Paid Schema ───────────────────────────────────────────────────────
const paymentSchema = z.object({
  amount: z.number().min(1, 'Amount is required'),
  method: z.enum(['UPI', 'CASH', 'BANK_TRANSFER']),
  transactionId: z.string().optional().or(z.literal('')),
  remarks: z.string().optional().or(z.literal('')),
});
type PaymentFormValues = z.infer<typeof paymentSchema>;

export default function StudentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canMutate, isAdmin } = usePageRole();

  const [payDialogOpen, setPayDialogOpen] = React.useState(false);
  const [selectedPaymentRow, setSelectedPaymentRow] = React.useState<{
    month: number;
    year: number;
    defaultAmount: number;
  } | null>(null);

  // ─── Fetch Student Detail ────────────────────────────────────────────────────
  const { data: student, isLoading, isError } = useQuery<Student>({
    queryKey: ['student', id],
    queryFn: async () => {
      const res = await api.get<{ data: Student }>(`/students/${id}`);
      return res.data.data;
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  // ─── Payment Mutation ────────────────────────────────────────────────────────
  const payForm = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { method: 'UPI', amount: 0 },
  });

  const payMutation = useMutation({
    mutationFn: async (values: PaymentFormValues & { month: number; year: number }) => {
      await api.post('/payments', {
        studentId: id,
        amount: values.amount, // backend expects rupees and converts to paise
        month: values.month,
        year: values.year,
        method: values.method,
        transactionId: values.transactionId || undefined,
        remarks: values.remarks || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: 'Payment Recorded', description: 'Payment entry has been created.', variant: 'success' as any });
      setPayDialogOpen(false);
      payForm.reset();
      queryClient.invalidateQueries({ queryKey: ['student', id] });
      queryClient.invalidateQueries({ queryKey: ['payments-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['monthly-chart'] });
      queryClient.invalidateQueries({ queryKey: ['recent-payments-feed'] });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to Record',
        description: err.response?.data?.error || 'Payment recording failed.',
        variant: 'destructive',
      });
    },
  });

  const handleOpenPayDialog = (month: number, year: number, defaultAmount: number) => {
    setSelectedPaymentRow({ month, year, defaultAmount });
    payForm.reset({
      method: 'UPI',
      amount: defaultAmount / 100, // paise → ₹
      transactionId: '',
      remarks: '',
    });
    setPayDialogOpen(true);
  };

  const onSubmitPay = (values: PaymentFormValues) => {
    if (!selectedPaymentRow) return;
    payMutation.mutate({ ...values, ...selectedPaymentRow });
  };

  // ─── Loading & Error States ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-9 w-20 rounded-lg bg-muted animate-pulse" />
          <div className="h-7 w-48 rounded-lg bg-muted animate-pulse" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 h-64 rounded-xl bg-muted animate-pulse" />
          <div className="h-64 rounded-xl bg-muted animate-pulse" />
        </div>
        <div className="h-96 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (isError || !student) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <XCircle className="h-16 w-16 text-muted-foreground/50 stroke-1" />
        <h2 className="text-xl font-bold text-foreground">Student Not Found</h2>
        <p className="text-sm text-muted-foreground">
          This student record doesn't exist or you don't have access.
        </p>
        <Button variant="outline" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Go Back
        </Button>
      </div>
    );
  }

  // ─── Build payment grid (academic year: June to May) ───────────────────────
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const startYear = currentMonth >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const endYear = startYear + 1;

  const paymentsByMonthYear = new Map<string, Payment>();
  student.payments.forEach((p) => paymentsByMonthYear.set(`${p.year}-${p.month}`, p));

  const feeSchedulesByMonthYear = new Map<string, FeeSchedule>();
  student.feeSchedules.forEach((f) => feeSchedulesByMonthYear.set(`${f.year}-${f.month}`, f));

  const academicMonths = [
    { month: 6, year: startYear },
    { month: 7, year: startYear },
    { month: 8, year: startYear },
    { month: 9, year: startYear },
    { month: 10, year: startYear },
    { month: 11, year: startYear },
    { month: 12, year: startYear },
    { month: 1, year: endYear },
    { month: 2, year: endYear },
    { month: 3, year: endYear },
    { month: 4, year: endYear },
    { month: 5, year: endYear },
  ];

  const currentYearPayments = academicMonths.map((m) => {
    const key = `${m.year}-${m.month}`;
    const payment = paymentsByMonthYear.get(key);
    const schedule = feeSchedulesByMonthYear.get(key);
    const isFuture = m.year > now.getFullYear() || (m.year === now.getFullYear() && m.month > now.getMonth() + 1);
    return { month: m.month, year: m.year, payment, schedule, isFuture };
  });

  return (
    <div className="space-y-6">
      {/* ── Back + Header ── */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="h-5 w-px bg-border" />
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-extrabold tracking-tight text-foreground">{student.name}</h2>
          <Badge
            className={cn(
              'font-bold uppercase text-[10px] tracking-widest border',
              student.status === 'ACTIVE'
                ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20'
                : 'bg-gray-500/10 text-gray-500 border-gray-500/20',
            )}
          >
            {student.status}
          </Badge>
        </div>
      </div>

      {/* ── Student Info Cards ── */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Main Info */}
        <Card className="md:col-span-2 border-slate-200 dark:border-slate-800 shadow-md">
          <CardHeader className="flex flex-row items-start justify-between pb-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                Student Profile
              </CardTitle>
              <CardDescription>Personal and transport details</CardDescription>
            </div>
            {isAdmin && (
              <Link href={`/students?edit=${student.id}`}>
                <Button variant="outline" size="sm" className="gap-2 font-bold">
                  <Edit2 className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </Link>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoRow icon={School} label="School" value={student.school} />
              <InfoRow icon={User} label="Class" value={student.class} />
              <InfoRow icon={User} label="Parent Name" value={student.parentName} />
              <InfoRow
                icon={Phone}
                label="Father's Mobile"
                value={student.fatherMobile}
                href={`tel:+91${student.fatherMobile}`}
              />
              {student.motherMobile && (
                <InfoRow
                  icon={Phone}
                  label="Mother's Mobile"
                  value={student.motherMobile}
                  href={`tel:+91${student.motherMobile}`}
                />
              )}
              <InfoRow
                icon={MessageSquare}
                label="WhatsApp"
                value={student.whatsappNumber}
                href={`https://wa.me/91${student.whatsappNumber}`}
                external
              />
              <InfoRow
                icon={IndianRupee}
                label="Monthly Fee"
                value={formatCurrency(student.monthlyFee)}
              />
              <InfoRow
                icon={Calendar}
                label="Joining Date"
                value={formatDate(student.joiningDate)}
              />
              <InfoRow
                icon={MapPin}
                label="Pickup Address"
                value={student.pickupAddress}
                className="sm:col-span-2"
              />
              {student.dropAddress && (
                <InfoRow
                  icon={MapPin}
                  label="Drop Address"
                  value={student.dropAddress}
                  className="sm:col-span-2"
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Route Card */}
        <div className="space-y-4">
          <Card className="border-slate-200 dark:border-slate-800 shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Bus className="h-4 w-4 text-indigo-500" />
                Route Assignment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {student.route ? (
                <>
                  <div className="rounded-xl bg-indigo-500/5 border border-indigo-500/20 p-4 text-center">
                    <p className="text-lg font-black text-foreground">{student.route.name}</p>
                    {student.route.vehicleNumber && (
                      <p className="text-xs text-muted-foreground mt-1">
                        🚌 {student.route.vehicleNumber}
                      </p>
                    )}
                  </div>
                  {student.pickupTime && (
                    <InfoRow icon={Clock} label="Pickup Time" value={student.pickupTime} />
                  )}
                  {student.dropTime && (
                    <InfoRow icon={Clock} label="Drop Time" value={student.dropTime} />
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center py-6 text-center text-muted-foreground">
                  <Bus className="h-10 w-10 stroke-1 mb-2 opacity-40" />
                  <p className="text-sm font-medium">No route assigned</p>
                  <p className="text-xs mt-1">Assign via Routes page</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Action */}
          <a
            href={`https://wa.me/91${student.whatsappNumber}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              variant="outline"
              className="w-full gap-2 border-green-500/30 text-green-600 dark:text-green-400 hover:bg-green-500/10 hover:border-green-500"
            >
              <MessageSquare className="h-4 w-4" />
              Message on WhatsApp
            </Button>
          </a>
        </div>
      </div>

      {/* ── Payment History — Current Year ── */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-md">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <IndianRupee className="h-4 w-4 text-green-500" />
              Payment History — {startYear}-{endYear.toString().slice(-2)}
            </CardTitle>
            <CardDescription>Academic Year months with payment status</CardDescription>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500 inline-block" /> Paid</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500 inline-block" /> Pending</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500 inline-block" /> Overdue</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Month</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Amount</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Method</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Date Paid</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {currentYearPayments.map(({ month, year, payment, schedule, isFuture }) => {
                  const status = payment?.status ?? (isFuture ? null : 'PENDING');
                  const amount = payment?.amount ?? schedule?.amount ?? student.monthlyFee;

                  return (
                    <tr key={`${year}-${month}`} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-3 font-semibold text-foreground">
                        {MONTH_NAMES[month - 1]}
                      </td>
                      <td className="py-3 px-3 font-mono text-foreground">
                        {formatCurrency(amount)}
                      </td>
                      <td className="py-3 px-3">
                        {status ? (
                          <StatusBadge status={status as any} />
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground text-xs">
                            Upcoming
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-3 text-muted-foreground text-xs">
                        {payment?.method ?? '—'}
                      </td>
                      <td className="py-3 px-3 text-muted-foreground text-xs">
                        {payment?.paidAt ? formatDate(payment.paidAt) : '—'}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          {payment?.receiptUrl && (
                            <a
                              href={payment.receiptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Button variant="ghost" size="sm" className="gap-1 text-xs h-7 px-2 text-primary">
                                <Receipt className="h-3 w-3" />
                                Receipt
                              </Button>
                            </a>
                          )}
                          {isAdmin && !isFuture && (!status || status === 'PENDING' || status === 'OVERDUE') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-xs h-7 px-2 text-green-600 border-green-500/30 hover:bg-green-500/10"
                              onClick={() => handleOpenPayDialog(month, year, amount)}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Mark Paid
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Mark as Paid Dialog ── */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-bold">Record Payment</DialogTitle>
            <DialogDescription>
              {selectedPaymentRow
                ? `${MONTH_NAMES[selectedPaymentRow.month - 1]} ${selectedPaymentRow.year} — ${student.name}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={payForm.handleSubmit(onSubmitPay)} className="space-y-4">
            {/* Amount */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground">Amount (₹)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 2000"
                className="text-base"
                {...payForm.register('amount', { valueAsNumber: true })}
              />
              {payForm.formState.errors.amount && (
                <p className="text-xs text-red-500">{payForm.formState.errors.amount.message}</p>
              )}
            </div>

            {/* Method */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground">Payment Method</Label>
              <Select
                defaultValue="UPI"
                onValueChange={(v) => payForm.setValue('method', v as any)}
              >
                <SelectTrigger className="text-base min-h-[48px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UPI">UPI</SelectItem>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Transaction ID */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground">Transaction ID (optional)</Label>
              <Input
                placeholder="UPI ref, cheque no., etc."
                className="text-base"
                {...payForm.register('transactionId')}
              />
            </div>

            {/* Remarks */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground">Remarks (optional)</Label>
              <Input
                placeholder="e.g. Cash paid at office"
                className="text-base"
                {...payForm.register('remarks')}
              />
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setPayDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={payMutation.isPending} className="gap-2 font-bold">
                {payMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                ) : (
                  <><CheckCircle2 className="h-4 w-4" /> Confirm Payment</>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Info Row Component ─────────────────────────────────────────────────────────
function InfoRow({
  icon: Icon,
  label,
  value,
  href,
  external,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href?: string;
  external?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        {href ? (
          <a
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            className="text-sm font-semibold text-primary hover:underline flex items-center gap-1 mt-0.5"
          >
            {value}
            {external && <ExternalLink className="h-3 w-3" />}
          </a>
        ) : (
          <p className="text-sm font-semibold text-foreground mt-0.5 break-words">{value}</p>
        )}
      </div>
    </div>
  );
}
