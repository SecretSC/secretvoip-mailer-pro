// Single source of truth for the API base. App is mounted at /smtp/,
// Apache proxies /smtp/api/* -> backend /api/*.
const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

export class ApiError extends Error {
  status: number;
  code?: string;
  detail?: unknown;
  network?: boolean;
  constructor(status: number, message: string, code?: string, detail?: unknown, network = false) {
    super(message); this.status = status; this.code = code; this.detail = detail; this.network = network;
  }
}

function getToken(): string | null {
  return localStorage.getItem('svp_token');
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem('svp_token', t);
  else localStorage.removeItem('svp_token');
}

// Connection-state listeners (so the UI can show "Reconnecting…" without logging out).
type ConnListener = (online: boolean) => void;
const connListeners = new Set<ConnListener>();
let lastOnline = true;
export function onConnectionChange(fn: ConnListener) {
  connListeners.add(fn);
  fn(lastOnline);
  return () => connListeners.delete(fn);
}
function setOnline(v: boolean) {
  if (v === lastOnline) return;
  lastOnline = v;
  for (const l of connListeners) { try { l(v); } catch {} }
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

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: opts.method ?? 'GET', headers, body });
  } catch (e: any) {
    // Network / CORS / proxy hiccup — DO NOT log the user out.
    setOnline(false);
    throw new ApiError(0, 'connection_lost', 'network_error', null, true);
  }
  setOnline(true);

  // 502/503/504 = upstream blip; treat as transient — keep the user logged in.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    setOnline(false);
    throw new ApiError(res.status, 'service_unavailable', 'service_unavailable', null, true);
  }

  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;

  if (!res.ok) {
    const code = (data && typeof data === 'object' && 'error' in data) ? (data as any).error : undefined;
    // ONLY force re-login on a true auth failure with our token (expired / revoked / invalid).
    if (
      res.status === 401 &&
      tok &&
      (code === 'unauthorized' || code === 'token_expired' || code === 'invalid_token')
    ) {
      setToken(null);
      window.location.assign(`${import.meta.env.BASE_URL}login`);
    }
    throw new ApiError(res.status, (data as any)?.message ?? (data as any)?.error ?? res.statusText, code, data);
  }
  return data as T;
}
