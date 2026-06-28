'use client';

import * as React from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  ChevronRight, 
  ChevronDown, 
  ChevronUp, 
  ArrowLeft,
  Calendar,
  IndianRupee,
  Bus,
  Shield,
  Loader2,
  FileImage
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface Payment {
  id: string;
  month: number;
  year: number;
  status: 'PAID' | 'PENDING' | 'OVERDUE';
  amount: number;
  paidAt: string | null;
  method: string | null;
}

interface FeeSchedule {
  month: number;
  year: number;
  dueDate: string;
  amount: number;
  isPaid: boolean;
}

interface Route {
  id: string;
  name: string;
}

interface Student {
  id: string;
  name: string;
  school: string;
  class: string;
  parentName: string;
  fatherMobile: string;
  whatsappNumber: string;
  monthlyFee: number;
  pickupAddress: string;
  dropAddress: string;
  pickupTime: string;
  dropTime: string;
  route: Route | null;
  payments: Payment[];
  feeSchedules: FeeSchedule[];
}

type ScreenState = 'idle' | 'loading' | 'found' | 'not_found' | 'error';

export default function ParentLookupPortal() {
  const [phone, setPhone] = React.useState('');
  const [state, setState] = React.useState<ScreenState>('idle');
  const [students, setStudents] = React.useState<Student[]>([]);
  const [activeTabIdx, setActiveTabIdx] = React.useState(0);
  const [infoExpanded, setInfoExpanded] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState('');

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setErrorMsg('Please enter a valid 10-digit Indian mobile number');
      return;
    }

    setState('loading');
    setErrorMsg('');
    try {
      const res = await api.post<{ data: { students: Student[] } }>('/parent/lookup', { phone });
      const found = res.data.data.students;
      if (found.length === 0) {
        setState('not_found');
      } else {
        setStudents(found);
        setActiveTabIdx(0);
        setState('found');
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Failed to search registry. Please try again.');
      setState('error');
    }
  };

  const handleReset = () => {
    setPhone('');
    setStudents([]);
    setState('idle');
    setErrorMsg('');
  };

  const currentMonthName = new Date().toLocaleDateString('en-IN', { month: 'long' });
  const currentMonthNum = new Date().getMonth() + 1;
  const currentYearNum = new Date().getFullYear();

  // 12-month calendar setup
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="min-h-screen bg-[#0A0F1E] text-slate-100 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background radial glows */}
      <div className="absolute top-[-10%] left-[-15%] h-[40%] w-[50%] rounded-full bg-blue-600/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-15%] h-[40%] w-[50%] rounded-full bg-emerald-600/10 blur-[130px] pointer-events-none" />

      {/* IDLE / NOT FOUND / ERROR SCREEN */}
      {state !== 'found' && (
        <Card className="w-full max-w-md border-slate-800/80 bg-slate-900/60 backdrop-blur-xl shadow-2xl z-10 transition-all duration-300">
          <CardHeader className="text-center pb-4">
            <div className="flex justify-center mb-3">
              <div className="h-16 w-16 bg-blue-500/10 text-blue-400 rounded-2xl flex items-center justify-center border border-blue-500/20">
                <img src="/logo.png" alt="TransitOS Logo" className="h-10 w-10 object-contain" />
              </div>
            </div>
            <CardTitle className="text-2xl font-extrabold tracking-tight text-slate-100">
              Track Transport Fees
            </CardTitle>
            <CardDescription className="text-slate-400 text-sm mt-1.5">
              Enter your registered mobile number to check fee status and download receipts
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleLookup}>
            <CardContent className="space-y-4">
              {/* Error messages */}
              {(errorMsg || state === 'not_found' || state === 'error') && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg p-3">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>
                    {state === 'not_found' 
                      ? 'No active student registry matches this mobile number. Verify and try again.' 
                      : errorMsg || 'An error occurred. Please try again.'}
                  </span>
                </div>
              )}

              {/* Input phone number */}
              <div className="space-y-1.5">
                <div className="relative">
                  <div className="absolute left-3.5 top-[18px] text-sm font-bold text-slate-400 border-r border-slate-800 pr-2">
                    +91
                  </div>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="9876543210"
                    disabled={state === 'loading'}
                    className="bg-slate-950/70 border-slate-800 text-slate-200 text-base pl-[60px] h-[56px] focus:ring-blue-500 focus:border-blue-500 font-semibold tracking-wide"
                  />
                </div>
                <p className="text-[10px] text-slate-500 text-center">
                  Use the number where you receive WhatsApp fee alerts.
                </p>
              </div>
            </CardContent>

            <CardFooter className="pt-2">
              <Button
                type="submit"
                disabled={state === 'loading'}
                className="w-full h-[56px] text-base font-bold bg-blue-600 hover:bg-[#25D366] hover:text-slate-950 text-white transition-all duration-300 gap-2 shadow-lg shadow-blue-500/10"
              >
                {state === 'loading' ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Finding Student...
                  </>
                ) : (
                  <>
                    View Payment Status
                    <ChevronRight className="h-5 w-5" />
                  </>
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* FOUND STATE SCREEN */}
      {state === 'found' && students.length > 0 && (() => {
        const student = students[activeTabIdx];

        // Process monthly fee schedules & tally outstanding dues
        const schedules = student.feeSchedules || [];
        const payments = student.payments || [];

        // Check current month status
        const thisMonthSched = schedules.find((s) => s.month === currentMonthNum && s.year === currentYearNum);
        const thisMonthPay = payments.find((p) => p.month === currentMonthNum && p.year === currentYearNum);

        let currentStatus: 'PAID' | 'PENDING' | 'OVERDUE' = 'PENDING';
        if (thisMonthPay) {
          currentStatus = thisMonthPay.status;
        } else if (thisMonthSched) {
          const now = new Date();
          const due = new Date(thisMonthSched.dueDate);
          if (!thisMonthSched.isPaid && due < now) {
            currentStatus = 'OVERDUE';
          }
        }

        // Tally totals
        const overdueSchedules = schedules.filter((s) => !s.isPaid && new Date(s.dueDate) < new Date());
        const pendingSchedules = schedules.filter((s) => !s.isPaid && new Date(s.dueDate) >= new Date());
        
        const totalDuesAmount = overdueSchedules.reduce((acc, curr) => acc + curr.amount, 0) + 
                                pendingSchedules.reduce((acc, curr) => acc + curr.amount, 0);
        const unpaidMonthsCount = overdueSchedules.length + pendingSchedules.length;

        return (
          <div className="w-full max-w-lg space-y-4 z-10 py-6 transition-all duration-300">
            {/* Back button */}
            <Button
              variant="ghost"
              onClick={handleReset}
              className="text-slate-400 hover:text-slate-200 pl-0 hover:bg-transparent font-semibold gap-1.5"
            >
              <ArrowLeft className="h-4 w-4" />
              Check another number
            </Button>

            {/* Multiple student tabs */}
            {students.length > 1 && (
              <div className="flex gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
                {students.map((st, idx) => (
                  <Button
                    key={st.id}
                    variant={idx === activeTabIdx ? 'default' : 'outline'}
                    onClick={() => {
                      setActiveTabIdx(idx);
                      setInfoExpanded(false);
                    }}
                    className={`shrink-0 text-xs font-bold ${
                      idx === activeTabIdx 
                        ? 'bg-blue-600 hover:bg-blue-500 text-white' 
                        : 'border-slate-800 text-slate-400 hover:text-slate-200 bg-slate-900/30'
                    }`}
                  >
                    {st.name.split(' ')[0]}
                  </Button>
                ))}
              </div>
            )}

            {/* CURRENT MONTH STATUS CARD */}
            <Card className="border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-900/60 backdrop-blur-xl shadow-xl overflow-hidden relative">
              {/* Highlight status glow */}
              <div className={`absolute top-0 left-0 right-0 h-1.5 ${
                currentStatus === 'PAID' ? 'bg-emerald-500' : currentStatus === 'OVERDUE' ? 'bg-red-500' : 'bg-amber-500'
              }`} />

              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase">
                    Status for {currentMonthName}
                  </span>
                  <span className={`flex items-center gap-1.5 text-xs font-extrabold px-2.5 py-1 rounded-full border ${
                    currentStatus === 'PAID'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : currentStatus === 'OVERDUE'
                      ? 'bg-red-500/10 text-red-400 border-red-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    {currentStatus === 'PAID' && <CheckCircle2 className="h-3.5 w-3.5" />}
                    {currentStatus === 'PENDING' && <Clock className="h-3.5 w-3.5" />}
                    {currentStatus === 'OVERDUE' && <AlertCircle className="h-3.5 w-3.5" />}
                    {currentStatus}
                  </span>
                </div>

                <div className="flex justify-between items-baseline">
                  <div>
                    <div className="text-3xl font-black text-slate-100">
                      ₹{(student.monthlyFee / 100).toLocaleString('en-IN')}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {thisMonthSched ? `Due date: ${new Date(thisMonthSched.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'Fees schedule active'}
                    </p>
                  </div>

                  {currentStatus !== 'PAID' && (
                    <Button 
                      asChild
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs gap-1 h-9 px-4 rounded-lg"
                    >
                      <Link href="/pay-confirm">
                        <FileImage className="h-3.5 w-3.5" />
                        Submit Proof
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* DUES SUMMARY */}
            {totalDuesAmount > 0 && (
              <Card className="border-amber-500/20 bg-amber-500/5 backdrop-blur-xl p-4 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-amber-500 uppercase tracking-wider">
                    Total Dues Outstanding
                  </div>
                  <div className="text-lg font-black text-amber-400">
                    ₹{(totalDuesAmount / 100).toLocaleString('en-IN')}
                  </div>
                </div>
                <span className="text-[10px] font-bold text-amber-400 border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 rounded-full shrink-0">
                  {unpaidMonthsCount} Month{unpaidMonthsCount > 1 ? 's' : ''} Unpaid
                </span>
              </Card>
            )}

            {/* 12-MONTH TIMELINE GRID */}
            <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-xl shadow-lg">
              <CardHeader className="pb-3 border-b border-slate-800/80">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Payment History (Current & Past Year)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-5">
                {/* 2 Rows x 6 Cols Grid for Mobile & Tablets */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {monthNames.map((mName, idx) => {
                    const monthNum = idx + 1;
                    const pay = payments.find((p) => p.month === monthNum && p.year === currentYearNum);
                    const sched = schedules.find((s) => s.month === monthNum && s.year === currentYearNum);

                    let status: 'PAID' | 'PENDING' | 'OVERDUE' | 'FUTURE' = 'FUTURE';

                    if (pay) {
                      status = pay.status;
                    } else if (sched) {
                      const now = new Date();
                      const due = new Date(sched.dueDate);
                      if (!sched.isPaid) {
                        status = due < now ? 'OVERDUE' : 'PENDING';
                      }
                    }

                    return (
                      <div 
                        key={mName}
                        className={`rounded-xl p-3 border text-center space-y-1.5 transition-all duration-200 ${
                          status === 'PAID'
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                            : status === 'OVERDUE'
                            ? 'bg-red-500/10 border-red-500/20 text-red-400'
                            : status === 'PENDING'
                            ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                            : 'bg-slate-950/20 border-slate-800 text-slate-500'
                        }`}
                      >
                        <div className="text-xs font-bold uppercase tracking-wider">{mName}</div>
                        
                        <div className="flex justify-center">
                          {status === 'PAID' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                          {status === 'OVERDUE' && <AlertCircle className="h-4 w-4 shrink-0" />}
                          {status === 'PENDING' && <Clock className="h-4 w-4 shrink-0" />}
                          {status === 'FUTURE' && <div className="h-4 w-4 rounded-full border-2 border-dotted border-slate-800 shrink-0" />}
                        </div>

                        <div className="text-[9px] font-black leading-none">
                          {status === 'PAID' && `₹${((pay?.amount || 0) / 100).toFixed(0)}`}
                          {status === 'OVERDUE' && `₹${((sched?.amount || 0) / 100).toFixed(0)}`}
                          {status === 'PENDING' && `₹${((sched?.amount || 0) / 100).toFixed(0)}`}
                          {status === 'FUTURE' && '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* STUDENT & VEHICLE INFO */}
            <Card className="border-slate-800 bg-slate-900/40 backdrop-blur-xl">
              <Button
                variant="ghost"
                onClick={() => setInfoExpanded(!infoExpanded)}
                className="w-full flex justify-between items-center p-4 hover:bg-slate-800/10 text-slate-300 font-bold"
              >
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Student Registry Details
                </span>
                {infoExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>

              {infoExpanded && (
                <CardContent className="px-4 pb-4 border-t border-slate-800/80 pt-4 text-xs space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Student Name</div>
                      <div className="text-slate-200 font-semibold text-sm mt-0.5">{student.name}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">School / Class</div>
                      <div className="text-slate-200 font-semibold mt-0.5">{student.school} (Class {student.class})</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Assigned Route</div>
                      <div className="text-slate-200 font-semibold mt-0.5">
                        {student.route?.name || 'Unassigned'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Father Mobile</div>
                      <div className="text-slate-200 font-mono mt-0.5">{student.fatherMobile}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Pickup Time</div>
                      <div className="text-slate-200 font-semibold mt-0.5">{student.pickupTime}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Drop Time</div>
                      <div className="text-slate-200 font-semibold mt-0.5">{student.dropTime}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Pickup Address</div>
                    <div className="text-slate-300 mt-0.5 leading-relaxed">{student.pickupAddress}</div>
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        );
      })()}
    </div>
  );
}
