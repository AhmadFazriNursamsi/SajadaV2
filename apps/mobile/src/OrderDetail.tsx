import { Text, View } from 'react-native';
import { ProductImage } from './shop';
import type { ShopProduct } from './shopData';
import { C } from './theme';
import { Card, Row } from './ui';
import { rupiah } from './hooks';

export interface DetailOrder {
  status: string; depot?: string; createdAt: string; approvedAt: string | null; approvedBy: string | null; pay: 'unpaid' | 'balance' | 'cash';
  shipped: boolean; deliveryRef: string | null; received: boolean; receivedAt: string | null; receiverName: string | null; proofRef: string | null; cancelReason: string | null;
  /** `product` (bila ada) menampilkan foto produk di rincian. */
  lines: { name: string; qty: number; price: number; total: number; product?: ShopProduct }[]; total: number; party?: string;
  report?: { status: string; resolution: string | null } | null;
}
const when = (d: string | null) => (d ? new Date(d).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null);

const PAY_LABEL: Record<DetailOrder['pay'], string | null> = { balance: 'Dipotong dari saldo belanja', cash: 'Tunai, tercatat di kas koperasi', unpaid: null };
const heading = { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 } as const;

function buildSteps(o: DetailOrder): { l: string; done: boolean; sub: string | null }[] {
  return [
    { l: 'Dipesan', done: true, sub: when(o.createdAt) },
    { l: 'Disetujui toko', done: !!o.approvedAt, sub: o.approvedAt ? `${when(o.approvedAt)}${o.approvedBy ? ` · ${o.approvedBy}` : ''}` : null },
    { l: 'Dibayar', done: o.pay !== 'unpaid', sub: PAY_LABEL[o.pay] },
    { l: 'Dikirim', done: o.shipped, sub: o.shipped ? `Surat jalan ${o.deliveryRef ?? '—'}` : null },
    { l: 'Diterima', done: o.received, sub: o.received ? `${when(o.receivedAt) ?? ''} · ${o.receiverName ?? '—'}` : null },
  ];
}

function reportText(r: NonNullable<DetailOrder['report']>): string {
  if (r.status === 'ok') return 'sesuai';
  if (r.status === 'open') return 'ada laporan, menunggu tanggapan toko';
  return `laporan ditanggapi${r.resolution ? `: ${r.resolution}` : ''}`;
}

function CancelBanner({ reason }: { reason: string | null }) {
  return <View style={{ backgroundColor: C.bad[0], borderRadius: 8, padding: 10 }}><Text style={{ color: C.bad[1], fontWeight: '600' }}>Pesanan dibatalkan</Text><Text style={{ color: C.bad[1], fontSize: 12 }}>{reason ?? '—'}</Text></View>;
}

function Journey({ o }: { o: DetailOrder }) {
  return (
    <>
      <Text style={heading}>PERJALANAN PESANAN</Text>
      <Card>
        {buildSteps(o).map((st) => <Row key={st.l} title={`${st.done ? '✓' : '○'}  ${st.l}`} sub={st.sub ?? undefined} tone={st.done ? 'ok' : 'neutral'} />)}
      </Card>
    </>
  );
}

function LineRow({ l }: { l: DetailOrder['lines'][number] }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderTopWidth: 1, borderTopColor: C.line }}>
      {l.product && <ProductImage p={l.product} size={64} radius={8} />}
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.ink, fontWeight: '600', fontSize: 15 }}>{l.name}</Text>
        <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{l.qty} × {rupiah(l.price)}</Text>
      </View>
      <Text style={{ color: C.ink, fontWeight: '700' }}>{rupiah(l.total)}</Text>
    </View>
  );
}

function Contents({ o }: { o: DetailOrder }) {
  return (
    <>
      <Text style={heading}>ISI PESANAN</Text>
      <Card>
        {o.lines.map((l) => <LineRow key={l.name} l={l} />)}
        <Row title="Total" sub={[o.depot, o.party].filter(Boolean).join(' · ') || undefined} right={rupiah(o.total)} tone="ok" />
      </Card>
    </>
  );
}

/** Rincian satu pesanan: perjalanan (dipesan → disetujui → dibayar → dikirim → diterima), isi pesanan per produk, dan total (isi bisa disembunyikan). */
export function OrderDetail({ o, hideContents }: { o: DetailOrder; /** isi pesanan sudah tampil di tempat lain (mis. kartu transaksi anggota) */ hideContents?: boolean }) {
  return (
    <View style={{ gap: 8, paddingHorizontal: 10, paddingBottom: 10 }}>
      {o.status === 'cancelled' && <CancelBanner reason={o.cancelReason} />}
      <Journey o={o} />
      {!hideContents && <Contents o={o} />}
      {o.report && <Text style={{ color: C.muted, fontSize: 12 }}>Pemeriksaan barang: {reportText(o.report)}</Text>}
    </View>
  );
}
