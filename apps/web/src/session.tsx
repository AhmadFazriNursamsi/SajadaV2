import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Role } from '@sajadah/shared';
import { api, post } from './api';

export interface Me { sub: string; tid: string; role: Role; name: string; mid: string | null; username: string; mustChangePassword: boolean }
interface Session { me: Me | null; loading: boolean; login: (u: string, p: string) => Promise<void>; logout: () => void; refresh: () => Promise<void> }
const Ctx = createContext<Session>(null as never);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Me>('GET', '/auth/me').then(setMe).catch(() => setMe(null)).finally(() => setLoading(false));
  }, []);
  const logout = useCallback(() => { void post('/auth/logout').catch(() => {}); setMe(null); qc.clear(); }, [qc]);
  useEffect(() => { window.addEventListener('sajadah:logout', logout); return () => window.removeEventListener('sajadah:logout', logout); }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const r = await post<{ user: Me }>('/auth/login', { username, password });
    qc.clear();
    setMe(r.user);
  }, [qc]);

  const refresh = useCallback(async () => { setMe(await api<Me>('GET', '/auth/me')); }, []);
  const value = useMemo(() => ({ me, loading, login, logout, refresh }), [me, loading, login, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
