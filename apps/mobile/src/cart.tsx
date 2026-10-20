import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useSession } from './session';

type Lines = Record<string, number>;
interface Cart { lines: Lines; count: number; qtyOf: (id: string) => number; add: (id: string, by?: number) => void; addMany: (items: { id: string; qty: number }[]) => void; setQty: (id: string, qty: number) => void; remove: (id: string) => void; clear: () => void }

const Ctx = createContext<Cart | null>(null);
const keyOf = (username: string) => `sajadah.cart.${username.replace(/[^A-Za-z0-9._-]/g, '_')}`;

/** Keranjang belanja anggota: disimpan per akun di perangkat (SecureStore); di web hanya selama halaman terbuka. */
export function CartProvider({ children }: { children: ReactNode }) {
  const username = useSession().me?.username;
  const key = username ? keyOf(username) : null;
  const [lines, setLines] = useState<Lines>({});

  useEffect(() => {
    setLines({});
    if (!key) return;
    SecureStore.getItemAsync(key).then((v) => { if (v) setLines(JSON.parse(v) as Lines); }, () => undefined);
  }, [key]);

  const commit = useCallback((next: Lines) => {
    setLines(next);
    if (key) SecureStore.setItemAsync(key, JSON.stringify(next)).catch(() => undefined);
  }, [key]);

  const value = useMemo<Cart>(() => {
    const setQty = (id: string, qty: number) => {
      const next = { ...lines };
      if (qty <= 0) delete next[id]; else next[id] = Math.min(999, Math.floor(qty));
      commit(next);
    };
    return {
      lines, count: Object.values(lines).reduce((n, q) => n + q, 0),
      qtyOf: (id) => lines[id] ?? 0,
      add: (id, by = 1) => setQty(id, (lines[id] ?? 0) + by),
      // Banyak produk sekaligus dalam satu pembaruan (memanggil add berulang memakai isi keranjang yang sama sehingga hanya yang terakhir tersimpan).
      addMany: (items) => { const next = { ...lines }; for (const it of items) if (it.qty > 0) next[it.id] = Math.min(999, (next[it.id] ?? 0) + Math.floor(it.qty)); commit(next); },
      setQty, remove: (id) => setQty(id, 0), clear: () => commit({}),
    };
  }, [lines, commit]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): Cart {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCart harus di dalam CartProvider');
  return c;
}
