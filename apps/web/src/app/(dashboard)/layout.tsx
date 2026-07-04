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
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Bus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth';
import { useRoleAccess, canAccess, type AppRole } from '@/lib/role-access';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';

import { RoleContext } from './RoleContext';

// ─── Navigation config ─────────────────────────────────────────────────────────
interface SidebarItem {
  name: string;
  path: string; // matches ROLE_NAV_ACCESS keys
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ALL_NAV_ITEMS: SidebarItem[] = [
  { name: 'Dashboard', path: 'dashboard',  href: '/dashboard',  icon: LayoutDashboard },
  { name: 'Students',  path: 'students',   href: '/students',   icon: Users },
  { name: 'Routes',    path: 'routes',     href: '/routes',     icon: RouteIcon },
  { name: 'Payments',  path: 'payments',   href: '/payments',   icon: CreditCard },
  { name: 'WhatsApp',  path: 'whatsapp',   href: '/whatsapp',   icon: MessageSquare },
  { name: 'Reports',   path: 'reports',    href: '/reports',    icon: BarChart },
  { name: 'Settings',  path: 'settings',   href: '/settings',   icon: SettingsIcon },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout, accessToken } = useAuthStore();
  const { theme, setTheme } = useTheme();
  const { canMutate, isAdmin, isManager, allowedPaths, role } = useRoleAccess();

  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Touch swipe to close mobile menu
  const touchStartX = React.useRef<number>(0);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    if (dx > 60) setMobileMenuOpen(false); // swipe left to close
  };

  // Redirect if not logged in
  React.useEffect(() => {
    if (!mounted) return;

    if (!accessToken) {
      router.push('/login');
      return;
    }
    // Redirect drivers to their own portal
    if (role === 'DRIVER') {
      router.replace('/driver');
    }
  }, [mounted, accessToken, role, router]);

  // Redirect if current page is forbidden for this role
  React.useEffect(() => {
    if (!mounted || !role || role === 'DRIVER') return;
    const currentPath = ALL_NAV_ITEMS.find(
      (item) => pathname === item.href || pathname?.startsWith(item.href + '/')
    );
    if (currentPath && !canAccess(role as AppRole, currentPath.path)) {
      router.replace('/dashboard');
    }
  }, [mounted, pathname, role, router]);

  // WhatsApp status poll
  const { data: waStatus } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: async () => {
      const res = await api.get<{ data: { connected: boolean; phone: string | null } }>(
        '/whatsapp/status',
      );
      return res.data.data;
    },
    enabled: !!accessToken && role === 'ADMIN',
    refetchInterval: 15000,
  });

  const handleLogout = async () => {
    await logout();
  };

  const getPageTitle = () => {
    const activeItem = ALL_NAV_ITEMS.find(
      (item) => pathname === item.href || pathname?.startsWith(item.href + '/'),
    );
    return activeItem ? activeItem.name : "Hemanth's Transport";
  };

  // Filter nav items based on role
  const navItems = role
    ? ALL_NAV_ITEMS.filter((item) => canAccess(role as AppRole, item.path))
    : ALL_NAV_ITEMS;

  if (!mounted || !accessToken || !user || role === 'DRIVER') {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground">Authenticating session...</p>
        </div>
      </div>
    );
  }

  // ─── Shared nav link renderer ────────────────────────────────────────────────
  const NavLink = ({ item, onClick }: { item: SidebarItem; onClick?: () => void }) => {
    const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={onClick}
        title={collapsed ? item.name : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
          collapsed ? 'justify-center px-2' : '',
          isActive
            ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span>{item.name}</span>}
      </Link>
    );
  };

  // ─── User profile card ────────────────────────────────────────────────────────
  const UserCard = ({ compact = false }: { compact?: boolean }) => (
    <div className={cn('flex items-center gap-3 rounded-lg bg-accent/40 p-3', compact && 'justify-center p-2')}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary text-sm">
        {user.name.charAt(0).toUpperCase()}
      </div>
      {!compact && (
        <div className="flex-1 overflow-hidden">
          <div className="truncate text-sm font-bold text-foreground">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.role}</div>
        </div>
      )}
      {!compact && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLogout}
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          title="Sign Out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      )}
    </div>
  );

  return (
    <RoleContext.Provider value={{ canMutate, isAdmin, isManager }}>
      <div className="flex h-screen overflow-hidden bg-background">

        {/* ═══════════════════════════════════════════════════════════════
            DESKTOP SIDEBAR (hidden on mobile)
        ═══════════════════════════════════════════════════════════════ */}
        <aside
          className={cn(
            'hidden border-r bg-card md:flex md:flex-col transition-all duration-300 ease-in-out',
            collapsed ? 'md:w-[68px]' : 'md:w-64',
          )}
        >
          {/* Sidebar Header */}
          <div className={cn('flex h-16 items-center border-b px-4', collapsed ? 'justify-center' : 'gap-3 px-5')}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-inner">
              <Bus className="h-5 w-5" />
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-black tracking-tight text-foreground leading-none">
                  TransitOS
                </span>
                <span className="text-[9px] font-medium text-muted-foreground mt-1 truncate">
                  Hemanth's Transport
                </span>
              </div>
            )}
          </div>

          {/* Manager badge */}
          {isManager && !collapsed && (
            <div className="mx-4 mt-3 flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">View Only</span>
            </div>
          )}

          {/* Sidebar Nav */}
          <nav className="flex-1 space-y-1 px-3 py-5 overflow-y-auto">
            {navItems.map((item) => (
              <NavLink key={item.path} item={item} />
            ))}
          </nav>

          {/* Bottom: collapse toggle + user card */}
          <div className="border-t p-3 space-y-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(!collapsed)}
              className={cn('w-full text-muted-foreground hover:text-foreground', collapsed ? 'justify-center px-0' : 'justify-end gap-2')}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : (
                <>
                  <ChevronLeft className="h-4 w-4" />
                  <span className="text-xs">Collapse</span>
                </>
              )}
            </Button>
            {collapsed ? (
              <div className="flex flex-col items-center gap-1">
                <UserCard compact />
                <Button variant="ghost" size="icon" onClick={handleLogout} className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Sign Out">
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <UserCard />
            )}
          </div>
        </aside>

        {/* ═══════════════════════════════════════════════════════════════
            MOBILE SIDEBAR DRAWER (visible on mobile only)
        ═══════════════════════════════════════════════════════════════ */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50"
              style={{ WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)' }}
              onClick={() => setMobileMenuOpen(false)}
            />

            <aside
              className="relative flex w-72 max-w-[85vw] flex-col bg-card shadow-2xl"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {/* Mobile header */}
              <div className="flex h-14 items-center justify-between border-b px-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-inner">
                    <Bus className="h-4.5 w-4.5" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-black tracking-tight text-foreground leading-none">
                      TransitOS
                    </span>
                    <span className="text-[9px] font-medium text-muted-foreground mt-0.5">
                      Hemanth's Transport
                    </span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Manager badge */}
              {isManager && (
                <div className="mx-4 mt-3 flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">View Only Mode</span>
                </div>
              )}

              {/* Nav */}
              <nav className="mt-3 flex-1 space-y-1 px-3 overflow-y-auto">
                {navItems.map((item) => (
                  <NavLink key={item.path} item={item} onClick={() => setMobileMenuOpen(false)} />
                ))}
              </nav>

              {/* Bottom */}
              <div className="border-t p-4">
                <UserCard />
              </div>
            </aside>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            MAIN CONTENT WORKSPACE
        ═══════════════════════════════════════════════════════════════ */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* Header toolbar */}
          <header className="flex h-14 md:h-16 shrink-0 items-center justify-between border-b bg-card px-4 md:px-6 gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {/* Hamburger — mobile only */}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden text-foreground shrink-0"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <h1 className="text-lg md:text-xl font-extrabold text-foreground tracking-tight truncate">
                {getPageTitle()}
              </h1>
              {isManager && (
                <span className="hidden sm:flex items-center gap-1 text-[10px] font-bold text-amber-500 border border-amber-500/30 bg-amber-500/10 rounded-full px-2 py-0.5">
                  <ShieldAlert className="h-3 w-3" />
                  View Only
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 md:gap-3 shrink-0">
              {/* WhatsApp status — admin only, hidden on small screens */}
              {isAdmin && (
                <div className="hidden sm:flex items-center gap-2 rounded-full border bg-accent/20 px-3 py-1 text-xs font-semibold">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full animate-pulse',
                      waStatus?.connected ? 'bg-emerald-500 shadow-sm shadow-emerald-500/40' : 'bg-gray-400',
                    )}
                  />
                  <span className="text-muted-foreground">
                    {waStatus?.connected ? 'WhatsApp Linked' : 'WhatsApp Offline'}
                  </span>
                </div>
              )}

              {/* Dark/Light mode toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="h-9 w-9 text-muted-foreground hover:text-foreground relative"
                title="Toggle Theme"
              >
                <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </Button>
            </div>
          </header>

          {/* Dynamic page content */}
          <main className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-8">
            <div className="mx-auto max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
    </RoleContext.Provider>
  );
}
