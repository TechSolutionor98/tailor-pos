import type {
  AppSettings,
  AuditEntry,
  AuthUser,
  BulkConvertResult,
  DashboardSummary,
  FlatPayment,
  JobCard,
  Ledger,
  LedgerDue,
  MeasurementProfile,
  Page,
  PermissionCatalog,
  Product,
  ProductUsagePicker,
  Role,
  Sale,
  SavedBank,
  SavedCard,
} from './types';

/**
 * Where the API lives. Deployed, the site and the API share a domain, so a
 * relative '/api' is right and avoids CORS. Locally the API is a separate
 * process on port 5000. NEXT_PUBLIC_API_URL overrides both.
 */
function apiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured;
  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? 'http://localhost:5000/api' : '/api';
  }
  return 'http://localhost:5000/api';
}

const API = apiBase();

const TOKEN_KEY = 'tailor-pos-token';

/* ------------------------------------------------------------------ token */

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private window) — session stays in memory only */
  }
}

/** Raised on 401 so the shell can bounce the user back to the login screen. */
export class UnauthorizedError extends Error {}

type Unauthorized = () => void;
let onUnauthorized: Unauthorized = () => {};
export function setUnauthorizedHandler(fn: Unauthorized): void {
  onUnauthorized = fn;
}

/* ------------------------------------------------------------------- http */

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    setToken(null);
    onUnauthorized();
    throw new UnauthorizedError(body?.error || 'Your session has expired — please sign in again');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => http<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  http<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const put = <T,>(path: string, body?: unknown) =>
  http<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
const patch = <T,>(path: string, body?: unknown) =>
  http<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
const del = <T,>(path: string) => http<T>(path, { method: 'DELETE' });

export interface UserPayload {
  username?: string;
  name?: string;
  password?: string;
  role?: Role;
  permissions?: string[];
  active?: boolean;
}

export const api = {
  health: () => get<{ ok: boolean }>('/health'),

  auth: {
    login: (username: string, password: string) =>
      post<{ token: string; user: AuthUser }>('/auth/login', { username, password }),
    me: () => get<{ user: AuthUser }>('/auth/me'),
    changePassword: (currentPassword: string, newPassword: string) =>
      post<{ ok: boolean }>('/auth/change-password', { currentPassword, newPassword }),
    permissions: () => get<PermissionCatalog>('/auth/permissions'),
  },

  users: {
    list: (q = '') => get<{ items: AuthUser[]; total: number }>(`/users?q=${encodeURIComponent(q)}`),
    create: (body: UserPayload) => post<AuthUser>('/users', body),
    update: (id: string, body: UserPayload) => put<AuthUser>(`/users/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/users/${id}`),
  },

  measurements: {
    list: (ledgerId: string) =>
      get<{ items: MeasurementProfile[]; total: number }>(
        `/measurements?ledgerId=${encodeURIComponent(ledgerId)}`,
      ),
    /** Everyone on file, across customers — the Measurements screen and name suggestions. */
    search: (q = '', page = 1, limit = 50) =>
      get<Page<MeasurementProfile>>(
        `/measurements?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`,
      ),
    save: (body: Partial<MeasurementProfile>) => post<MeasurementProfile>('/measurements', body),
    update: (id: string, body: Partial<MeasurementProfile>) =>
      put<MeasurementProfile>(`/measurements/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/measurements/${id}`),
  },

  ledgers: {
    list: (q = '', page = 1, limit = 50) =>
      get<Page<Ledger>>(`/ledgers?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`),
    listByType: (q = '', type = '', page = 1, limit = 50) =>
      get<Page<Ledger>>(
        `/ledgers?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&page=${page}&limit=${limit}`,
      ),
    get: (id: string) => get<Ledger>(`/ledgers/${id}`),
    due: (id: string) => get<LedgerDue>(`/ledgers/${id}/due`),
    create: (body: Partial<Ledger>) => post<Ledger>('/ledgers', body),
    update: (id: string, body: Partial<Ledger>) => put<Ledger>(`/ledgers/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/ledgers/${id}`),
    /**
     * Remember how this customer paid. Separate from `update` because taking a
     * payment is not the same permission as editing the customer record, and a
     * cashier must be able to do the first without the second.
     */
    savePaymentDetails: (id: string, body: { card?: SavedCard; bank?: SavedBank }) =>
      post<Ledger>(`/ledgers/${id}/payment-details`, body),
  },

  products: {
    list: (q = '', page = 1, limit = 50, usableAs?: ProductUsagePicker) =>
      get<Page<Product>>(
        `/products?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}` +
          (usableAs ? `&usableAs=${usableAs}` : ''),
      ),
    create: (body: Partial<Product>) => post<Product>('/products', body),
    /** Everything the category dropdown should offer, already de-duplicated. */
    categories: () => get<{ items: string[] }>('/products/categories'),
    addCategory: (name: string) =>
      post<{ name: string; existed: boolean }>('/products/categories', { name }),
    update: (id: string, body: Partial<Product>) => put<Product>(`/products/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/products/${id}`),
  },

  jobCards: {
    list: (q = '', status = '', page = 1, limit = 30, ledgerId = '') =>
      get<Page<JobCard>>(
        `/jobcards?q=${encodeURIComponent(q)}&status=${status}&page=${page}&limit=${limit}${
          ledgerId ? `&ledgerId=${encodeURIComponent(ledgerId)}` : ''
        }`,
      ),
    next: () => get<{ no: number; ref: string; bookNo?: number }>('/jobcards/next'),
    adjacent: (no: number, dir: 'prev' | 'next') =>
      get<JobCard>(`/jobcards/adjacent?no=${no}&dir=${dir}`),
    get: (id: string) => get<JobCard>(`/jobcards/${id}`),
    create: (body: unknown) => post<JobCard>('/jobcards', body),
    update: (id: string, body: unknown) => put<JobCard>(`/jobcards/${id}`, body),
    addPayment: (id: string, body: unknown) => post<JobCard>(`/jobcards/${id}/payments`, body),
    close: (id: string) => post<JobCard>(`/jobcards/${id}/close`),
    reopen: (id: string) => post<JobCard>(`/jobcards/${id}/reopen`),
    setPending: (id: string) => post<JobCard>(`/jobcards/${id}/pending`),
    markReady: (id: string) => post<JobCard>(`/jobcards/${id}/ready`),
    complete: (id: string) => post<JobCard>(`/jobcards/${id}/ready`),
    updateStatus: (id: string, status: string) =>
      patch<JobCard>(`/jobcards/${id}/status`, { status }),
    convert: (id: string, body: unknown) =>
      post<{ jobCard: JobCard; sale: Sale }>(`/jobcards/${id}/convert`, body),
    convertBulk: (ids: string[], body: { salesman?: string; taxRate?: number } = {}) =>
      post<BulkConvertResult>('/jobcards/convert-bulk', { ids, ...body }),
    payments: () => get<{ items: FlatPayment[] }>('/jobcards/payments/all'),
    delete: (id: string) => del<{ ok: boolean }>(`/jobcards/${id}`),
  },

  sales: {
    list: (q = '', page = 1, limit = 30, isReturn?: boolean, ledgerId = '') =>
      get<Page<Sale>>(
        `/sales?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}${
          isReturn === undefined ? '' : `&isReturn=${isReturn}`
        }${ledgerId ? `&ledgerId=${encodeURIComponent(ledgerId)}` : ''}`,
      ),
    next: () => get<{ billNo: number }>('/sales/next'),
    get: (id: string) => get<Sale>(`/sales/${id}`),
    create: (body: unknown) => post<Sale>('/sales', body),
    update: (id: string, body: unknown) => put<Sale>(`/sales/${id}`, body),
    delete: (id: string) => del<{ ok: boolean }>(`/sales/${id}`),
  },

  audit: {
    list: (q = '', action = '', page = 1, limit = 50, entityId = '') =>
      get<Page<AuditEntry>>(
        `/audit?q=${encodeURIComponent(q)}&action=${encodeURIComponent(action)}` +
          `&page=${page}&limit=${limit}&entityId=${encodeURIComponent(entityId)}`,
      ),
  },

  dashboard: {
    summary: (from = '', to = '') =>
      get<DashboardSummary>(
        `/dashboard/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  },

  settings: {
    get: () => get<AppSettings>('/settings'),
    update: (body: Partial<AppSettings>) => put<AppSettings>('/settings', body),
  },
};
