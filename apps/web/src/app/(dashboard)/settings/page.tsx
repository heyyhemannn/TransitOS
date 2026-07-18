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
  Calendar,
  Bell,
  Edit2,
  Check,
  X,
  Plus,
  UserPlus,
  Phone,
  MessageSquare,
  Trash2,
  KeyRound,
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
import { cn } from '@/lib/utils';

// ─── Schemas ────────────────────────────────────────────────────────────────────
const settingsSchema = z.object({
  businessName: z.string().min(2, 'Business name must be at least 2 characters'),
  upiId: z.string().min(5, 'UPI ID is required').includes('@', { message: 'Must be a valid UPI format (e.g. merchant@ybl)' }),
  adminWhatsapp: z.string().optional().or(z.literal('')),
  adminPhone: z.string().optional().or(z.literal('')),
});
type SettingsFormValues = z.infer<typeof settingsSchema>;

const scheduleSchema = z.object({
  schoolName: z.string().min(2),
  reminder1Day: z.number().int().min(1).max(31),
  reminder2Day: z.number().int().min(1).max(31),
  reminder3Day: z.number().int().min(1).max(31),
});
type ScheduleFormValues = z.infer<typeof scheduleSchema>;

const userSchema = z.object({
  name: z.string().min(2, 'Name required'),
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'At least 8 characters'),
  role: z.enum(['ADMIN', 'MANAGER', 'DRIVER']),
});
type UserFormValues = z.infer<typeof userSchema>;

const changePasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

interface SchoolSchedule {
  id: string;
  schoolName: string;
  reminder1Day: number;
  reminder2Day: number;
  reminder3Day: number;
}

interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  // ─── Edit schedule state ─────────────────────────────────────────────────────
  const [editScheduleId, setEditScheduleId] = React.useState<string | null>(null);
  const [scheduleEdits, setScheduleEdits] = React.useState<Record<string, ScheduleFormValues>>({});
  const [addScheduleOpen, setAddScheduleOpen] = React.useState(false);
  const [addUserOpen, setAddUserOpen] = React.useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false);
  const [selectedUserForPasswordChange, setSelectedUserForPasswordChange] = React.useState<AppUser | null>(null);

  // ─── Business Settings ───────────────────────────────────────────────────────
  const { register, handleSubmit, reset, formState: { errors } } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
  });

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings-metadata'],
    queryFn: async () => {
      const res = await api.get<{ data: SettingsFormValues }>('/settings');
      return res.data.data;
    },
  });

  React.useEffect(() => {
    if (settings) reset(settings);
  }, [settings, reset]);

  const saveMutation = useMutation({
    mutationFn: async (values: SettingsFormValues) => {
      await api.post('/settings', values);
    },
    onSuccess: () => {
      toast({ title: 'Settings Saved', description: 'Business configurations updated.', variant: 'success' as any });
      queryClient.invalidateQueries({ queryKey: ['settings-metadata'] });
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.error || 'Update failed', variant: 'destructive' });
    },
  });

  // ─── School Schedules ────────────────────────────────────────────────────────
  const { data: schedules, isLoading: schedulesLoading } = useQuery<SchoolSchedule[]>({
    queryKey: ['school-schedules'],
    queryFn: async () => {
      const res = await api.get<{ data: SchoolSchedule[] }>('/settings/school-schedules');
      return res.data.data;
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: ScheduleFormValues }) => {
      await api.put(`/settings/school-schedules/${id}`, values);
    },
    onSuccess: () => {
      toast({ title: 'Schedule Updated', variant: 'success' as any });
      setEditScheduleId(null);
      queryClient.invalidateQueries({ queryKey: ['school-schedules'] });
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.error || 'Update failed', variant: 'destructive' });
    },
  });

  const addScheduleForm = useForm<ScheduleFormValues>({ resolver: zodResolver(scheduleSchema) });

  const addScheduleMutation = useMutation({
    mutationFn: async (values: ScheduleFormValues) => {
      await api.post('/settings/school-schedules', values);
    },
    onSuccess: () => {
      toast({ title: 'Schedule Added', variant: 'success' as any });
      setAddScheduleOpen(false);
      addScheduleForm.reset();
      queryClient.invalidateQueries({ queryKey: ['school-schedules'] });
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.error || 'Add failed', variant: 'destructive' });
    },
  });

  // ─── User Management ─────────────────────────────────────────────────────────
  const { data: users, isLoading: usersLoading } = useQuery<AppUser[]>({
    queryKey: ['users-list'],
    queryFn: async () => {
      const res = await api.get<{ data: AppUser[] }>('/auth/users');
      return res.data.data;
    },
    enabled: isAdmin,
  });

  const addUserForm = useForm<UserFormValues>({ resolver: zodResolver(userSchema), defaultValues: { role: 'MANAGER' } });

  const addUserMutation = useMutation({
    mutationFn: async (values: UserFormValues) => {
      await api.post('/auth/register', values);
    },
    onSuccess: () => {
      toast({ title: 'User Created', description: 'Login credentials sent.', variant: 'success' as any });
      setAddUserOpen(false);
      addUserForm.reset();
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.error || 'User creation failed', variant: 'destructive' });
    },
  });

  const deactivateUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.patch(`/auth/users/${userId}/deactivate`);
    },
    onSuccess: () => {
      toast({ title: 'User Deactivated', variant: 'success' as any });
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.error || 'Deactivation failed', variant: 'destructive' });
    },
  });

  const changePasswordForm = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { password: '' },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: ChangePasswordFormValues['password'] }) => {
      await api.post(`/auth/users/${userId}/change-password`, { password });
    },
    onSuccess: () => {
      toast({ title: 'Password Updated', description: 'User password changed successfully.', variant: 'success' as any });
      setChangePasswordOpen(false);
      changePasswordForm.reset();
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.error || 'Password update failed', variant: 'destructive' });
    },
  });

  const ROLE_COLORS: Record<string, string> = {
    ADMIN: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    MANAGER: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    DRIVER: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
  };

  return (
    <div className="space-y-8">
      {/* ══ Section 1: Business Settings ══ */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 border-slate-200 dark:border-slate-800 bg-card shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Building className="h-5 w-5 text-primary" />
              Organization Profile
            </CardTitle>
            <CardDescription>
              Configure branding, UPI details, and contact info for reminder templates
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
            <CardContent className="space-y-4">
              {!isAdmin && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
                  <Lock className="h-4 w-4 shrink-0" />
                  <span>Only administrators can edit organization settings.</span>
                </div>
              )}
              {settingsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                  <span className="text-sm text-muted-foreground">Loading...</span>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="businessName" className="text-xs font-bold text-muted-foreground uppercase">Business Name</Label>
                    <div className="relative">
                      <Building className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="businessName" disabled={!isAdmin} placeholder="E.g. Sri Sai Travels" className="pl-10 min-h-[48px] text-base" {...register('businessName')} />
                    </div>
                    {errors.businessName && <p className="text-xs text-red-500">{errors.businessName.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="upiId" className="text-xs font-bold text-muted-foreground uppercase">Merchant UPI ID</Label>
                    <div className="relative">
                      <CreditCard className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="upiId" disabled={!isAdmin} placeholder="E.g. travelssai@ybl" className="pl-10 min-h-[48px] text-base" {...register('upiId')} />
                    </div>
                    {errors.upiId && <p className="text-xs text-red-500">{errors.upiId.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="adminWhatsapp" className="text-xs font-bold text-muted-foreground uppercase">Admin WhatsApp Number</Label>
                    <div className="relative">
                      <MessageSquare className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="adminWhatsapp" disabled={!isAdmin} placeholder="E.g. 9010009976" className="pl-10 min-h-[48px] text-base" {...register('adminWhatsapp')} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="adminPhone" className="text-xs font-bold text-muted-foreground uppercase">Admin Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="adminPhone" disabled={!isAdmin} placeholder="E.g. 9010009976" className="pl-10 min-h-[48px] text-base" {...register('adminPhone')} />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
            {isAdmin && (
              <CardFooter className="bg-muted/10 border-t py-4 flex justify-end">
                <Button type="submit" disabled={saveMutation.isPending || settingsLoading} className="gap-2 font-bold shadow-md shadow-primary/10">
                  {saveMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : <><Save className="h-4 w-4" /> Save Changes</>}
                </Button>
              </CardFooter>
            )}
          </form>
        </Card>

        {/* User Profile Info */}
        <Card className="border-slate-200 dark:border-slate-800 bg-card shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <User className="h-5 w-5 text-indigo-500" />
              Your Account
            </CardTitle>
            <CardDescription>Current session profile</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col items-center py-4 border-b">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary text-xl font-bold shadow-md shadow-primary/5">
                {user?.name.charAt(0).toUpperCase()}
              </div>
              <h4 className="text-md font-bold text-foreground mt-3">{user?.name}</h4>
              <Badge className={cn('mt-1.5 font-bold uppercase tracking-wider border', ROLE_COLORS[user?.role ?? 'MANAGER'])}>
                {user?.role}
              </Badge>
            </div>
            <div className="space-y-3 pt-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><Shield className="h-3.5 w-3.5" /> Security Level</span>
                <span className="font-bold text-foreground">{user?.role} Access</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Email</span>
                <span className="font-semibold text-foreground truncate max-w-[150px]" title={user?.email}>{user?.email}</span>
              </div>
            </div>
          </CardContent>
          <CardFooter className="bg-muted/10 border-t py-4 text-[10px] text-muted-foreground flex items-center gap-1.5 justify-center">
            <Briefcase className="h-3 w-3" />
            <span>TransitOS Control Console v1.0.0</span>
          </CardFooter>
        </Card>
      </div>

      {/* ══ Section 2: School Reminder Schedules ══ */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-md">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Bell className="h-5 w-5 text-amber-500" />
              School Reminder Schedules
            </CardTitle>
            <CardDescription>
              Configure day-of-month for each school's payment reminder crons
            </CardDescription>
          </div>
          {isAdmin && (
            <Button size="sm" variant="outline" className="gap-2 font-bold" onClick={() => setAddScheduleOpen(true)}>
              <Plus className="h-4 w-4" />
              Add School
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {schedulesLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b">
                    {['School', 'Reminder 1 (Day)', 'Reminder 2 (Day)', 'Final (Day)', 'Actions'].map((h) => (
                      <th key={h} className="text-left py-2 px-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {schedules?.map((s) => {
                    const isEditing = editScheduleId === s.id;
                    const edits = scheduleEdits[s.id] ?? s;
                    return (
                      <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3 font-semibold text-foreground">{s.schoolName}</td>
                        {(['reminder1Day', 'reminder2Day', 'reminder3Day'] as const).map((field) => (
                          <td key={field} className="py-3 px-3">
                            {isEditing ? (
                              <Input
                                type="number"
                                min={1}
                                max={31}
                                value={edits[field]}
                                onChange={(e) =>
                                  setScheduleEdits((prev) => ({
                                    ...prev,
                                    [s.id]: { ...edits, [field]: Number(e.target.value) },
                                  }))
                                }
                                className="h-8 w-20 text-sm text-center"
                              />
                            ) : (
                              <span className="font-mono text-foreground">Day {s[field]}</span>
                            )}
                          </td>
                        ))}
                        <td className="py-3 px-3">
                          {isAdmin && (
                            <div className="flex items-center gap-2">
                              {isEditing ? (
                                <>
                                  <Button
                                    size="sm"
                                    className="h-7 px-2 gap-1 text-xs font-bold"
                                    onClick={() => updateScheduleMutation.mutate({ id: s.id, values: edits })}
                                    disabled={updateScheduleMutation.isPending}
                                  >
                                    {updateScheduleMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setEditScheduleId(null)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 gap-1 text-xs text-muted-foreground"
                                  onClick={() => {
                                    setEditScheduleId(s.id);
                                    setScheduleEdits((prev) => ({ ...prev, [s.id]: s }));
                                  }}
                                >
                                  <Edit2 className="h-3 w-3" />
                                  Edit
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {(!schedules || schedules.length === 0) && (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        <Bell className="h-8 w-8 mx-auto mb-2 opacity-30 stroke-1" />
                        No schedules configured yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══ Section 3: User Management ══ */}
      {isAdmin && (
        <Card className="border-slate-200 dark:border-slate-800 shadow-md">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-blue-500" />
                User Management
              </CardTitle>
              <CardDescription>Manage admin, manager, and driver accounts</CardDescription>
            </div>
            <Button size="sm" variant="outline" className="gap-2 font-bold" onClick={() => setAddUserOpen(true)}>
              <Plus className="h-4 w-4" />
              Add User
            </Button>
          </CardHeader>
          <CardContent>
            {usersLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="border-b">
                      {['Name', 'Email', 'Role', 'Status', 'Actions'].map((h) => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users?.map((u) => (
                      <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-semibold text-foreground">{u.name}</span>
                            {u.id === user?.id && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground">You</Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-muted-foreground text-xs font-mono">{u.email}</td>
                        <td className="py-3 px-3">
                          <Badge className={cn('border font-bold uppercase text-[10px]', ROLE_COLORS[u.role])}>{u.role}</Badge>
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            variant="outline"
                            className={cn('border font-bold uppercase text-[10px]', u.isActive
                              ? 'text-green-600 border-green-500/30 bg-green-500/10'
                              : 'text-gray-500 border-gray-500/30 bg-gray-500/10'
                            )}
                          >
                            {u.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            {u.isActive && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 gap-1 text-xs text-indigo-500 hover:text-indigo-600 hover:bg-indigo-500/10"
                                onClick={() => {
                                  setSelectedUserForPasswordChange(u);
                                  setChangePasswordOpen(true);
                                }}
                              >
                                <KeyRound className="h-3 w-3" />
                                Change Password
                              </Button>
                            )}
                            {u.id !== user?.id && u.isActive && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 gap-1 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                onClick={() => deactivateUserMutation.mutate(u.id)}
                                disabled={deactivateUserMutation.isPending}
                              >
                                <Trash2 className="h-3 w-3" />
                                Deactivate
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ══ Add Schedule Dialog ══ */}
      <Dialog open={addScheduleOpen} onOpenChange={setAddScheduleOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Add School Schedule</DialogTitle>
            <DialogDescription>Configure reminder days for a new school</DialogDescription>
          </DialogHeader>
          <form onSubmit={addScheduleForm.handleSubmit((v) => addScheduleMutation.mutate(v))} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase">School Name</Label>
              <Input placeholder="E.g. DPS Phase 2" className="min-h-[48px] text-base" {...addScheduleForm.register('schoolName')} />
              {addScheduleForm.formState.errors.schoolName && (
                <p className="text-xs text-red-500">{addScheduleForm.formState.errors.schoolName.message}</p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { field: 'reminder1Day', label: 'Reminder 1' },
                { field: 'reminder2Day', label: 'Reminder 2' },
                { field: 'reminder3Day', label: 'Final' },
              ].map(({ field, label }) => (
                <div key={field} className="space-y-2">
                  <Label className="text-xs font-bold text-muted-foreground">{label} Day</Label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    className="text-center text-base"
                    {...addScheduleForm.register(field as any, { valueAsNumber: true })}
                  />
                </div>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setAddScheduleOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={addScheduleMutation.isPending} className="gap-2 font-bold">
                {addScheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Schedule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ══ Add User Dialog ══ */}
      <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold">Add New User</DialogTitle>
            <DialogDescription>Create an admin, manager, or driver account</DialogDescription>
          </DialogHeader>
          <form onSubmit={addUserForm.handleSubmit((v) => addUserMutation.mutate(v))} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Full Name</Label>
              <Input placeholder="E.g. Ravi Kumar" className="min-h-[48px] text-base" {...addUserForm.register('name')} />
              {addUserForm.formState.errors.name && <p className="text-xs text-red-500">{addUserForm.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Email Address</Label>
              <Input type="email" placeholder="ravi@stms.com" className="min-h-[48px] text-base" {...addUserForm.register('email')} />
              {addUserForm.formState.errors.email && <p className="text-xs text-red-500">{addUserForm.formState.errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Password</Label>
              <Input type="password" placeholder="Min 8 characters" className="min-h-[48px] text-base" {...addUserForm.register('password')} />
              {addUserForm.formState.errors.password && <p className="text-xs text-red-500">{addUserForm.formState.errors.password.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase">Role</Label>
              <Select defaultValue="MANAGER" onValueChange={(v) => addUserForm.setValue('role', v as any)}>
                <SelectTrigger className="min-h-[48px] text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="DRIVER">Driver</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setAddUserOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={addUserMutation.isPending} className="gap-2 font-bold">
                {addUserMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Create User
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ══ Change Password Dialog ══ */}
      <Dialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-bold flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-indigo-500" />
              Change Password
            </DialogTitle>
            <DialogDescription>
              Set a new password for <span className="font-semibold text-foreground">{selectedUserForPasswordChange?.name}</span>
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={changePasswordForm.handleSubmit((v) => {
              if (selectedUserForPasswordChange) {
                changePasswordMutation.mutate({
                  userId: selectedUserForPasswordChange.id,
                  password: v.password,
                });
              }
            })}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase">New Password</Label>
              <Input
                type="password"
                placeholder="Min 8 characters"
                className="min-h-[48px] text-base"
                {...changePasswordForm.register('password')}
              />
              {changePasswordForm.formState.errors.password && (
                <p className="text-xs text-red-500">{changePasswordForm.formState.errors.password.message}</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setChangePasswordOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={changePasswordMutation.isPending} className="gap-2 font-bold">
                {changePasswordMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
