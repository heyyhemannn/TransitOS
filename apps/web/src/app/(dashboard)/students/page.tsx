'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  School,
  Route as RouteIcon,
  Phone,
  MoreVertical,
  Edit2,
  Trash2,
  Grid,
  Send,
  Loader2,
  CheckCircle,
  XCircle,
  FileSpreadsheet,
  Users,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

import { usePageRole } from '../layout';

// Form validation schema
const studentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  school: z.string().min(2, 'School is required'),
  class: z.string().min(1, 'Class is required'),
  routeId: z.string().nullable().optional().or(z.literal('')),
  parentName: z.string().min(2, 'Parent name is required'),
  fatherMobile: z.string().regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian mobile number'),
  motherMobile: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian mobile number')
    .optional()
    .nullable()
    .or(z.literal('')),
  whatsappNumber: z.string().regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian mobile number'),
  monthlyFee: z.number().min(0, 'Monthly fee must be positive'),
  pickupAddress: z.string().min(5, 'Pickup address is required'),
});

type StudentFormValues = z.infer<typeof studentSchema>;

export default function StudentsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canMutate } = usePageRole();

  // Search & Filter State
  const [search, setSearch] = React.useState('');
  const [schoolFilter, setSchoolFilter] = React.useState('ALL');
  const [routeFilter, setRouteFilter] = React.useState('ALL');
  const [page, setPage] = React.useState(1);
  const limit = 15;

  // Modals visibility
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [matrixOpen, setMatrixOpen] = React.useState(false);

  // Selected entities
  const [selectedStudent, setSelectedStudent] = React.useState<any>(null);
  const [feeMatrix, setFeeMatrix] = React.useState<any[]>([]);

  // 1. Fetch Students
  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['students', search, schoolFilter, routeFilter, page],
    queryFn: async () => {
      const params: Record<string, any> = { page, limit, status: 'ACTIVE' };
      if (search) params.search = search;
      if (schoolFilter !== 'ALL') params.school = schoolFilter;
      if (routeFilter !== 'ALL') params.routeId = routeFilter;

      const res = await api.get<{
        data: {
          students: any[];
          total: number;
          page: number;
          totalPages: number;
        };
      }>('/students', { params });
      return res.data.data;
    },
    refetchInterval: 5000,
  });

  // 2. Fetch active Routes for selection
  const { data: routes } = useQuery({
    queryKey: ['routes-selection'],
    queryFn: async () => {
      const res = await api.get<{ data: any[] }>('/routes');
      return res.data.data;
    },
  });

  // Forms setup
  const createForm = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      routeId: '',
      motherMobile: '',
    },
  });

  const editForm = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
  });

  // 3. Create Student Mutation
  const createMutation = useMutation({
    mutationFn: async (values: StudentFormValues) => {
      // API expects amount in paise
      const payload = {
        ...values,
        monthlyFee: Math.round(values.monthlyFee * 100),
        routeId: values.routeId || null,
      };
      await api.post('/students', payload);
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Student registered successfully', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setCreateOpen(false);
      createForm.reset();
    },
    onError: (err: any) => {
      toast({
        title: 'Registration failed',
        description: err.response?.data?.error || 'Failed to register student',
        variant: 'destructive',
      });
    },
  });

  // 4. Edit Student Mutation
  const editMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: StudentFormValues }) => {
      const payload = {
        ...values,
        monthlyFee: Math.round(values.monthlyFee * 100),
        routeId: values.routeId || null,
      };
      await api.put(`/students/${id}`, payload);
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Student profile updated', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setEditOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Update failed',
        description: err.response?.data?.error || 'Failed to update student',
        variant: 'destructive',
      });
    },
  });

  // 5. Soft Delete Student Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/students/${id}`);
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Student status updated to INACTIVE', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setDeleteOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Deactivation failed',
        description: err.response?.data?.error || 'Failed to deactivate student',
        variant: 'destructive',
      });
    },
  });

  // 6. Broadcast Reminder Notification Mutation
  const broadcastMutation = useMutation({
    mutationFn: async (studentId: string) => {
      await api.post('/whatsapp/broadcast', {
        studentIds: [studentId],
        type: 'REMINDER_1',
      });
    },
    onSuccess: () => {
      toast({
        title: 'Notification Queued',
        description: 'WhatsApp reminder successfully queued for sending.',
        variant: 'success',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to send notification',
        description: err.response?.data?.error || 'Ensure WhatsApp is linked.',
        variant: 'destructive',
      });
    },
  });

  const handleEditClick = (student: any) => {
    setSelectedStudent(student);
    editForm.reset({
      name: student.name,
      school: student.school,
      class: student.class,
      routeId: student.routeId || '',
      parentName: student.parentName,
      fatherMobile: student.fatherMobile,
      motherMobile: student.motherMobile || '',
      whatsappNumber: student.whatsappNumber,
      monthlyFee: student.monthlyFee / 100, // Convert to rupees for form
      pickupAddress: student.pickupAddress,
    });
    setEditOpen(true);
  };

  const handleDeleteClick = (student: any) => {
    setSelectedStudent(student);
    setDeleteOpen(true);
  };

  const handleMatrixClick = async (student: any) => {
    setSelectedStudent(student);
    setMatrixOpen(true);
    setFeeMatrix([]);
    try {
      const res = await api.get<{ data: any[] }>(`/students/${student.id}/payments`);
      setFeeMatrix(res.data.data);
    } catch {
      toast({ title: 'Error', description: 'Failed to load fee matrix', variant: 'destructive' });
    }
  };

  // Helper lists for dropdown filters
  const schoolsList = ['ALL', 'DPS BRINDAVANAM', 'DPS PHASE 2', 'UNICENT'];

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Active Registrations</h2>
            <p className="text-sm text-muted-foreground">List and configure active student profiles</p>
          </div>
          {!canMutate && (
            <Badge variant="outline" className="text-amber-500 border-amber-500 bg-amber-500/10 font-bold">
              View Only
            </Badge>
          )}
        </div>
        {canMutate && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2 font-bold shadow-md shadow-primary/20">
            <Plus className="h-4 w-4" />
            Add Student
          </Button>
        )}
      </div>

      {/* Filters Toolbar */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search student or parent..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9 bg-card border-slate-200 dark:border-slate-800"
          />
        </div>

        <Select
          value={schoolFilter}
          onValueChange={(val: string) => {
            setSchoolFilter(val);
            setPage(1);
          }}
        >
          <SelectTrigger className="bg-card border-slate-200 dark:border-slate-800">
            <SelectValue placeholder="Filter by School" />
          </SelectTrigger>
          <SelectContent>
            {schoolsList.map((school) => (
              <SelectItem key={school} value={school}>
                {school === 'ALL' ? 'All Schools' : school}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Responsive View: Table on Desktop, Cards on Mobile */}
      <div className="space-y-4">
        {/* MOBILE CARD LIST VIEW */}
        <div className="grid gap-4 grid-cols-1 md:hidden">
          {studentsLoading ? (
            Array.from({ length: 4 }).map((_, idx) => (
              <Card key={idx} className="animate-pulse border-slate-200 dark:border-slate-800 bg-card p-4 space-y-3">
                <div className="h-4 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-3 w-1/4 rounded bg-slate-200 dark:bg-slate-800" />
              </Card>
            ))
          ) : studentsData?.students && studentsData.students.length > 0 ? (
            studentsData.students.map((student) => (
              <Card key={student.id} className="border-slate-200 dark:border-slate-800 bg-card p-4 hover:shadow-md transition-shadow relative">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-foreground text-base">{student.name}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">Parent: {student.parentName}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem asChild className="gap-2">
                        <Link href={`/students/${student.id}`}>
                          <ExternalLink className="h-3.5 w-3.5" /> View Details
                        </Link>
                      </DropdownMenuItem>
                      {canMutate && (
                        <DropdownMenuItem onClick={() => handleEditClick(student)} className="gap-2">
                          <Edit2 className="h-3.5 w-3.5" /> Edit Profile
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleMatrixClick(student)} className="gap-2">
                        <Grid className="h-3.5 w-3.5" /> Fee Ledger Matrix
                      </DropdownMenuItem>
                      {canMutate && (
                        <DropdownMenuItem onClick={() => broadcastMutation.mutate(student.id)} className="gap-2">
                          <Send className="h-3.5 w-3.5 text-primary" /> Send Fee Reminder
                        </DropdownMenuItem>
                      )}
                      {canMutate && <DropdownMenuSeparator />}
                      {canMutate && (
                        <DropdownMenuItem onClick={() => handleDeleteClick(student)} className="gap-2 text-destructive">
                          <Trash2 className="h-3.5 w-3.5" /> Delete Student
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground border-t pt-3">
                  <span className="flex items-center gap-1">
                    <School className="h-3.5 w-3.5" />
                    {student.school} ({student.class})
                  </span>
                  <span>•</span>
                  <span className="font-bold text-foreground">
                    ₹{(student.monthlyFee / 100).toFixed(0)}/mo
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-emerald-500 font-bold">Active</span>
                  {student.fatherMobile && (
                    <span className="text-slate-400 font-mono ml-auto">
                      📞 {student.fatherMobile}
                    </span>
                  )}
                </div>
              </Card>
            ))
          ) : (
            <div className="text-center py-8 text-muted-foreground bg-card border rounded-xl">
              <Users className="h-10 w-10 stroke-1 mx-auto mb-2" />
              No students matching filters found.
            </div>
          )}
        </div>

        {/* DESKTOP TABLE VIEW */}
        <div className="hidden md:block rounded-xl border border-slate-200 dark:border-slate-800 bg-card overflow-x-auto scrollbar-thin shadow-md">
          <table className="w-full border-collapse text-left min-w-[700px]">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Student Details</th>
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase">School & Class</th>
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Parent No 1</th>
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Parent No 2</th>
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Monthly Fee</th>
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase">Status</th>
                <th className="p-4 text-xs font-bold text-muted-foreground uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {studentsLoading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={idx} className="border-b animate-pulse">
                    <td className="p-4"><div className="h-4 w-28 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-28 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-28 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-12 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded" /></td>
                    <td className="p-4 text-right"><div className="h-6 w-6 bg-slate-200 dark:bg-slate-800 rounded-full inline-block" /></td>
                  </tr>
                ))
              ) : studentsData?.students && studentsData.students.length > 0 ? (
                studentsData.students.map((student) => (
                  <tr key={student.id} className="border-b hover:bg-muted/10 transition-colors">
                    <td className="p-4 font-semibold text-foreground">
                      <div>{student.name}</div>
                      <div className="text-xs text-muted-foreground font-normal">Parent: {student.parentName}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5 text-sm">
                        <School className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{student.school}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{student.class}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        <Phone className="h-3.5 w-3.5 text-emerald-500" />
                        <span>{student.fatherMobile}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      {student.motherMobile ? (
                        <div className="flex items-center gap-1.5 text-sm text-foreground">
                          <Phone className="h-3.5 w-3.5 text-slate-400" />
                          <span>{student.motherMobile}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/45">N/A</span>
                      )}
                    </td>
                    <td className="p-4 font-bold text-foreground">
                      ₹{(student.monthlyFee / 100).toFixed(0)}
                    </td>
                    <td className="p-4">
                      <Badge variant="success">Active</Badge>
                    </td>
                    <td className="p-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem asChild className="gap-2">
                            <Link href={`/students/${student.id}`}>
                              <ExternalLink className="h-3.5 w-3.5" /> View Details
                            </Link>
                          </DropdownMenuItem>
                          {canMutate && (
                            <DropdownMenuItem onClick={() => handleEditClick(student)} className="gap-2">
                              <Edit2 className="h-3.5 w-3.5" /> Edit Profile
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleMatrixClick(student)} className="gap-2">
                            <Grid className="h-3.5 w-3.5" /> Fee Ledger Matrix
                          </DropdownMenuItem>
                          {canMutate && (
                            <DropdownMenuItem onClick={() => broadcastMutation.mutate(student.id)} className="gap-2">
                              <Send className="h-3.5 w-3.5 text-primary" /> Send Fee Reminder
                            </DropdownMenuItem>
                          )}
                          {canMutate && <DropdownMenuSeparator />}
                          {canMutate && (
                            <DropdownMenuItem onClick={() => handleDeleteClick(student)} className="gap-2 text-destructive">
                              <Trash2 className="h-3.5 w-3.5" /> Delete Student
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    <Users className="h-10 w-10 stroke-1 mx-auto mb-2" />
                    No students matching filters found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {studentsData && studentsData.totalPages > 1 && (
          <div className="flex items-center justify-between border-t p-4 bg-muted/10">
            <span className="text-xs text-muted-foreground">
              Page {studentsData.page} of {studentsData.totalPages}
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
                disabled={page === studentsData.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* CREATE DIALOG */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Register Student</DialogTitle>
            <DialogDescription>Create a new student transport profile</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Student Name</label>
                <Input placeholder="E.g. Kiran Kumar" {...createForm.register('name')} />
                {createForm.formState.errors.name && (
                  <p className="text-[10px] text-red-500">{createForm.formState.errors.name.message}</p>
                )}
              </div>



              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">School</label>
                <Input placeholder="E.g. Delhi Public School" {...createForm.register('school')} />
                {createForm.formState.errors.school && (
                  <p className="text-[10px] text-red-500">{createForm.formState.errors.school.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Class / Grade</label>
                <Input placeholder="E.g. Grade 5-A" {...createForm.register('class')} />
                {createForm.formState.errors.class && (
                  <p className="text-[10px] text-red-500">{createForm.formState.errors.class.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Parent / Guardian Name</label>
                <Input placeholder="E.g. Ramesh Kumar" {...createForm.register('parentName')} />
                {createForm.formState.errors.parentName && (
                  <p className="text-[10px] text-red-500">{createForm.formState.errors.parentName.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">WhatsApp Number</label>
                <Input placeholder="E.g. 9848022338" {...createForm.register('whatsappNumber')} />
                {createForm.formState.errors.whatsappNumber && (
                  <p className="text-[10px] text-red-500">{createForm.formState.errors.whatsappNumber.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Father Mobile</label>
                <Input placeholder="E.g. 9848022338" {...createForm.register('fatherMobile')} />
                {createForm.formState.errors.fatherMobile && (
                  <p className="text-[10px] text-red-500">{createForm.formState.errors.fatherMobile.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Mother Mobile (Optional)</label>
                <Input placeholder="E.g. 9848011223" {...createForm.register('motherMobile')} />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Monthly Fee (INR)</label>
                <Input
                  type="number"
                  placeholder="E.g. 2500"
                  {...createForm.register('monthlyFee', { valueAsNumber: true })}
                />
                {createForm.formState.errors.monthlyFee && (
                  <p className="text-[10px] text-red-500">{createForm.formState.errors.monthlyFee.message}</p>
                )}
              </div>

              <div className="col-span-2 space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Pickup Address</label>
                <Input placeholder="Flat 402, Sai Residency, Madhapur" {...createForm.register('pickupAddress')} />
                {createForm.formState.errors.pickupAddress && (
                  <p className="text-[10px] text-red-500">{createForm.formState.errors.pickupAddress.message}</p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Registering...' : 'Add Student'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT DIALOG */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>Update info for {selectedStudent?.name}</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={editForm.handleSubmit((values) =>
              editMutation.mutate({ id: selectedStudent.id, values }),
            )}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Student Name</label>
                <Input {...editForm.register('name')} />
                {editForm.formState.errors.name && (
                  <p className="text-[10px] text-red-500">{editForm.formState.errors.name.message}</p>
                )}
              </div>



              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">School</label>
                <Input {...editForm.register('school')} />
                {editForm.formState.errors.school && (
                  <p className="text-[10px] text-red-500">{editForm.formState.errors.school.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Class / Grade</label>
                <Input {...editForm.register('class')} />
                {editForm.formState.errors.class && (
                  <p className="text-[10px] text-red-500">{editForm.formState.errors.class.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Parent / Guardian Name</label>
                <Input {...editForm.register('parentName')} />
                {editForm.formState.errors.parentName && (
                  <p className="text-[10px] text-red-500">{editForm.formState.errors.parentName.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">WhatsApp Number</label>
                <Input {...editForm.register('whatsappNumber')} />
                {editForm.formState.errors.whatsappNumber && (
                  <p className="text-[10px] text-red-500">{editForm.formState.errors.whatsappNumber.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Father Mobile</label>
                <Input {...editForm.register('fatherMobile')} />
                {editForm.formState.errors.fatherMobile && (
                  <p className="text-[10px] text-red-500">{editForm.formState.errors.fatherMobile.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Mother Mobile (Optional)</label>
                <Input {...editForm.register('motherMobile')} />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Monthly Fee (INR)</label>
                <Input type="number" {...editForm.register('monthlyFee', { valueAsNumber: true })} />
                {editForm.formState.errors.monthlyFee && (
                  <p className="text-[10px] text-red-500">{editForm.formState.errors.monthlyFee.message}</p>
                )}
              </div>

              <div className="col-span-2 space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Pickup Address</label>
                <Input {...editForm.register('pickupAddress')} />
                {editForm.formState.errors.pickupAddress && (
                  <p className="text-[10px] text-red-500">{editForm.formState.errors.pickupAddress.message}</p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editMutation.isPending}>
                {editMutation.isPending ? 'Saving...' : 'Update Profile'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION DIALOG */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deactivation</DialogTitle>
            <DialogDescription>
              Are you sure you want to deactivate {selectedStudent?.name}? This student will be marked as INACTIVE and route references will be archived.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate(selectedStudent.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deactivating...' : 'Deactivate Student'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FEE LEDGER MATRIX DIALOG */}
      <Dialog open={matrixOpen} onOpenChange={setMatrixOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Fee Ledger Matrix</DialogTitle>
            <DialogDescription>Monthly collections ledger for {selectedStudent?.name}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-3 my-4">
            {feeMatrix.length > 0 ? (
              feeMatrix.map((item) => (
                <div
                  key={`${item.month}-${item.year}`}
                  className={cn(
                    'flex flex-col items-center justify-center p-3 border rounded-xl shadow-sm text-center',
                    item.isPaid
                      ? 'bg-success/5 border-success/20 text-success'
                      : 'bg-destructive/5 border-destructive/20 text-destructive',
                  )}
                >
                  <span className="text-xs font-bold uppercase">
                    {[
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
                    ][item.month - 1]}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{item.year}</span>
                  <div className="mt-2 flex items-center justify-center gap-1">
                    {item.isPaid ? (
                      <>
                        <CheckCircle className="h-4 w-4" />
                        <span className="text-[10px] font-bold">PAID</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4" />
                        <span className="text-[10px] font-bold">UNPAID</span>
                      </>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-3 flex items-center justify-center py-8 text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading ledger records...
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" className="w-full" onClick={() => setMatrixOpen(false)}>
              Close Matrix
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
