'use client';

import { useAuthStore } from './auth';

export type AppRole = 'ADMIN' | 'MANAGER' | 'DRIVER';

export const ROLE_NAV_ACCESS: Record<AppRole, string[]> = {
  ADMIN:   ['dashboard', 'students', 'routes', 'payments', 'whatsapp', 'reports', 'settings'],
  MANAGER: ['dashboard', 'students', 'routes', 'payments', 'reports'],
  DRIVER:  [],
};

export const ROLE_CAN_MUTATE: Record<AppRole, boolean> = {
  ADMIN:   true,
  MANAGER: false,
  DRIVER:  false,
};

export function canAccess(role: AppRole, path: string): boolean {
  return ROLE_NAV_ACCESS[role]?.includes(path) ?? false;
}

export function useRoleAccess() {
  const role = useAuthStore((s) => s.user?.role) as AppRole | undefined;
  return {
    canMutate: role ? ROLE_CAN_MUTATE[role] : false,
    allowedPaths: role ? ROLE_NAV_ACCESS[role] : [],
    isAdmin: role === 'ADMIN',
    isManager: role === 'MANAGER',
    isDriver: role === 'DRIVER',
    role: role ?? null,
  };
}
