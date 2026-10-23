import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../../src/api';
import { useCart } from '../../src/cart';
import { rupiah, useData } from '../../src/hooks';
import { OrderDetail } from '../../src/OrderDetail';
import { OrderCard } from '../../src/OrderCard';
import { STATUS, type OrderGroup } from '../../src/orderMeta';
import { PickerSheet } from '../../src/PickerSheet';
import { Header, Pill } from '../../src/ListHeader';
import { maxOrderable, useShop, type ShopProduct } from '../../src/shopData';
import { C } from '../../src/theme';
import { Button, Chips } from '../../src/ui';
import { guardGroup } from '../../src/roleRoute';

type Kind = 'all' | 'buy' | 'sell';
type Msg = { ok: boolean; text: string } | null;
type Sheet = 'status' | 'date' | null;

const DATE_OPTIONS = [{ v: 'all', l: 'Semua Tanggal' }, { v: '7', l: '7 hari terakhir' }, { v: '30', l: '30 hari terakhir' }, { v: '90', l: '90 hari terakhir' }];
const STATUS_OPTIONS = [{ v: 'all', l: 'Semua Status' }, ...Object.entries(STATUS).filter(([k]) => k !== 'returned').map(([k, [l]]) => ({ v: k, l }))];
const labelOf = (opts: { v: string; l: string }[], v: string) => opts.find((o) => o.v === v)?.l ?? '';

/** Satu pesanan = satu checkout dengan banyak produk: gabungkan baris-barisnya (status sama). */
function groupOrders(rows: any[]): OrderGroup[] {
  const m = new Map<string, any[]>();
  for (const r of rows) m.set(r.groupId, [...(m.get(r.groupId) ?? []), r]);
  return [...m.values()].map((rs) => {
    const lines = [...rs].sort((a, b) => a.lineNo - b.lineNo);
    const h = lines[0];
    return { ...h, no: h.groupNo, lines: lines.map((l) => ({ productId: l.productId, product: l.product, qty: l.qty, price: l.price, total: l.total })), total: lines.reduce((n: number, l: any) => n + l.total, 0) } as OrderGroup;
  });
}

function matches(o: OrderGroup, f: { kind: Kind; status: string; days: string; q: string }) {
  const sale = o.role === 'seller' && !o.selfOrder;
  if (f.kind === 'buy' && sale) return false;
  if (f.kind === 'sell' && !sale) return false;
  if (f.status !== 'all' && o.status !== f.status) return false;
  if (f.days !== 'all' && Date.now() - new Date(o.createdAt).getTime() > Number(f.days) * 86_400_000) return false;
  const q = f.q.trim().toLowerCase();
  return !q || o.no.toLowerCase().includes(q) || o.depot.toLowerCase().includes(q) || o.lines.some((l) => l.product.toLowerCase().includes(q));
}

/** Bayar dari saldo belanja (hanya muncul bila pesanan menunggu pembayaran). */
function PayBlock({ o, balance, confirm, setConfirm, pay }: { o: OrderGroup; balance: number; confirm: string | null; setConfirm: (id: string | null) => void; pay: { isPending: boolean; mutate: (id: string) => void } }) {
  if (!o.canPay) return null;
  if (confirm !== o.id) return <Button label={`Bayar ${rupiah(o.total)} dari saldo`} kind="gold" onPress={() => setConfirm(o.id)} />;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: C.ink }}>Bayar {rupiah(o.total)} dari saldo belanja ({rupiah(balance)})? Sisa saldo: {rupiah(balance - o.total)}.</Text>
      <Button label={pay.isPending ? 'Memproses…' : 'Ya, bayar sekarang'} kind="gold" disabled={pay.isPending} onPress={() => pay.mutate(o.id)} />
      <Button label="Batal" kind="ghost" onPress={() => setConfirm(null)} />
    </View>
  );
}

function ReportNote({ r }: { r: OrderGroup['report'] }) {
  if (!r) return null;
  if (r.verifyStatus === 'pending') return <View style={{ padding: 10, backgroundColor: C.warn[0], borderRadius: 8 }}><Text style={{ color: C.warn[1], fontWeight: '600' }}>Foto terkirim, menunggu verifikasi petugas toko</Text><Text style={{ color: C.warn[1], fontSize: 12 }}>Pesanan selesai setelah petugas menyatakan foto valid.</Text></View>;
  if (r.verifyStatus === 'invalid') return <View style={{ padding: 10, backgroundColor: C.bad[0], borderRadius: 8 }}><Text style={{ color: C.bad[1], fontWeight: '600' }}>Foto ditolak petugas toko</Text><Text style={{ color: C.bad[1], fontSize: 12 }}>{r.verifyNote ?? 'Foto belum sesuai.'} Kirim ulang foto barang yang diterima.</Text></View>;
  if (r.status === 'ok') return <Text style={{ color: C.muted, fontSize: 12 }}>✓ Barang sesuai pesanan, sudah diverifikasi petugas toko.</Text>;
  const open = r.status === 'open';
  return (
    <View style={{ padding: 10, backgroundColor: open ? C.bad[0] : C.ok[0], borderRadius: 8 }}>
      <Text style={{ color: open ? C.bad[1] : C.green, fontWeight: '600' }}>{open ? 'Laporan barang tidak sesuai terkirim' : 'Laporan Anda sudah ditanggapi toko'}</Text>
      <Text style={{ color: open ? C.bad[1] : C.green, fontSize: 12 }}>{open ? 'Menunggu tanggapan toko.' : `${r.resolvedByName}: ${r.resolution}`}</Text>
    </View>
  );
}

/** Isi yang terbuka saat kartu diketuk: perjalanan pesanan, bayar, laporan, dan cek barang. */
function Extras({ o, products, pay, balance, confirm, setConfirm }: { o: OrderGroup; products: Map<string, ShopProduct>; pay: { isPending: boolean; mutate: (id: string) => void }; balance: number; confirm: string | null; setConfirm: (id: string | null) => void }) {
  const router = useRouter();
  const detail = { status: o.status, depot: o.depot, createdAt: o.createdAt, approvedAt: o.approvedAt, approvedBy: o.approvedBy, pay: o.pay, shipped: o.shipped, deliveryRef: o.deliveryRef, received: o.received, receivedAt: o.receivedAt, receiverName: o.receiverName, proofRef: o.proofRef, cancelReason: o.cancelReason, total: o.total, party: o.selfOrder ? 'Belanja sendiri' : o.buyerName ? `Dijual ke ${o.buyerName}` : undefined, report: o.report, lines: o.lines.map((l) => ({ name: l.product, qty: l.qty, price: l.price, total: l.total, product: products.get(l.productId) })) };
  return (
    <>
      <OrderDetail o={detail} hideContents />
      <PayBlock o={o} balance={balance} confirm={confirm} setConfirm={setConfirm} pay={pay} />
      <ReportNote r={o.report} />
      {o.canCheck && <Button label={o.report?.verifyStatus === 'invalid' ? 'Kirim ulang foto barang' : 'Cek barang yang dikirim'} kind="ghost" onPress={() => router.push({ pathname: '/(member)/check', params: { id: o.id } })} />}
      {o.status === 'awaiting_approval' && <Text style={{ color: C.muted, fontSize: 12 }}>Menunggu persetujuan toko. Setelah disetujui, saldo belanja otomatis terpotong dan pesanan siap dikirim.</Text>}
    </>
  );
}

function usePay(setMsg: (m: Msg) => void) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<string | null>(null);
  const pay = useMutation({
    mutationFn: (id: string) => api('POST', `/me/orders/${id}/pay`),
    onSuccess: () => { setConfirm(null); setMsg({ ok: true, text: 'Pembayaran berhasil. Saldo belanja Anda sudah dikurangi; petugas toko akan mengirim pesanan.' }); void qc.invalidateQueries(); },
    onError: (e) => { setConfirm(null); setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Pembayaran gagal. Coba lagi.' }); },
  });
  return { pay, confirm, setConfirm };
}

/** Daftar Transaksi bergaya Klik Indomaret: filter status/tanggal, chip jenis, dan kartu per pesanan dengan Beli Lagi. */
function Orders() {
  const router = useRouter();
  const cart = useCart();
  const q = useData<{ orders: any[] }>('/me/orders');
  const me = useData<{ balance: number }>('/me');
  const shop = useShop();
  // Status berubah di sisi lain (mis. disetujui toko): muat ulang setiap kali tab ini dibuka.
  useFocusEffect(useCallback(() => { void q.refetch(); void me.refetch(); void shop.refetch(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));
  const [kind, setKind] = useState<Kind>('all');
  const [status, setStatus] = useState('all');
  const [days, setDays] = useState('all');
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const { pay, confirm, setConfirm } = usePay(setMsg);
  // Dibuka dari notifikasi: tampilkan pesanan itu terbuka, dengan filter dikosongkan agar pasti terlihat.
  const { open: openParam } = useLocalSearchParams<{ open?: string }>();
  useEffect(() => {
    if (!openParam) return;
    setKind('all'); setStatus('all'); setDays('all'); setText(''); setSearching(false);
    setOpenId(openParam);
    router.setParams({ open: undefined });
  }, [openParam, router]);

  const all = useMemo(() => groupOrders(q.data?.orders ?? []), [q.data]);
  const list = useMemo(() => all.filter((o) => matches(o, { kind, status, days, q: text })), [all, kind, status, days, text]);
  const products = useMemo(() => new Map((shop.data?.products ?? []).map((p) => [p.id, p])), [shop.data]);
  const kinds = useMemo(() => [{ v: 'all' as Kind, l: 'Semua' }, { v: 'buy' as Kind, l: 'Belanja' }, ...(all.some((o) => o.role === 'seller' && !o.selfOrder) ? [{ v: 'sell' as Kind, l: 'Penjualan' }] : [])], [all]);

  /** Beli Lagi: masukkan SEMUA produk pesanan itu ke keranjang dengan jumlah semula; yang sudah tidak dijual/habis dilewati dan disebutkan. */
  const buyAgain = useCallback((o: OrderGroup) => {
    const ok: { id: string; qty: number }[] = [];
    const skipped: string[] = [];
    for (const l of o.lines) {
      const p = products.get(l.productId);
      const max = p ? maxOrderable(p) : 0;
      if (p && max > 0) ok.push({ id: l.productId, qty: Math.min(l.qty, max) }); else skipped.push(l.product);
    }
    if (ok.length === 0) { setMsg({ ok: false, text: 'Produk pada pesanan ini sedang tidak tersedia.' }); return; }
    cart.addMany(ok);
    if (skipped.length) setMsg({ ok: false, text: `${ok.length} produk masuk keranjang. Tidak tersedia: ${skipped.join(', ')}.` });
    router.push('/(member)/cart');
  }, [products, cart, router]);

  const renderItem = useCallback(({ item }: { item: OrderGroup }) => (
    <OrderCard o={item} products={products} open={openId === item.groupId} onToggle={() => setOpenId(openId === item.groupId ? null : item.groupId)} onBuyAgain={() => buyAgain(item)}>
      <Extras o={item} products={products} pay={pay} balance={me.data?.balance ?? 0} confirm={confirm} setConfirm={setConfirm} />
    </OrderCard>
  ), [products, openId, buyAgain, pay, me.data, confirm, setConfirm]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="Daftar Transaksi" placeholder="Cari nomor, toko, atau produk" searching={searching} q={text} onQ={setText} onToggle={() => { setSearching((v) => !v); setText(''); }} />
      <View style={s.filters}>
        <Pill label={labelOf(STATUS_OPTIONS, status)} active={status !== 'all'} onPress={() => setSheet('status')} />
        <Pill label={labelOf(DATE_OPTIONS, days)} active={days !== 'all'} onPress={() => setSheet('date')} />
      </View>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}><Chips value={kind} onChange={setKind} options={kinds} /></View>
      {msg && <View style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: msg.ok ? C.ok[0] : C.bad[0], borderRadius: 8, padding: 12 }}><Text style={{ color: msg.ok ? C.green : C.bad[1] }}>{msg.text}</Text></View>}
      <FlatList data={list} keyExtractor={(o) => o.groupId} renderItem={renderItem} extraData={[openId, confirm, pay.isPending]} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        onRefresh={() => void q.refetch()} refreshing={q.isRefetching}
        ListEmptyComponent={<Text style={{ color: q.error ? C.bad[1] : C.muted, textAlign: 'center', marginTop: 40 }}>{q.error ? `Gagal memuat: ${(q.error as Error).message}` : q.isLoading ? 'Memuat…' : 'Belum ada transaksi.'}</Text>} />
      {sheet === 'status' && <PickerSheet title="Status transaksi" value={status} options={STATUS_OPTIONS} onPick={(v) => { setStatus(v); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === 'date' && <PickerSheet title="Tanggal transaksi" value={days} options={DATE_OPTIONS} onPick={(v) => { setDays(v); setSheet(null); }} onClose={() => setSheet(null)} />}
    </View>
  );
}

const s = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: C.line },
});

export default guardGroup('member', 'orders', Orders);
