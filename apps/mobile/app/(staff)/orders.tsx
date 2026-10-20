import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useData } from '../../src/hooks';
import { Header, Pill } from '../../src/ListHeader';
import { OrderCard } from '../../src/OrderCard';
import { OrderDetail } from '../../src/OrderDetail';
import { STATUS, type OrderGroup } from '../../src/orderMeta';
import { PickerSheet } from '../../src/PickerSheet';
import { StaffOrderActions } from '../../src/StaffOrderActions';
import { C } from '../../src/theme';

const STATUS_OPTIONS = [{ v: 'all', l: 'Semua Status' }, { v: 'report', l: 'Ada laporan anggota' }, ...Object.entries(STATUS).filter(([k]) => k !== 'returned').map(([k, [l]]) => ({ v: k, l }))];
const DATE_OPTIONS = [{ v: 'all', l: 'Semua Tanggal' }, { v: '7', l: '7 hari terakhir' }, { v: '30', l: '30 hari terakhir' }, { v: '90', l: '90 hari terakhir' }];
const labelOf = (opts: { v: string; l: string }[], v: string) => opts.find((o) => o.v === v)?.l ?? '';
type Thumb = { name: string; imageUrl: string | null };
type Row = OrderGroup & { raw: any; label: string; party: string };

/** Satu pesanan = satu checkout dengan banyak produk: gabungkan baris-barisnya (status sama). */
function groupOrders(rows: any[], name: (id: string) => string): Row[] {
  const m = new Map<string, any[]>();
  for (const r of rows) m.set(r.groupId, [...(m.get(r.groupId) ?? []), r]);
  return [...m.values()].map((rs) => {
    const lines = [...rs].sort((a, b) => a.lineNo - b.lineNo);
    const h = lines[0];
    const total = lines.reduce((n: number, l: any) => n + l.total, 0);
    const member = !!h.buyerId;
    const raw = { ...h, no: h.groupNo, id: h.id };
    return {
      ...h, no: h.groupNo, depot: h.depotName, total, role: 'buyer', selfOrder: true, raw,
      lines: lines.map((l) => ({ productId: l.productId, product: name(l.productId), qty: l.qty, price: l.price, total: l.total })),
      label: member ? 'Pesanan Anggota' : 'Pesanan Pelanggan Umum', party: member ? (h.buyerName ?? '') : (h.customerName ?? ''),
    } as unknown as Row;
  });
}

function matches(o: Row, f: { status: string; days: string; q: string }) {
  if (f.status === 'report' ? o.raw.report?.status !== 'open' : f.status !== 'all' && o.status !== f.status) return false;
  if (f.days !== 'all' && Date.now() - new Date(o.createdAt).getTime() > Number(f.days) * 86_400_000) return false;
  const q = f.q.trim().toLowerCase();
  return !q || o.no.toLowerCase().includes(q) || o.party.toLowerCase().includes(q) || o.lines.some((l) => l.product.toLowerCase().includes(q));
}

function detailOf(o: Row) {
  const r = o.raw;
  return { status: o.status, depot: o.depot, createdAt: o.createdAt, approvedAt: r.approvedAt, approvedBy: r.approvedBy, pay: r.pay, shipped: r.shipped, deliveryRef: r.deliveryRef, received: r.received, receivedAt: r.receivedAt, receiverName: r.receiverName, proofRef: r.proofRef, cancelReason: r.cancelReason, total: o.total, party: r.buyerId ? `Anggota ${r.buyerName ?? ''}`.trim() : `${r.customerName} (pelanggan umum)`, report: r.report, lines: o.lines.map((l) => ({ name: l.product, qty: l.qty, price: l.price, total: l.total })) };
}

/** Daftar pesanan toko bergaya "Daftar Transaksi": cari, saring status/tanggal, kartu bergambar produk; tindakan petugas ada di dalam kartu. */
export default function Orders() {
  const params = useLocalSearchParams<{ status?: string }>();
  const q = useData<any[]>('/orders');
  const prods = useData<any[]>('/products');
  const { refetch } = q;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const [status, setStatus] = useState(params.status ?? 'all');
  const [days, setDays] = useState('all');
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const [sheet, setSheet] = useState<'status' | 'date' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Layar tab tetap terpasang: ikuti status baru dari kartu tugas di Beranda.
  useEffect(() => { setStatus(params.status ?? 'all'); }, [params.status]);

  const thumbs = useMemo(() => new Map<string, Thumb>((prods.data ?? []).map((p) => [p.id, { name: p.name, imageUrl: p.image ? `/api/products/image/${p.image}` : null }])), [prods.data]);
  const all = useMemo(() => groupOrders(q.data ?? [], (id) => thumbs.get(id)?.name ?? 'Produk'), [q.data, thumbs]);
  // Pesanan yang perlu disetujui tampil paling atas.
  const list = useMemo(() => {
    const f = all.filter((o) => matches(o, { status, days, q: text }));
    return [...f.filter((o) => o.status === 'awaiting_approval'), ...f.filter((o) => o.status !== 'awaiting_approval')];
  }, [all, status, days, text]);
  const renderItem = useCallback(({ item }: { item: Row }) => (
    <OrderCard o={item} products={thumbs} title={item.label} party={item.party} open={openId === item.groupId} onToggle={() => setOpenId(openId === item.groupId ? null : item.groupId)}>
      <OrderDetail o={detailOf(item)} hideContents />
      <StaffOrderActions o={item.raw} total={item.total} />
    </OrderCard>
  ), [thumbs, openId]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title="Pesanan Toko" placeholder="Cari nomor, nama, atau produk" searching={searching} q={text} onQ={setText} onToggle={() => { setSearching((v) => !v); setText(''); }} />
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Pill label={labelOf(STATUS_OPTIONS, status)} active={status !== 'all'} onPress={() => setSheet('status')} />
        <Pill label={labelOf(DATE_OPTIONS, days)} active={days !== 'all'} onPress={() => setSheet('date')} />
      </View>
      <FlatList data={list} keyExtractor={(o) => o.groupId} renderItem={renderItem} extraData={openId} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        onRefresh={() => void refetch()} refreshing={q.isRefetching}
        ListEmptyComponent={<Text style={{ color: q.error ? C.bad[1] : C.muted, textAlign: 'center', marginTop: 40 }}>{q.error ? `Gagal memuat: ${(q.error as Error).message}` : q.isLoading ? 'Memuat…' : 'Belum ada pesanan.'}</Text>} />
      {sheet === 'status' && <PickerSheet title="Status pesanan" value={status} options={STATUS_OPTIONS} onPick={(v) => { setStatus(v); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === 'date' && <PickerSheet title="Tanggal pesanan" value={days} options={DATE_OPTIONS} onPick={(v) => { setDays(v); setSheet(null); }} onClose={() => setSheet(null)} />}
    </View>
  );
}
