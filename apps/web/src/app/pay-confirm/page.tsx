'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
  CheckCircle2, 
  Upload, 
  FileImage, 
  ChevronRight, 
  UserCheck, 
  AlertCircle,
  HelpCircle,
  TrendingUp,
  Receipt
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';

const parentConfirmSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, 'Must be a valid 10-digit mobile number'),
  transactionId: z.string().regex(/^\d{12}$/, 'Must be a valid 12-digit UPI transaction reference'),
});

type ParentConfirmValues = z.infer<typeof parentConfirmSchema>;

export default function ParentConfirmPage() {
  const [screenshotBase64, setScreenshotBase64] = React.useState<string | null>(null);
  const [screenshotName, setScreenshotName] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [successInfo, setSuccessInfo] = React.useState<{ studentName: string; amount: number } | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const form = useForm<ParentConfirmValues>({
    resolver: zodResolver(parentConfirmSchema),
    defaultValues: {
      phone: '',
      transactionId: '',
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setScreenshotName(file.name);

      const reader = new FileReader();
      reader.onload = () => {
        setScreenshotBase64(reader.result as string);
      };
      reader.onerror = () => {
        toast({
          title: 'Upload Failed',
          description: 'Failed to parse image file. Try another file.',
          variant: 'destructive',
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = async (values: ParentConfirmValues) => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await api.post('/payments/parent-confirm', {
        ...values,
        screenshotBase64,
      });
      setSuccessInfo({
        studentName: res.data.data.studentName,
        amount: res.data.data.amount,
      });
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'An error occurred during submission. Verify your parameters.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background blobs for premium glassmorphic depth */}
      <div className="absolute top-[-10%] left-[-10%] h-[40%] w-[40%] rounded-full bg-blue-500/10 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] h-[40%] w-[40%] rounded-full bg-emerald-500/10 blur-[120px]" />

      {successInfo ? (
        <Card className="w-full max-w-md border-emerald-500/20 bg-slate-900/60 backdrop-blur-xl shadow-2xl text-center p-6 space-y-6">
          <div className="flex justify-center">
            <div className="h-16 w-16 bg-emerald-500/15 text-emerald-400 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/10 animate-bounce">
              <CheckCircle2 className="h-10 w-10" />
            </div>
          </div>
          <div className="space-y-2">
            <CardTitle className="text-xl font-bold text-slate-100">Confirmation Submitted!</CardTitle>
            <CardDescription className="text-slate-400">
              Your payment has been successfully recorded for review.
            </CardDescription>
          </div>

          <div className="border border-slate-800 rounded-xl p-4 bg-slate-950/40 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Student Name:</span>
              <span className="font-semibold text-slate-200">{successInfo.studentName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Amount Billed:</span>
              <span className="font-semibold text-emerald-400">₹{(successInfo.amount / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Status:</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                PENDING REVIEW
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            The administrator of <strong>Hemanth's Transport Services</strong> will verify this reference and release your official PDF receipt on WhatsApp shortly.
          </p>
        </Card>
      ) : (
        <Card className="w-full max-w-md border-slate-800 bg-slate-900/40 backdrop-blur-xl shadow-2xl">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <div className="h-12 w-12 bg-blue-500/10 text-blue-400 rounded-full flex items-center justify-center">
                <Receipt className="h-6 w-6" />
              </div>
            </div>
            <CardTitle className="text-lg font-black tracking-tight text-slate-100">
              Hemanth's Transport Services
            </CardTitle>
            <CardDescription className="text-slate-400">
              Submit your UPI transaction details to verify your transport fee payment
            </CardDescription>
          </CardHeader>

          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              {errorMsg && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg p-3">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Mobile Number */}
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-xs font-bold text-slate-400">
                  Registered Parent Mobile Number
                </Label>
                <Input
                  id="phone"
                  placeholder="E.g. 9848022338"
                  className="bg-slate-950/60 border-slate-800 text-slate-200 focus:ring-blue-500 focus:border-blue-500"
                  {...form.register('phone')}
                />
                {form.formState.errors.phone ? (
                  <p className="text-[10px] text-red-400 font-semibold">{form.formState.errors.phone.message}</p>
                ) : (
                  <p className="text-[10px] text-slate-500">
                    Use the mobile number registered for transport communications.
                  </p>
                )}
              </div>

              {/* Transaction ID */}
              <div className="space-y-1.5">
                <Label htmlFor="transactionId" className="text-xs font-bold text-slate-400">
                  UPI Transaction ID (12-Digit Reference)
                </Label>
                <Input
                  id="transactionId"
                  placeholder="E.g. 618290382901"
                  maxLength={12}
                  className="bg-slate-950/60 border-slate-800 text-slate-200 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  {...form.register('transactionId')}
                />
                {form.formState.errors.transactionId ? (
                  <p className="text-[10px] text-red-400 font-semibold">{form.formState.errors.transactionId.message}</p>
                ) : (
                  <p className="text-[10px] text-slate-500">
                    Locate the 12-digit transaction Ref No. inside GPay, PhonePe, or Paytm details.
                  </p>
                )}
              </div>

              {/* Screenshot File Upload */}
              <div className="space-y-2">
                <Label className="text-xs font-bold text-slate-400">
                  Upload Payment Screenshot
                </Label>
                <div className="border border-dashed border-slate-800 hover:border-slate-700 bg-slate-950/40 rounded-xl p-4 flex flex-col items-center justify-center relative cursor-pointer group transition duration-300">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer h-full w-full"
                  />
                  <Upload className="h-6 w-6 text-slate-500 group-hover:text-slate-400 mb-1" />
                  <span className="text-xs font-semibold text-slate-300">
                    {screenshotName ? screenshotName : 'Click to select screenshot image'}
                  </span>
                  <span className="text-[10px] text-slate-500 mt-0.5">JPEG, PNG format supported</span>
                </div>

                {screenshotBase64 && (
                  <div className="mt-2 border border-slate-800 rounded-lg p-2 bg-slate-950/60 flex items-center gap-2">
                    <FileImage className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="text-xs text-slate-400 truncate max-w-[200px]">{screenshotName}</span>
                    <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full ml-auto">
                      PREVIEW READY
                    </span>
                  </div>
                )}
              </div>
            </CardContent>

            <CardFooter className="bg-slate-950/30 border-t border-slate-800/80 py-4">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold gap-2 shadow-lg shadow-blue-500/10"
              >
                {isSubmitting ? 'Submitting Details...' : 'Submit Confirmation'}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}
    </div>
  );
}
