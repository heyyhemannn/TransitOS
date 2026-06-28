'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Bus, 
  Phone, 
  MessageSquare, 
  LogOut, 
  Calendar, 
  Users, 
  MapPin, 
  Clock, 
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface Student {
  id: string;
  name: string;
  school: string;
  class: string;
  parentName: string;
  fatherMobile: string;
  whatsappNumber: string;
  pickupAddress: string;
  dropAddress: string;
  pickupTime: string;
  dropTime: string;
}

interface Route {
  id: string;
  name: string;
  vehicleNumber: string | null;
  driverName: string | null;
}

interface DriverMeResponse {
  route: Route | null;
  students: Student[];
}

interface Settings {
  businessName: string;
  upiId: string;
  adminWhatsapp: string;
  adminPhone: string;
}

export default function DriverDashboard() {
  const router = useRouter();
  const { user, logout, accessToken } = useAuthStore();
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<DriverMeResponse | null>(null);
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [currentTime, setCurrentTime] = React.useState('');

  React.useEffect(() => {
    if (!accessToken || user?.role !== 'DRIVER') {
      router.replace('/login');
    }
  }, [accessToken, user, router]);

  const fetchData = async () => {
    try {
      const [driverRes, settingsRes] = await Promise.all([
        api.get<{ data: DriverMeResponse }>('/driver/me'),
        api.get<{ data: Settings }>('/settings'),
      ]);
      setData(driverRes.data.data);
      setSettings(settingsRes.data.data);
    } catch (err: any) {
      toast({
        title: 'Error loading dashboard',
        description: err.response?.data?.error || 'Failed to fetch details.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (accessToken && user?.role === 'DRIVER') {
      fetchData();
    }
  }, [accessToken, user]);

  React.useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await logout();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 p-4">
        <Loader2 className="h-10 w-10 text-blue-500 animate-spin mb-4" />
        <p className="text-sm font-medium text-slate-400">Loading route & student details...</p>
      </div>
    );
  }

  // Find next/current active student pickup
  const nextStudent = data?.students.find((s) => s.pickupTime >= currentTime);
  const nextStudentId = nextStudent?.id || (data?.students.length ? data.students[0].id : null);

  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const adminPhone = settings?.adminPhone || '9848022338';
  const adminWhatsapp = settings?.adminWhatsapp || '9848022338';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24 relative overflow-x-hidden">
      {/* Background decoration */}
      <div className="absolute top-[-10%] left-[-10%] h-[30%] w-[50%] rounded-full bg-blue-600/10 blur-[120px]" />
      <div className="absolute bottom-[10%] right-[-10%] h-[40%] w-[50%] rounded-full bg-indigo-600/10 blur-[120px]" />

      {/* HEADER */}
      <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img
            src="/transitOS_compact_hero.svg"
            alt="Hemanth's Transport Services"
            className="h-8 w-auto max-w-[130px] object-contain"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-300 bg-slate-800/80 px-2.5 py-1 rounded-full border border-slate-700">
            {user?.name}
          </span>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleLogout} 
            className="h-8 w-8 text-slate-400 hover:text-red-400"
            title="Sign Out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* BODY */}
      <main className="max-w-md mx-auto p-4 space-y-4">
        {!data?.route ? (
          /* NO ROUTE ASSIGNED */
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-xl text-center py-10 px-6 mt-10">
            <CardHeader>
              <div className="mx-auto h-16 w-16 bg-amber-500/10 text-amber-500 rounded-full flex items-center justify-center mb-2">
                <AlertTriangle className="h-8 w-8" />
              </div>
              <CardTitle className="text-xl font-bold text-slate-100">No Route Assigned</CardTitle>
              <CardDescription className="text-slate-400 mt-2">
                You are currently not assigned to any transport route. Please contact the administrator.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <Button 
                asChild
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-2"
              >
                <a 
                  href={`https://wa.me/91${adminWhatsapp}?text=Hi Admin, I have logged into the Driver App but no route is assigned to my profile.`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageSquare className="h-4 w-4" />
                  Contact Admin on WhatsApp
                </a>
              </Button>
            </CardContent>
          </Card>
        ) : (
          /* ASSIGNED ROUTE PRESENT */
          <>
            {/* HERO CARD */}
            <Card className="border-slate-800 bg-gradient-to-br from-slate-900/80 to-slate-900/40 backdrop-blur-xl shadow-xl overflow-hidden relative">
              <div className="absolute right-[-20px] top-[-20px] h-32 w-32 bg-blue-500/10 rounded-full blur-2xl" />
              <CardContent className="p-5 flex items-start gap-4">
                <div className="p-3 bg-blue-500/15 text-blue-400 rounded-2xl border border-blue-500/20 shrink-0">
                  <Bus className="h-6 w-6" />
                </div>
                <div className="space-y-1 min-w-0 flex-1">
                  <span className="text-[10px] font-black text-blue-400 tracking-widest uppercase">
                    ACTIVE ROUTE
                  </span>
                  <h2 className="text-lg font-extrabold text-slate-100 truncate">
                    {data.route.name}
                  </h2>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400 pt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {todayStr}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {data.students.length} Students
                    </span>
                    {data.route.vehicleNumber && (
                      <span className="font-bold text-slate-300">
                        🚍 {data.route.vehicleNumber}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* STUDENT LIST HEADER */}
            <div className="flex items-center justify-between px-1 pt-2">
              <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase">
                Student Pickup Timeline
              </h3>
              <span className="text-xs text-slate-500 font-medium">
                Current Time: {currentTime}
              </span>
            </div>

            {/* STUDENT TIMELINE */}
            <div className="space-y-3">
              {data.students.length === 0 ? (
                <div className="text-center py-10 text-slate-500 text-sm">
                  No active students assigned to this route.
                </div>
              ) : (
                data.students.map((student) => {
                  const isCurrent = student.id === nextStudentId;
                  const isUpcoming = student.pickupTime >= currentTime;

                  return (
                    <div 
                      key={student.id}
                      className={`relative rounded-xl border transition-all duration-300 ${
                        isCurrent 
                          ? 'border-blue-500/60 bg-slate-900/90 shadow-lg shadow-blue-500/5 scale-[1.01] ring-2 ring-blue-500/20' 
                          : 'border-slate-800 bg-slate-900/40 hover:bg-slate-900/60'
                      }`}
                    >
                      {/* Current tag highlight */}
                      {isCurrent && (
                        <span className="absolute top-2.5 right-2.5 bg-blue-500/10 text-blue-400 text-[9px] font-bold px-2 py-0.5 rounded-full border border-blue-500/20 animate-pulse">
                          CURRENT / NEXT
                        </span>
                      )}

                      <div className="p-4 space-y-3">
                        {/* Student Name and Time */}
                        <div className="flex justify-between items-start gap-4">
                          <div>
                            <h4 className="font-bold text-slate-100 text-base">{student.name}</h4>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {student.school} • Class {student.class}
                            </p>
                          </div>
                          <span className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg shrink-0 border ${
                            isUpcoming
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          }`}>
                            <Clock className="h-3.5 w-3.5" />
                            {student.pickupTime}
                          </span>
                        </div>

                        {/* Addresses */}
                        <div className="space-y-1.5 pt-1 text-xs text-slate-300">
                          <div className="flex items-start gap-2">
                            <MapPin className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                            <span className="line-clamp-1">{student.pickupAddress}</span>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2 pt-1">
                          <Button
                            asChild
                            variant="secondary"
                            size="sm"
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 text-xs gap-1.5 h-9 font-bold"
                          >
                            <a href={`tel:${student.fatherMobile}`}>
                              <Phone className="h-3.5 w-3.5 text-slate-400" />
                              Call Parent
                            </a>
                          </Button>
                          <Button
                            asChild
                            variant="secondary"
                            size="sm"
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 text-xs gap-1.5 h-9 font-bold"
                          >
                            <a 
                              href={`https://wa.me/91${student.whatsappNumber}?text=Hi, this is the TransitOS Driver. I am on my route and approaching your child's pickup point shortly.`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <MessageSquare className="h-3.5 w-3.5 text-emerald-400" />
                              WhatsApp
                            </a>
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </main>

      {/* BOTTOM STICKY BAR */}
      <footer className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-900/90 backdrop-blur-lg px-4 py-3 flex gap-3 max-w-md mx-auto z-40">
        <Button
          asChild
          variant="destructive"
          className="flex-1 font-bold gap-2 text-xs h-11"
        >
          <a href={`tel:${adminPhone}`}>
            <Phone className="h-4 w-4" />
            Call Admin
          </a>
        </Button>
        <Button
          asChild
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-2 text-xs h-11"
        >
          <a 
            href={`https://wa.me/91${adminWhatsapp}?text=Hi Admin, reporting an issue on my route.`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageSquare className="h-4 w-4" />
            WhatsApp Admin
          </a>
        </Button>
      </footer>
    </div>
  );
}
