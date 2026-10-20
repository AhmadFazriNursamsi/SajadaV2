import { useCallback, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useData, rupiah } from './hooks';
import { useSession } from './session';
import type { ShopProduct } from './shopData';

export type NotifTab = 'info' | 'trx';
export interface Notif { key: string; tab: NotifTab; cat: string; title: string; body: string; at: string | null; to: { pathname: string; params?: Record<string, string> } }

interface OrderRow { groupId: string; groupNo: string; product: string; status: string; role: 'seller' | 'buyer'; createdAt: string; total: number }
interface Rewards { entries: { id: string; amount: number; note: string | null; kind: string; createdAt: string }[]; withdrawals: { id: string; no: string; amount: number; status: 'pending' | 'paid' | 'rejected'; createdAt: string }[] }

export const TRX_CATS = ['Semua', 'Berjalan', 'Selesai', 'Dibatalkan'];
export const INFO_CATS = ['Semua', 'Saldo', 'Promo'];

const TRX_TEXT: Record<string, [string, string, string]> = {
  awaiting_approval: ['Menunggu persetujuan toko', 'Pesanan menunggu disetujui toko. Saldo terpotong setelah disetujui.', 'Berjalan'],
  awaiting_payment: ['Menunggu pembayaran', 'Pesanan sudah disetujui. Selesaikan pembayaran agar segera disiapkan.', 'Berjalan'],
  paid: ['Pesanan disiapkan', 'Pembayaran diterima. Toko sedang menyiapkan pesananmu.', 'Berjalan'],
  shipped: ['Pesanan dalam pengiriman', 'Pesananmu sedang dikirim. Konfirmasi saat barang diterima.', 'Berjalan'],
  received: ['Pesanan selesai', 'Terima kasih sudah belanja! Belanja lagi dan kumpulkan lebih banyak saldo penarikan.', 'Selesai'],
  cancelled: ['Pesanan dibatalkan', 'Pesanan ini dibatalkan.', 'Dibatalkan'],
  returned: ['Pesanan diretur', 'Pesanan ini diretur.', 'Dibatalkan'],
};
const WD_TEXT = { pending: 'diajukan, menunggu pengurus mentransfer', paid: 'sudah ditransfer ke rekeningmu', rejected: 'ditolak, saldo dikembalikan' } as const;

function groupRows(rows: OrderRow[]) {
  const g = new Map<string, OrderRow[]>();
  for (const r of rows) g.set(r.groupId, [...(g.get(r.groupId) ?? []), r]);
  return [...g.values()].map((rs) => ({ ...rs[0]!, total: rs.reduce((s, r) => s + r.total, 0), more: rs.length - 1 }));
}

export function buildNotifs(orders: OrderRow[], rewards: Rewards | undefined, products: ShopProduct[]): Notif[] {
  const out: Notif[] = [];
  for (const o of groupRows(orders)) {
    const [title, body, cat] = TRX_TEXT[o.status] ?? ['Status pesanan diperbarui', 'Lihat rinciannya di Transaksi.', 'Berjalan'];
    const what = `${o.product}${o.more > 0 ? ` dan ${o.more} produk lainnya` : ''}`;
    out.push({ key: `o${o.groupId}`, tab: 'trx', cat, title: o.role === 'seller' ? `Penjualan: ${title.toLowerCase()}` : title, body: `#${o.groupNo} · ${what} · ${rupiah(o.total)}.${o.role === 'seller' ? '' : ` ${body}`}`, at: o.createdAt, to: { pathname: '/(member)/orders' } });
  }
  for (const e of rewards?.entries ?? []) {
    if (e.amount <= 0) continue;
    out.push({ key: `e${e.id}`, tab: 'info', cat: 'Saldo', title: 'Saldo penarikan bertambah', body: `Kamu mendapat ${rupiah(e.amount)} ke saldo penarikan${e.note ? ` (${e.note})` : ''}. Yuk, belanja lagi dan kumpulkan lebih banyak.`, at: e.createdAt, to: { pathname: '/(member)/reward' } });
  }
  for (const w of rewards?.withdrawals ?? []) {
    out.push({ key: `w${w.id}`, tab: 'info', cat: 'Saldo', title: `Penarikan ${w.no}`, body: `Penarikan ${rupiah(w.amount)} ${WD_TEXT[w.status]}.`, at: w.createdAt, to: { pathname: '/(member)/reward' } });
  }
  for (const p of products.filter((x) => x.discountPct > 0)) {
    out.push({ key: `p${p.id}`, tab: 'info', cat: 'Promo', title: `Diskon ${p.discountPct}% ${p.name}`, body: `${p.name} kini ${rupiah(p.price)} (normal ${rupiah(p.listPrice)}). Belanja sebelum kehabisan.`, at: null, to: { pathname: '/(member)/product', params: { id: p.id } } });
  }
  return out.sort((a, b) => (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0));
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

/** Notifikasi anggota: disusun dari pesanan, saldo penarikan, dan produk diskon. "Belum dibaca" = lebih baru dari waktu terakhir halaman dibuka (disimpan di perangkat). */
export function useNotifs(products: ShopProduct[]) {
  const { me } = useSession();
  const ord = useData<{ orders: OrderRow[] }>('/me/orders');
  const rew = useData<Rewards>('/me/rewards');
  const key = me ? `notif-seen-${me.sub}` : null;
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => { if (key) SecureStore.getItemAsync(key).then((v) => setSeen(v ? Number(v) : 0), () => setSeen(0)); }, [key]);
  const items = useMemo(() => buildNotifs(ord.data?.orders ?? [], rew.data, products), [ord.data, rew.data, products]);
  const unread = (tab?: NotifTab) => (seen === null ? 0 : items.filter((n) => n.at && Date.parse(n.at) > seen && (!tab || n.tab === tab)).length);
  const markSeen = useCallback(() => {
    const t = Date.now();
    setSeen(t);
    if (key) SecureStore.setItemAsync(key, String(t)).catch(() => undefined);
  }, [key]);
  const { refetch: refetchOrders } = ord;
  const { refetch: refetchRewards } = rew;
  const refetch = useCallback(() => { void refetchOrders(); void refetchRewards(); }, [refetchOrders, refetchRewards]);
  return { items, seen, unread, markSeen, refetch, loading: ord.isLoading || rew.isLoading, refreshing: ord.isRefetching || rew.isRefetching, error: (ord.error ?? rew.error) as Error | null };
}
