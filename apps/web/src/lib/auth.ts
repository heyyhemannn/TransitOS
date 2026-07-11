import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User, LoginRequest, LoginResponse, ApiResponse } from '@stms/types';
import { api, getApiError } from './api';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setAccessToken: (token: string) => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: false,
      error: null,

      login: async (credentials) => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.post<ApiResponse<LoginResponse>>('/auth/login', credentials);
          const { user, accessToken, refreshToken } = res.data.data!;
          set({ user, accessToken, refreshToken: refreshToken ?? null, isLoading: false, error: null });
        } catch (err) {
          set({ isLoading: false, error: getApiError(err) });
          throw err;
        }
      },

      logout: async () => {
        try {
          const { refreshToken } = get();
          await api.post('/auth/logout', { refreshToken });
        } catch {
          // swallow error — clear local state regardless
        } finally {
          set({ user: null, accessToken: null, refreshToken: null, error: null });
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
        }
      },

      fetchMe: async () => {
        const { accessToken } = get();
        if (!accessToken) return;

        set({ isLoading: true });
        try {
          const res = await api.get<ApiResponse<User>>('/auth/me');
          set({ user: res.data.data!, isLoading: false });
        } catch {
          // Token invalid — clear
          set({ user: null, accessToken: null, refreshToken: null, isLoading: false });
        }
      },

      setTokens: (accessToken: string, refreshToken: string) => set({ accessToken, refreshToken }),
      setAccessToken: (token: string) => set({ accessToken: token }),
      clearError: () => set({ error: null }),
    }),
    {
      name: 'stms-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);

/** Selector: is user authenticated */
export const useIsAuthenticated = () => useAuthStore((s) => s.accessToken !== null && s.user !== null);

/** Selector: current user */
export const useCurrentUser = () => useAuthStore((s) => s.user);

/** Selector: user role */
export const useUserRole = () => useAuthStore((s) => s.user?.role ?? null);
