import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken } from './api';

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'client';
  force_password_change: boolean;
  daily_limit: number;
  monthly_limit: number;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: AuthUser }>('/auth/me');
      setUser(r.user);
    } catch {
      setUser(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (localStorage.getItem('svp_token')) refresh();
    else setLoading(false);
  }, [refresh]);

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

  return <Ctx.Provider value={{ user, loading, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() { return useContext(Ctx); }
