import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Role } from '@sajadah/shared';
import { Platform } from 'react-native';
import { api, storage } from './api';

export interface Me { sub: string; tid: string; role: Role; name: string; mid: string | null; username: string; mustChangePassword: boolean }
interface Session { me: Me | null; ready: boolean; login: (u: string, p: string) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void> }
const Ctx = createContext<Session>(null as never);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try { if (Platform.OS === 'web' || (await storage.get())) setMe(await api<Me>('GET', '/auth/me')); }
      catch { await storage.set(null); }
      finally { setReady(true); }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; user: Me }>('POST', '/auth/login', { username, password });
    if (Platform.OS !== 'web') await storage.set(r.token);
    qc.clear();
    setMe(r.user);
  }, [qc]);
  const logout = useCallback(async () => {
    if (Platform.OS === 'web') await api('POST', '/auth/logout').catch(() => undefined);
    await storage.set(null); qc.clear(); setMe(null);
  }, [qc]);

  const refresh = useCallback(async () => { setMe(await api<Me>('GET', '/auth/me')); }, []);
  const value = useMemo(() => ({ me, ready, login, logout, refresh }), [me, ready, login, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
