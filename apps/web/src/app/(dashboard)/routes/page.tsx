'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Plus, 
  Search, 
  Bus, 
  Users, 
  Phone, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  Loader2, 
  Compass,
  CheckCircle,
  AlertTriangle
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
import { useToast } from '@/hooks/use-toast';
import { usePageRole } from '../layout';

// Validation schema
const routeSchema = z.object({
  name: z.string().min(2, 'Route name must be at least 2 characters'),
  vehicleNumber: z.string().min(2, 'Vehicle number is required'),
  driverId: z.string().nullable().optional().or(z.literal('')),
  driverName: z.string().optional().nullable(),
});

type RouteFormValues = z.infer<typeof routeSchema>;

interface DriverUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function RoutesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canMutate, isManager } = usePageRole();

  // Dialog visibilities
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  // Selection
  const [selectedRoute, setSelectedRoute] = React.useState<any>(null);

  // Form Setup
  const createForm = useForm<RouteFormValues>({
    resolver: zodResolver(routeSchema),
    defaultValues: {
      name: '',
      vehicleNumber: '',
      driverId: '',
      driverName: '',
    },
  });

  const editForm = useForm<RouteFormValues>({
    resolver: zodResolver(routeSchema),
  });

  // 1. Fetch Routes list
  const { data: routes, isLoading: routesLoading } = useQuery({
    queryKey: ['routes-list'],
    queryFn: async () => {
      const res = await api.get<{ data: any[] }>('/routes?includeStudents=true');
      return res.data.data;
    },
    refetchInterval: 5000,
  });

  // 2. Fetch Driver Users
  const { data: drivers } = useQuery({
    queryKey: ['drivers-list'],
    queryFn: async () => {
      const res = await api.get<{ data: DriverUser[] }>('/auth/users?role=DRIVER');
      return res.data.data;
    },
  });

  // 3. Create Route Mutation
  const createMutation = useMutation({
    mutationFn: async (values: RouteFormValues) => {
      const selectedDriver = drivers?.find((d) => d.id === values.driverId);
      const payload = {
        ...values,
        driverId: values.driverId || null,
        driverName: selectedDriver ? selectedDriver.name : null,
      };
      await api.post('/routes', payload);
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Route created successfully', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['routes-list'] });
      setCreateOpen(false);
      createForm.reset();
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create route',
        description: err.response?.data?.error || 'Validation error',
        variant: 'destructive',
      });
    },
  });

  // 4. Edit Route Mutation
  const editMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: RouteFormValues }) => {
      const selectedDriver = drivers?.find((d) => d.id === values.driverId);
      const payload = {
        ...values,
        driverId: values.driverId || null,
        driverName: selectedDriver ? selectedDriver.name : null,
      };
      await api.put(`/routes/${id}`, payload);
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Route updated successfully', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['routes-list'] });
      setEditOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to update route',
        description: err.response?.data?.error || 'Validation error',
        variant: 'destructive',
      });
    },
  });

  // 5. Delete Route Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/routes/${id}`);
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Route deleted successfully', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['routes-list'] });
      setDeleteOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to delete route',
        description: err.response?.data?.error || 'Failed to delete route',
        variant: 'destructive',
      });
    },
  });

  const handleEditClick = (route: any) => {
    setSelectedRoute(route);
    editForm.reset({
      name: route.name,
      vehicleNumber: route.vehicleNumber || '',
      driverId: route.driverId || '',
    });
    setEditOpen(true);
  };

  const handleDeleteClick = (route: any) => {
    setSelectedRoute(route);
    setDeleteOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Route Directory</h2>
            <p className="text-sm text-muted-foreground">Manage transportation lines, bus numbers, and driver assignments</p>
          </div>
          {isManager && (
            <Badge variant="outline" className="text-amber-500 border-amber-500 bg-amber-500/10 font-bold">
              View Only
            </Badge>
          )}
        </div>
        {canMutate && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2 font-bold shadow-md shadow-primary/20">
            <Plus className="h-4 w-4" />
            Add Route
          </Button>
        )}
      </div>

      {/* Routes list layout: Responsive cards */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {routesLoading ? (
          Array.from({ length: 3 }).map((_, idx) => (
            <Card key={idx} className="animate-pulse border-slate-200 dark:border-slate-800 bg-card p-5 space-y-4">
              <div className="h-4 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-8 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
            </Card>
          ))
        ) : routes && routes.length > 0 ? (
          routes.map((route) => {
            const studentCount = route._count?.students ?? 0;
            const assignedDriver = drivers?.find((d) => d.id === route.driverId);

            return (
              <Card key={route.id} className="relative overflow-hidden border-slate-200 dark:border-slate-800 bg-card hover:shadow-xl transition-all duration-300 group">
                <div className="absolute right-0 top-0 h-24 w-24 translate-x-4 translate-y-[-10px] rounded-full bg-blue-500/5 group-hover:scale-125 transition-transform" />
                
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-blue-500 tracking-wider uppercase">
                      🚍 {route.vehicleNumber || 'No Vehicle'}
                    </span>
                    <CardTitle className="text-lg font-bold text-foreground">
                      {route.name}
                    </CardTitle>
                  </div>

                  {canMutate && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Route Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => handleEditClick(route)} className="gap-2">
                          <Edit2 className="h-3.5 w-3.5" /> Edit Details
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleDeleteClick(route)} className="gap-2 text-destructive">
                          <Trash2 className="h-3.5 w-3.5" /> Delete Route
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-slate-400" />
                      {studentCount} Enrolled Students
                    </span>
                  </div>

                  {/* Driver Assign Section */}
                  <div className="border-t pt-3 space-y-1">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">
                      ASSIGNED DRIVER
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold text-xs">
                        {assignedDriver ? assignedDriver.name.charAt(0).toUpperCase() : '?'}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-foreground">
                          {assignedDriver ? assignedDriver.name : 'Unassigned'}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {assignedDriver ? assignedDriver.email : 'Click edit to assign driver'}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <div className="col-span-full text-center py-12 text-muted-foreground bg-card border rounded-xl">
            <Compass className="h-10 w-10 stroke-1 mx-auto mb-2" />
            No active routes created yet.
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          CREATE ROUTE DIALOG
          ───────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Route</DialogTitle>
            <DialogDescription>Create a new school bus routing line</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
            className="space-y-4"
          >
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Route Name</label>
                <Input placeholder="E.g. Route 4 - Madhapur" {...createForm.register('name')} />
                {createForm.formState.errors.name && (
                  <p className="text-[10px] text-red-500">{createForm.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Vehicle Number</label>
                <Input placeholder="E.g. AP-09-TL-1234" {...createForm.register('vehicleNumber')} />
                {createForm.formState.errors.vehicleNumber && (
                  <p className="text-[10px] text-red-500">{createForm.formState.errors.vehicleNumber.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Assign Driver</label>
                <select
                  className="w-full p-2 border rounded-md bg-card text-foreground"
                  {...createForm.register('driverId')}
                >
                  <option value="">Choose Driver...</option>
                  {drivers?.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name} ({driver.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Route'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────────────────────
          EDIT ROUTE DIALOG
          ───────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Route Details</DialogTitle>
            <DialogDescription>Update metadata and driver assignments</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={editForm.handleSubmit((values) =>
              editMutation.mutate({ id: selectedRoute.id, values }),
            )}
            className="space-y-4"
          >
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Route Name</label>
                <Input {...editForm.register('name')} />
                {editForm.formState.errors.name && (
                  <p className="text-[10px] text-red-500">{editForm.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Vehicle Number</label>
                <Input {...editForm.register('vehicleNumber')} />
                {editForm.formState.errors.vehicleNumber && (
                  <p className="text-[10px] text-red-500">{editForm.formState.errors.vehicleNumber.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Assign Driver</label>
                <select
                  className="w-full p-2 border rounded-md bg-card text-foreground"
                  {...editForm.register('driverId')}
                >
                  <option value="">Choose Driver...</option>
                  {drivers?.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name} ({driver.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editMutation.isPending}>
                {editMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────────────────────
          DELETE CONFIRMATION DIALOG
          ───────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Route?
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to deactivate <strong>{selectedRoute?.name}</strong>? 
              This action cannot be undone. Active students must not be assigned to this route.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(selectedRoute.id)}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Confirm Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
