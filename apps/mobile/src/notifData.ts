import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useData, rupiah } from './hooks';
import { api } from './api';
import type { ShopProduct } from './shopData';

export type NotifTab = 'info' | 'trx';
export type NotifRoute = 'orders' | 'reward' | 'coins' | 'product' | 'staff-orders' | 'staff-receive';
export interface Notif { key: string; id: string | null; tab: NotifTab; cat: string; title: string; body: string; at: string | null; read: boolean; route: NotifRoute; refId: string | null }

interface Inbox { items: { id: string; tab: NotifTab; cat: string; title: string; body: string; route: NotifRoute; refId: string | null; read: boolean; at: string }[]; unread: { info: number; trx: number } }

/** Urutan kategori pada chip filter; kategori yang belum punya notifikasi tidak ditampilkan. */
const CAT_ORDER = ['Perlu diproses', 'Berjalan', 'Selesai', 'Dibatalkan', 'Laporan', 'Saldo', 'Koin', 'Kiriman', 'Promo'];
export const catsFor = (items: Notif[], tab: NotifTab) => {
  const present = new Set(items.filter((n) => n.tab === tab).map((n) => n.cat));
  return ['Semua', ...CAT_ORDER.filter((c) => present.has(c)), ...[...present].filter((c) => !CAT_ORDER.includes(c))];
};

const ICON: Record<string, [string, 'ok' | 'warn' | 'bad']> = {
  'Perlu diproses': ['alert-circle-outline', 'warn'], Berjalan: ['cube-outline', 'warn'], Selesai: ['checkmark-circle-outline', 'ok'], Dibatalkan: ['close-circle-outline', 'bad'],
  Laporan: ['warning-outline', 'bad'], Saldo: ['wallet-outline', 'ok'], Koin: ['ribbon-outline', 'warn'], Kiriman: ['car-outline', 'ok'], Promo: ['pricetag-outline', 'warn'],
};
export const iconOf = (cat: string) => ICON[cat] ?? ['notifications-outline', 'ok'];

/** Tujuan layar untuk satu notifikasi; pesanan membuka kartu pesanannya. */
export function destination(n: Pick<Notif, 'route' | 'refId'>): { pathname: string; params?: Record<string, string> } {
  if (n.route === 'orders') return { pathname: '/(member)/orders', params: n.refId ? { open: n.refId } : undefined };
  if (n.route === 'staff-orders') return { pathname: '/(staff)/orders', params: n.refId ? { status: n.refId } : undefined };
  if (n.route === 'staff-receive') return { pathname: '/(staff)/receive', params: n.refId ? { id: n.refId } : undefined };
  if (n.route === 'product') return { pathname: '/(member)/product', params: n.refId ? { id: n.refId } : undefined };
  return { pathname: n.route === 'coins' ? '/(member)/coins' : '/(member)/reward' };
}

/** Pengelompokan tanggal ala kotak masuk: "Hari ini", "Kemarin", "Sebelumnya". */
export function dayGroup(iso: string | null, now = Date.now()) {
  if (!iso) return 'Promo berjalan';
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const t = Date.parse(iso);
  if (t >= start.getTime()) return 'Hari ini';
  if (t >= start.getTime() - 86_400_000) return 'Kemarin';
  return 'Sebelumnya';
}

/** "9 hari lalu" */
export function ago(iso: string | null, now = Date.now()) {
  if (!iso) return '';
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (m < 1) return 'Baru saja';
  if (m < 60) return `${m} menit lalu`;
  if (m < 1440) return `${Math.floor(m / 60)} jam lalu`;
  return `${Math.floor(m / 1440)} hari lalu`;
}

/** Kotak masuk anggota dari server (status baca disimpan di server), ditambah promo diskon yang diturunkan dari katalog. */
export function useNotifs(products: ShopProduct[]) {
  const qc = useQueryClient();
  const q = useData<Inbox>('/me/notifications');
  const { refetch: refetchInbox } = q;
  const items = useMemo<Notif[]>(() => {
    const server = (q.data?.items ?? []).map((n) => ({ ...n, key: n.id }));
    const promos = products.filter((p) => p.discountPct > 0).map<Notif>((p) => ({
      key: `p${p.id}`, id: null, tab: 'info', cat: 'Promo', title: `Diskon ${p.discountPct}% ${p.name}`, body: `${p.name} kini ${rupiah(p.price)} (normal ${rupiah(p.listPrice)}). Belanja sebelum kehabisan.`,
      at: null, read: true, route: 'product', refId: p.id,
    }));
    return [...server, ...promos];
  }, [q.data, products]);
  const unread = (tab?: NotifTab) => (tab ? q.data?.unread[tab] ?? 0 : (q.data?.unread.info ?? 0) + (q.data?.unread.trx ?? 0));

  /** Tandai terbaca (tanpa `ids` = semua). Tampilan diperbarui lebih dulu, lalu disinkronkan ke server. */
  const markRead = useCallback(async (ids?: string[]) => {
    qc.setQueryData<Inbox>(['/me/notifications'], (d) => {
      if (!d) return d;
      const set = ids ? new Set(ids) : null;
      const next = d.items.map((n) => (!n.read && (!set || set.has(n.id)) ? { ...n, read: true } : n));
      const count = (tab: NotifTab) => next.filter((n) => n.tab === tab && !n.read).length;
      return { items: next, unread: { info: count('info'), trx: count('trx') } };
    });
    try { await api('POST', '/me/notifications/read', ids ? { ids } : {}); }
    catch { void refetchInbox(); }
  }, [qc, refetchInbox]);

  const refetch = useCallback(() => { void refetchInbox(); }, [refetchInbox]);
  return { items, unread, markRead, refetch, loading: q.isLoading, refreshing: q.isRefetching, error: q.error as Error | null };
}
