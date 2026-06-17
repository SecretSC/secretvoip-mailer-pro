// Single source of truth for the API base. App is mounted at /smtp/,
// Apache proxies /smtp/api/* -> backend /api/*.
const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

export class ApiError extends Error {
  status: number;
  code?: string;
  detail?: unknown;
  constructor(status: number, message: string, code?: string, detail?: unknown) {
    super(message); this.status = status; this.code = code; this.detail = detail;
  }
}

function getToken(): string | null {
  return localStorage.getItem('svp_token');
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem('svp_token', t);
  else localStorage.removeItem('svp_token');
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | undefined>; form?: FormData } = {}
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {};
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(url.toString(), { method: opts.method ?? 'GET', headers, body });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const code = (data && typeof data === 'object' && 'error' in data) ? (data as any).error : undefined;
    // Force re-login only on real 401s with no token; do NOT log out on transient errors
    if (res.status === 401 && tok && code !== 'invalid_credentials') {
      // token expired or revoked
      setToken(null);
      window.location.assign(`${import.meta.env.BASE_URL}login`);
    }
    throw new ApiError(res.status, (data as any)?.message ?? (data as any)?.error ?? res.statusText, code, data);
  }
  return data as T;
}
