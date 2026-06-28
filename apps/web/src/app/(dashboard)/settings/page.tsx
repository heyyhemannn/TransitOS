'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings as SettingsIcon,
  Building,
  CreditCard,
  User,
  Shield,
  Loader2,
  Lock,
  Save,
  Clock,
  Briefcase,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';

const settingsSchema = z.object({
  businessName: z.string().min(2, 'Business name must be at least 2 characters'),
  upiId: z.string().min(5, 'UPI ID is required').includes('@', { message: 'Must be a valid UPI format (e.g. merchant@ybl)' }),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuthStore();

  const isAdmin = user?.role === 'ADMIN';

  const { register, handleSubmit, reset, formState: { errors } } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
  });

  // 1. Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings-metadata'],
    queryFn: async () => {
      const res = await api.get<{ data: SettingsFormValues }>('/settings');
      return res.data.data;
    },
  });

  // Prefill form values
  React.useEffect(() => {
    if (settings) {
      reset(settings);
    }
  }, [settings, reset]);

  // 2. Settings Mutation
  const saveMutation = useMutation({
    mutationFn: async (values: SettingsFormValues) => {
      await api.post('/settings', values);
    },
    onSuccess: () => {
      toast({
        title: 'Settings Saved',
        description: 'Business configurations updated successfully.',
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['settings-metadata'] });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to save',
        description: err.response?.data?.error || 'Failed to update business configuration',
        variant: 'destructive',
      });
    },
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight">System Settings</h2>
        <p className="text-sm text-muted-foreground">Manage organization configurations and profile controls</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Business Configurations Card (occupies 2 cols) */}
        <Card className="md:col-span-2 border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Building className="h-5 w-5 text-primary" />
              Organization Profile
            </CardTitle>
            <CardDescription>
              Configure branding defaults and UPI details attached to reminder links
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit((values) => saveMutation.mutate(values))}>
            <CardContent className="space-y-4">
              {/* Warning if user is not Admin */}
              {!isAdmin && (
                <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/5 px-4 py-3 text-xs text-warning">
                  <Lock className="h-4 w-4 shrink-0" />
                  <span>
                    You are logged in as a <span className="font-bold">{user?.role}</span>. Only administrators can edit metadata properties.
                  </span>
                </div>
              )}

              {isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                  <span className="text-sm text-muted-foreground">Loading configurations...</span>
                </div>
              ) : (
                <>
                  {/* Business Name */}
                  <div className="space-y-2">
                    <Label htmlFor="businessName" className="text-xs font-bold text-muted-foreground">
                      Business Name
                    </Label>
                    <div className="relative">
                      <Building className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="businessName"
                        disabled={!isAdmin}
                        placeholder="E.g. Sri Sai Travels"
                        className="pl-10 bg-card border-slate-200 dark:border-slate-800"
                        {...register('businessName')}
                      />
                    </div>
                    {errors.businessName && (
                      <p className="text-xs text-red-500">{errors.businessName.message}</p>
                    )}
                  </div>

                  {/* UPI Merchant ID */}
                  <div className="space-y-2">
                    <Label htmlFor="upiId" className="text-xs font-bold text-muted-foreground">
                      Merchant UPI ID (Target Account)
                    </Label>
                    <div className="relative">
                      <CreditCard className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="upiId"
                        disabled={!isAdmin}
                        placeholder="E.g. travelssai@ybl"
                        className="pl-10 bg-card border-slate-200 dark:border-slate-800"
                        {...register('upiId')}
                      />
                    </div>
                    {errors.upiId && (
                      <p className="text-xs text-red-500">{errors.upiId.message}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      💡 This UPI address is parsed into a dynamic Indian QR pay-link embedded directly inside parent alert templates.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
            {isAdmin && (
              <CardFooter className="bg-muted/10 border-t py-4 flex justify-end">
                <Button
                  type="submit"
                  disabled={saveMutation.isPending || isLoading}
                  className="gap-2 font-bold shadow-md shadow-primary/10"
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Changes
                    </>
                  )}
                </Button>
              </CardFooter>
            )}
          </form>
        </Card>

        {/* User Profile Info Card (occupies 1 col) */}
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md flex flex-col justify-between">
          <div>
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <User className="h-5 w-5 text-indigo-500" />
                User Account
              </CardTitle>
              <CardDescription>Logged in session profile</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col items-center py-4 border-b">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary text-xl font-bold shadow-md shadow-primary/5">
                  {user?.name.charAt(0).toUpperCase()}
                </div>
                <h4 className="text-md font-bold text-foreground mt-3">{user?.name}</h4>
                <Badge className="mt-1.5 font-bold uppercase tracking-wider">{user?.role}</Badge>
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Shield className="h-3.5 w-3.5" />
                    Security Privilege
                  </span>
                  <span className="font-bold text-foreground">{user?.role} Access</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Account Email
                  </span>
                  <span className="font-semibold text-foreground truncate max-w-[150px]" title={user?.email}>
                    {user?.email}
                  </span>
                </div>
              </div>
            </CardContent>
          </div>
          <CardFooter className="bg-muted/10 border-t py-4 text-[10px] text-muted-foreground flex items-center gap-1.5 justify-center">
            <Briefcase className="h-3 w-3" />
            <span>TransitOS Control Console v1.0.0</span>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
