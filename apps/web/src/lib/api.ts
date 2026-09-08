import axios, { type AxiosError, type InternalAxiosRequestConfig, type AxiosResponse } from 'axios';
import { useAuthStore } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://transitos-api-new.onrender.com/api/v1';

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // send httpOnly cookies for refresh token
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST INTERCEPTOR — attach access token from store
// ─────────────────────────────────────────────────────────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE INTERCEPTOR — auto-refresh on 401, redirect on failure
// ─────────────────────────────────────────────────────────────────────────────
let isRefreshing = false;
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

// Auth endpoints that must NEVER trigger a refresh retry (prevents infinite loop)
const AUTH_BYPASS_PATHS = ['/auth/refresh', '/auth/login', '/auth/logout'];

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Only intercept 401s on non-auth endpoints that haven't been retried yet
    const requestPath = originalRequest?.url ?? '';
    const isAuthEndpoint = AUTH_BYPASS_PATHS.some((p) => requestPath.includes(p));

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      const refreshToken = useAuthStore.getState().refreshToken;

      // No refresh token at all — redirect to login immediately
      if (!refreshToken) {
        useAuthStore.getState().logout();
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // Queue this request to retry once the refresh completes
        return new Promise((resolve, reject) => {
          refreshQueue.push({
            resolve: (token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(api(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Send refresh token via body AND custom header — cross-origin cookies
        // (Vercel → Render) are unreliable, so this ensures the server always gets it
        const res = await axios.post<{ success: boolean; data: { accessToken: string; refreshToken: string } }>(
          `${API_URL}/auth/refresh`,
          { refreshToken },
          {
            withCredentials: true,
            headers: {
              'Content-Type': 'application/json',
              'x-refresh-token': refreshToken,
            },
            timeout: 15_000,
          }
        );

        const newAccessToken = res.data.data.accessToken;
        const newRefreshToken = res.data.data.refreshToken;

        // Store the rotated tokens
        useAuthStore.getState().setTokens(newAccessToken, newRefreshToken);

        // Flush all queued requests with new token
        refreshQueue.forEach((cb) => cb.resolve(newAccessToken));
        refreshQueue = [];

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh definitively failed — clear session and redirect to login
        refreshQueue.forEach((cb) => cb.reject(refreshError));
        refreshQueue = [];

        // Clear auth state without calling logout() API (server session already invalid)
        useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, error: null });

        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// TYPED HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/** Extract error message from API response or Axios error */
export function getApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    return data?.error ?? error.message ?? 'An unexpected error occurred';
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
}
