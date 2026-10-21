import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useData, rupiah } from './hooks';
import { api } from './api';
import type { ShopProduct } from './shopData';

export type NotifTab = 'info' | 'trx';
export type NotifRoute = 'orders' | 'reward' | 'coins' | 'product';
export interface Notif { key: string; id: string | null; tab: NotifTab; cat: string; title: string; body: string; at: string | null; read: boolean; route: NotifRoute; refId: string | null }

interface Inbox { items: { id: string; tab: NotifTab; cat: string; title: string; body: string; route: NotifRoute; refId: string | null; read: boolean; at: string }[]; unread: { info: number; trx: number } }

export const TRX_CATS = ['Semua', 'Berjalan', 'Selesai', 'Dibatalkan'];
export const INFO_CATS = ['Semua', 'Saldo', 'Koin', 'Promo'];

const ICON: Record<string, [string, 'ok' | 'warn' | 'bad']> = {
  Berjalan: ['cube-outline', 'warn'], Selesai: ['checkmark-circle-outline', 'ok'], Dibatalkan: ['close-circle-outline', 'bad'],
  Saldo: ['wallet-outline', 'ok'], Koin: ['ribbon-outline', 'warn'], Promo: ['pricetag-outline', 'warn'],
};
export const iconOf = (cat: string) => ICON[cat] ?? ['notifications-outline', 'ok'];

/** Tujuan layar untuk satu notifikasi; pesanan membuka kartu pesanannya. */
export function destination(n: Pick<Notif, 'route' | 'refId'>): { pathname: string; params?: Record<string, string> } {
  if (n.route === 'orders') return { pathname: '/(member)/orders', params: n.refId ? { open: n.refId } : undefined };
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
