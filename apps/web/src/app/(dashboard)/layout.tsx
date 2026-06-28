'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Users,
  Route as RouteIcon,
  CreditCard,
  MessageSquare,
  BarChart,
  Settings as SettingsIcon,
  LogOut,
  Sun,
  Moon,
  Menu,
  X,
  Bus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';

interface SidebarItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navigationItems: SidebarItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Students', href: '/students', icon: Users },
  { name: 'Routes', href: '/routes', icon: RouteIcon },
  { name: 'Payments', href: '/payments', icon: CreditCard },
  { name: 'WhatsApp', href: '/whatsapp', icon: MessageSquare },
  { name: 'Reports', href: '/reports', icon: BarChart },
  { name: 'Settings', href: '/settings', icon: SettingsIcon },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout, accessToken } = useAuthStore();
  const { theme, setTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  // Redirect if not logged in
  React.useEffect(() => {
    if (!accessToken) {
      router.push('/login');
    }
  }, [accessToken, router]);

  // Query WhatsApp connection status periodically
  const { data: waStatus } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: async () => {
      const res = await api.get<{ data: { connected: boolean; phone: string | null } }>(
        '/whatsapp/status',
      );
      return res.data.data;
    },
    enabled: !!accessToken,
    refetchInterval: 15000, // Sync status every 15s
  });

  const handleLogout = async () => {
    await logout();
  };

  const getPageTitle = () => {
    const activeItem = navigationItems.find((item) => pathname?.startsWith(item.href));
    return activeItem ? activeItem.name : 'School Transport';
  };

  if (!accessToken || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground">Authenticating session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ─────────────────────────────────────────────────────────────────────────────
          DESKTOP SIDEBAR
          ───────────────────────────────────────────────────────────────────────────── */}
      <aside className="hidden border-r bg-card md:flex md:w-64 md:flex-col">
        {/* Sidebar Header */}
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <img src="/logo.png" alt="TransitOS Logo" className="h-8 w-8 object-contain" />
          <span className="text-lg font-black tracking-tight bg-gradient-to-r from-primary to-indigo-600 bg-clip-text text-transparent">
            TransitOS
          </span>
        </div>

        {/* Sidebar Links */}
        <nav className="flex-1 space-y-1 px-4 py-6">
          {navigationItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-250',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* User profile segment */}
        <div className="border-t p-4">
          <div className="flex items-center gap-3 rounded-lg bg-accent/40 p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="truncate text-sm font-bold text-foreground">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{user.role}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* ─────────────────────────────────────────────────────────────────────────────
          MOBILE SIDEBAR OVERLAY
          ───────────────────────────────────────────────────────────────────────────── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop overlay */}
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />

          <aside className="relative flex w-full max-w-xs flex-col bg-card py-6 shadow-xl">
            <div className="flex h-10 items-center justify-between px-6 border-b pb-4">
              <div className="flex items-center gap-2">
                <img src="/logo.png" alt="TransitOS Logo" className="h-8 w-8 object-contain" />
                <span className="text-lg font-black tracking-tight bg-gradient-to-r from-primary to-indigo-600 bg-clip-text text-transparent">
                  TransitOS
                </span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <nav className="mt-6 flex-1 space-y-1 px-4">
              {navigationItems.map((item) => {
                const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t px-4 pt-4">
              <div className="flex items-center gap-3 rounded-lg bg-accent/40 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className="truncate text-sm font-bold text-foreground">{user.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{user.role}</div>
                </div>
                <Button variant="ghost" size="icon" onClick={handleLogout} className="h-8 w-8 text-destructive">
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          MAIN CONTENT WORKSPACE
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header toolbar */}
        <header className="flex h-16 items-center justify-between border-b bg-card px-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-foreground"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-extrabold text-foreground tracking-tight">{getPageTitle()}</h1>
          </div>

          <div className="flex items-center gap-4">
            {/* WhatsApp Integration connection status badge */}
            <div className="flex items-center gap-2 rounded-full border bg-accent/20 px-3 py-1 text-xs font-semibold">
              <span
                className={cn(
                  'h-2 w-2 rounded-full animate-pulse',
                  waStatus?.connected ? 'bg-success shadow-sm shadow-success/40' : 'bg-gray-400',
                )}
              />
              <span className="text-muted-foreground hidden sm:inline">
                {waStatus?.connected ? 'WhatsApp Linked' : 'WhatsApp Offline'}
              </span>
            </div>

            {/* Dark/Light mode toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              title="Toggle Theme"
            >
              <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>
          </div>
        </header>

        {/* Dynamic page content container */}
        <main className="flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
