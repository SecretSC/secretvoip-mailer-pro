import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, onConnectionChange } from './api';

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'client';
  force_password_change: boolean;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  online: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: AuthUser }>('/auth/me');
      setUser(r.user);
    } catch (e: any) {
      // Only clear user on true auth failure, never on transient connection issues
      if (!e?.network && e?.status !== 0 && e?.status !== 502 && e?.status !== 503 && e?.status !== 504) {
        if (e?.status === 401) setUser(null);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (localStorage.getItem('svp_token')) refresh();
    else setLoading(false);
  }, [refresh]);

  // Keep session warm: re-verify token every 10 minutes; retry every 30s while offline.
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => { refresh(); }, online ? 10 * 60 * 1000 : 30 * 1000);
    return () => clearInterval(id);
  }, [user, online, refresh]);

  // Subscribe to connection state from api.ts
  useEffect(() => onConnectionChange(setOnline), []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; user: AuthUser }>('/auth/login', { method: 'POST', body: { username, password } });
    setToken(r.token);
    setUser(r.user);
  }, []);

  const logout = useCallback(() => {
    api('/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, online, login, logout, refresh }}>
      {!online && (
        <div className="fixed top-0 inset-x-0 z-[100] bg-amber-500/90 text-black text-center text-xs py-1.5 font-medium">
          Connection lost. Reconnecting…
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() { return useContext(Ctx); }
