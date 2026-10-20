import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../api';
import { Badge, Block, Btn, Field, Fields, Gate, Kpi, Kpis, Modal, PageHead, Segmented, Table } from '../ui';
import { R, useAct, useForm } from '../hooks';
import { useSession } from '../session';
import { SHIPMENT_ISSUES } from '@sajadah/shared';
import { orderLabel, type OrderReport, type OrderRow, type ProductRow } from '../types';

/** Satu pesanan = satu checkout; baris-baris produknya selalu berstatus sama. `o` = baris pertama (dipakai untuk aksi, berlaku untuk seluruh pesanan). */
type Order = OrderRow & { lines: OrderRow[]; sumQty: number; sumTotal: number };
type Kind = 'reject' | 'ship' | 'receive' | 'cancel' | 'report' | 'detail';
type Dlg = { kind: Kind; o: Order } | null;
type Filter = 'todo' | 'all';
type Open = (kind: Kind, o: Order) => void;
type Names = (productId: string) => string;

const muted = { fontSize: 12, color: 'var(--muted)' } as const;
const box = { border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', display: 'grid', gap: 4, fontSize: 14 } as const;
const dash = <span style={{ color: 'var(--muted)' }}>—</span>;
const stamp = (d: string | null) => (d ? new Date(d).toLocaleString('id-ID') : null);
const buyer = (o: OrderRow) => (o.buyerId ? `Anggota${o.buyerName ? ` · ${o.buyerName}` : ''}` : `${o.customerName ?? 'Pelanggan umum'} (pelanggan umum)`);

function groupOrders(rows: OrderRow[]): Order[] {
  const m = new Map<string, OrderRow[]>();
  for (const r of rows) m.set(r.groupId, [...(m.get(r.groupId) ?? []), r]);
  return [...m.values()].map((rs) => {
    const lines = [...rs].sort((x, y) => x.lineNo - y.lineNo);
    return { ...lines[0]!, no: lines[0]!.groupNo, lines, sumQty: lines.reduce((n, l) => n + l.qty, 0), sumTotal: lines.reduce((n, l) => n + l.total, 0) };
  });
}

const needsAction = (o: Order) => o.report?.status === 'open' || ['awaiting_approval', 'paid', 'shipped', 'awaiting_payment'].includes(o.status);

// ---- KPI & tabel --------------------------------------------------------------------------------

function OrderKpis({ os }: { os: Order[] }) {
  const live = os.filter((o) => o.status !== 'cancelled' && o.status !== 'returned');
  const count = (st: string) => live.filter((o) => o.status === st).length;
  const open = os.filter((o) => o.report?.status === 'open').length;
  return (
    <Kpis>
      <Kpi l="Menunggu persetujuan" v={count('awaiting_approval')} n="perlu disetujui petugas" tone={count('awaiting_approval') ? 'bad' : ''} />
      <Kpi l="Menunggu pembayaran" v={count('awaiting_payment')} n="sudah disetujui, saldo belum terpotong" tone="warn" />
      <Kpi l="Lunas, siap dikirim" v={count('paid')} tone={count('paid') ? 'bad' : ''} />
      <Kpi l="Sudah dikirim" v={count('shipped')} n="menunggu cek anggota / konfirmasi" />
      <Kpi l="Laporan anggota" v={open} n="barang tidak sesuai" tone={open ? 'bad' : ''} />
    </Kpis>
  );
}

function ReportBadge({ o }: { o: Order }) {
  if (o.report?.status === 'open') return <div style={{ marginTop: 4 }}><Badge tone="bad">Laporan anggota: barang tidak sesuai</Badge></div>;
  if (o.report?.status === 'resolved') return <div style={muted}>Laporan anggota sudah ditanggapi</div>;
  return o.report?.status === 'ok' ? <div style={muted}>Anggota: barang sesuai</div> : null;
}

function StatusCell({ o }: { o: Order }) {
  return (
    <>
      <Badge tone={orderLabel[o.status][1]}>{orderLabel[o.status][0]}</Badge>
      {o.status === 'cancelled' && o.cancelReason ? <div style={muted}>{o.cancelReason}</div> : null}
      {o.status === 'shipped' && !o.report ? <div style={muted}>Menunggu anggota memeriksa barang (otomatis dianggap diterima), atau konfirmasi sendiri.</div> : null}
      <ReportBadge o={o} />
    </>
  );
}

function ReportButton({ o, staff, open }: { o: Order; staff: boolean; open: Open }) {
  if (!o.report || o.report.status === 'ok') return null;
  const isOpen = o.report.status === 'open';
  return <Btn sm kind={isOpen ? 's' : 'g'} onClick={() => open('report', o)}>{isOpen && staff ? 'Lihat & tanggapi laporan' : 'Lihat laporan'}</Btn>;
}

/** Tombol aksi petugas sesuai status pesanan. */
function StaffActions({ o, open }: { o: Order; open: Open }) {
  const act = useAct();
  const st = o.status;
  return (
    <>
      {st === 'awaiting_approval' && (<>
        <Btn sm onClick={() => act.post(`/orders/${o.id}/approve`, `${o.no} disetujui; saldo anggota terpotong`)}>{`Setujui & potong saldo (${R(o.sumTotal)})`}</Btn>
        <Btn sm kind="d" onClick={() => open('reject', o)}>Tolak…</Btn>
      </>)}
      {st === 'awaiting_payment' && <Btn sm onClick={() => act.post(`/orders/${o.id}/pay-balance`, `${o.no} dibayar dari saldo anggota`)}>Bayar dari saldo</Btn>}
      {st === 'paid' && <Btn sm onClick={() => open('ship', o)}>Kirim…</Btn>}
      {st === 'shipped' && <Btn sm onClick={() => open('receive', o)}>Konfirmasi diterima…</Btn>}
      {(st === 'awaiting_payment' || st === 'paid') && <Btn sm kind="g" onClick={() => open('cancel', o)}>Batalkan…</Btn>}
    </>
  );
}

function OrdersTable({ rows, filter, staff, names, open }: { rows: Order[]; filter: Filter; staff: boolean; names: Names; open: Open }) {
  return (
    <Table empty={filter === 'todo' ? 'Tidak ada pesanan yang perlu ditindaklanjuti.' : 'Belum ada pesanan.'} rows={rows} cols={[
      { head: 'No.', mono: true, cell: (o) => o.no },
      { head: 'Toko', cell: (o) => o.depotName },
      { head: 'Pembeli', cell: (o) => buyer(o) },
      { head: 'Isi pesanan', cell: (o) => o.lines.map((l) => <div key={l.id}>{l.qty} {names(l.productId)}</div>) },
      { head: 'Total', mono: true, right: true, cell: (o) => R(o.sumTotal) },
      { head: 'Status', cell: (o) => <StatusCell o={o} /> },
    ]} onRow={(o) => open('detail', o)} actions={(o) => (<>
      <Btn sm kind="g" onClick={() => open('detail', o)}>Detail</Btn>
      <ReportButton o={o} staff={staff} open={open} />
      {staff && <StaffActions o={o} open={open} />}
    </>)} />
  );
}

// ---- Dialog laporan & detail --------------------------------------------------------------------

function ReportStatusBadge({ r }: { r: OrderReport }) {
  if (r.status === 'open') return <Badge tone="bad">Menunggu tanggapan toko</Badge>;
  return <Badge tone="ok">{r.status === 'resolved' ? 'Sudah ditanggapi' : 'Anggota: semua sesuai'}</Badge>;
}

function ReportBody({ r, canRespond, reason }: { r: OrderReport; canRespond: boolean; reason: ReactNode }) {
  return (
    <>
      <div style={box}>
        <div><b>Dilaporkan</b> {new Date(r.createdAt).toLocaleString('id-ID')} oleh <b>{r.memberName}</b></div>
        <div><b>Catatan anggota:</b> {r.note || <span style={{ color: 'var(--muted)' }}>tidak ada</span>}</div>
        <div><ReportStatusBadge r={r} /></div>
        {r.resolution ? <div><b>Tanggapan toko</b> ({r.resolvedByName}, {r.resolvedAt ? new Date(r.resolvedAt).toLocaleString('id-ID') : '—'}): {r.resolution}</div> : null}
      </div>
      <Table rows={r.lines} cols={[
        { head: 'Produk', cell: (l) => <><b>{l.name}</b><div style={muted}>{l.sku}</div></> },
        { head: 'Dipesan', mono: true, right: true, cell: (l) => l.qtyOrdered },
        { head: 'Diterima baik', mono: true, right: true, cell: (l) => l.qtyReceived },
        { head: 'Selisih', mono: true, right: true, cell: (l) => (l.qtyReceived === l.qtyOrdered ? <Badge tone="ok">sesuai</Badge> : <Badge tone="bad">−{l.qtyOrdered - l.qtyReceived}</Badge>) },
        { head: 'Alasan anggota', cell: (l) => (l.issue ? SHIPMENT_ISSUES[l.issue as keyof typeof SHIPMENT_ISSUES] ?? l.issue : dash) },
        { head: 'Catatan', cell: (l) => l.note ?? dash },
      ]} />
      {canRespond && reason}
    </>
  );
}

function ReportDialog({ o, staff, onClose }: { o: Order; staff: boolean; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ reason: '' });
  const detail = useQuery({ queryKey: ['/orders/report', o.id], queryFn: () => get<OrderReport | null>(`/orders/${o.id}/report`) });
  const r = detail.data;
  const canRespond = staff && r?.status === 'open';
  const body = detail.isLoading ? <div className="empty">Memuat…</div> : r ? <ReportBody r={r} canRespond={!!canRespond} reason={<Field {...f.bind('reason', 'Tanggapan untuk anggota', 'mis. barang pengganti dikirim besok')} focus />} /> : <p className="note">Belum ada laporan.</p>;
  return (
    <Modal xl title={`Laporan anggota — ${o.no}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Tutup</Btn>
      {canRespond && <Btn disabled={act.busy || f.v.reason.trim().length < 3} onClick={() => act.post(`/orders/${o.id}/report/resolve`, 'Laporan ditanggapi dan ditandai selesai', { note: f.v.reason.trim() }, onClose)}>Tanggapi & selesaikan</Btn>}
    </>}>
      {body}
    </Modal>
  );
}

const paidText = (o: Order) => (o.pay === 'balance' ? 'Lunas, dipotong dari saldo belanja anggota penjual' : o.pay === 'cash' ? 'Lunas, tunai (dicatat di kas koperasi)' : 'Belum dibayar');

function journeySteps(o: Order): { l: string; done: boolean; sub: string | null }[] {
  return [
    { l: 'Dipesan', done: true, sub: stamp(o.createdAt) },
    { l: 'Disetujui toko', done: !!o.approvedAt, sub: o.approvedAt ? `${stamp(o.approvedAt)}${o.approvedBy ? ` · ${o.approvedBy}` : ''}` : null },
    { l: 'Dibayar', done: o.pay !== 'unpaid', sub: o.pay === 'unpaid' ? null : paidText(o) },
    { l: 'Dikirim', done: o.shipped, sub: o.shipped ? `Surat jalan ${o.deliveryRef ?? '—'}` : null },
    { l: 'Diterima', done: o.received, sub: o.received ? `${stamp(o.receivedAt) ?? ''} · ${o.receiverName ?? '—'} (${o.proofRef ?? '—'})` : null },
  ];
}

function Journey({ o }: { o: Order }) {
  return (
    <ol style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, margin: 0, padding: 0, listStyle: 'none' }} aria-label="Perjalanan pesanan">
      {journeySteps(o).map((st) => (
        <li key={st.l} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', opacity: st.done ? 1 : 0.5 }}>
          <span aria-hidden="true" style={{ flex: 'none', width: 22, height: 22, borderRadius: 11, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: st.done ? 'var(--brand)' : 'var(--ok-bg)', color: st.done ? '#fff' : 'var(--ink)' }}>{st.done ? '✓' : '·'}</span>
          <span style={{ fontSize: 13, lineHeight: 1.35 }}><b>{st.l}</b>{st.sub ? <span style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>{st.sub}</span> : null}</span>
        </li>
      ))}
    </ol>
  );
}

const COMMISSION_TEXT: Record<string, string> = { pending: 'menunggu persetujuan', approved: 'disetujui, belum dibayar', paid: 'sudah dibayar' };

function checkText(o: Order): string {
  if (!o.report) return o.shipped ? 'belum diperiksa' : '—';
  if (o.report.status === 'ok') return 'barang sesuai';
  return o.report.status === 'open' ? 'ada laporan tidak sesuai, menunggu tanggapan toko' : `laporan sudah ditanggapi: ${o.report.resolution ?? ''}`;
}

function OrderSummary({ o, staff }: { o: Order; staff: boolean }) {
  const showCommission = !staff && o.commission && !o.buyerId;
  return (
    <div style={box}>
      <div><b>Total</b> {R(o.sumTotal)} · {paidText(o)}</div>
      <div><b>Pembeli</b> {buyer(o)}{o.customerPhone ? ` · ${o.customerPhone}` : ''}</div>
      <div><b>Penjual / pemesan</b> {o.sellerName ?? 'anggota'}</div>
      {showCommission ? <div><b>Komisi</b> {COMMISSION_TEXT[o.commission!] ?? 'dibatalkan'}</div> : null}
      <div><b>Pemeriksaan anggota</b> {checkText(o)}</div>
    </div>
  );
}

function CancelNote({ o }: { o: Order }) {
  if (o.status !== 'cancelled' && o.status !== 'returned') return null;
  return <p className="note" style={{ margin: 0, color: 'var(--bad-fg)' }}>{o.status === 'cancelled' ? `Dibatalkan: ${o.cancelReason ?? '—'}` : 'Pesanan ini sudah diretur (data lama).'}</p>;
}

function DetailDialog({ o, staff, names, open, onClose }: { o: Order; staff: boolean; names: Names; open: Open; onClose: () => void }) {
  const showReport = !!o.report && o.report.status !== 'ok';
  const reportLabel = o.report?.status === 'open' && staff ? 'Lihat & tanggapi laporan anggota' : 'Lihat laporan anggota';
  return (
    <Modal xl title={`Detail pesanan ${o.no}`} open onClose={onClose} footer={<>
      {showReport && <Btn kind="s" onClick={() => open('report', o)}>{reportLabel}</Btn>}
      <Btn onClick={onClose}>Tutup</Btn>
    </>}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge tone={orderLabel[o.status][1]}>{orderLabel[o.status][0]}</Badge>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{o.depotName} · {o.lines.length} produk · {o.sumQty}</span>
      </div>
      <CancelNote o={o} />
      <Journey o={o} />
      <Table rows={o.lines} cols={[
        { head: 'Produk', cell: (l) => <b>{names(l.productId)}</b> },
        { head: 'Jumlah', mono: true, right: true, cell: (l) => `${l.qty}` },
        { head: 'Harga satuan', mono: true, right: true, cell: (l) => R(l.price) },
        { head: 'Subtotal', mono: true, right: true, cell: (l) => R(l.total) },
      ]} />
      <OrderSummary o={o} staff={staff} />
    </Modal>
  );
}

// ---- Dialog tindakan ----------------------------------------------------------------------------

function RejectDialog({ o, onClose }: { o: Order; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ reason: '' });
  return (
    <Modal title={`Tolak ${o.no}`} open onClose={onClose} footer={<><Btn kind="g" onClick={onClose}>Kembali</Btn><Btn kind="d" disabled={act.busy || !f.v.reason.trim()} onClick={() => act.post(`/orders/${o.id}/reject`, `${o.no} ditolak`, { reason: f.v.reason.trim() }, onClose)}>Tolak pesanan</Btn></>}>
      <Field {...f.bind('reason', 'Alasan (dilihat anggota)', 'mis. stok sedang habis')} focus />
    </Modal>
  );
}

function ShipDialog({ o, names, onClose }: { o: Order; names: Names; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ delivery: `SJ-${o.no}` });
  return (
    <Modal title={`Kirim ${o.no}`} open onClose={onClose} footer={<><Btn kind="g" onClick={onClose}>Batal</Btn><Btn disabled={act.busy || !f.v.delivery.trim()} onClick={() => act.post(`/orders/${o.id}/ship`, `${o.no} dikirim`, { deliveryRef: f.v.delivery.trim() }, onClose)}>Tandai dikirim</Btn></>}>
      <p className="note" style={{ margin: 0 }}>{`${o.lines.map((l) => `${l.qty} ${names(l.productId)}`).join(', ')} untuk ${buyer(o)}. Stok toko berkurang saat dikirim.`}</p>
      <Fields><Field {...f.bind('delivery', 'Nomor surat jalan')} focus /></Fields>
    </Modal>
  );
}

function ReceiveDialog({ o, onClose }: { o: Order; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ proof: `BKT-${o.no}`, receiver: o.customerName ?? '' });
  const body = { proofRef: f.v.proof.trim(), receiverName: f.v.receiver.trim() };
  return (
    <Modal title={`Konfirmasi diterima ${o.no}`} open onClose={onClose} footer={<><Btn kind="g" onClick={onClose}>Batal</Btn><Btn disabled={act.busy || !body.proofRef || !body.receiverName} onClick={() => act.post(`/orders/${o.id}/receive`, `${o.no} diterima pembeli`, body, onClose)}>Konfirmasi diterima</Btn></>}>
      <p className="note" style={{ margin: 0 }}>Konfirmasi hanya setelah pembeli benar-benar menerima barang. Penerimaan membuka komisi penjual.</p>
      <Fields><Field {...f.bind('proof', 'Nomor bukti terima')} focus /><Field {...f.bind('receiver', 'Nama penerima', 'nama pembeli')} /></Fields>
    </Modal>
  );
}

function CancelDialog({ o, onClose }: { o: Order; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ reason: '' });
  return (
    <Modal title={`Batalkan ${o.no}`} open onClose={onClose} footer={<><Btn kind="g" onClick={onClose}>Kembali</Btn><Btn kind="d" disabled={act.busy || !f.v.reason.trim()} onClick={() => act.post(`/orders/${o.id}/cancel`, `${o.no} dibatalkan`, { reason: f.v.reason.trim() }, onClose)}>Batalkan pesanan</Btn></>}>
      <Field {...f.bind('reason', 'Alasan pembatalan', 'mis. pembeli membatalkan')} focus />
    </Modal>
  );
}

function Dialogs({ dlg, staff, names, open, close }: { dlg: Dlg; staff: boolean; names: Names; open: Open; close: () => void }) {
  if (!dlg) return null;
  const { kind, o } = dlg;
  switch (kind) {
    case 'report': return <ReportDialog o={o} staff={staff} onClose={close} />;
    case 'detail': return <DetailDialog o={o} staff={staff} names={names} open={open} onClose={close} />;
    case 'reject': return <RejectDialog o={o} onClose={close} />;
    case 'ship': return <ShipDialog o={o} names={names} onClose={close} />;
    case 'receive': return <ReceiveDialog o={o} onClose={close} />;
    case 'cancel': return <CancelDialog o={o} onClose={close} />;
  }
}

const DESC_STAFF = 'Pesanan dari anggota dan pelanggan untuk toko Anda. Mulai dari “Menunggu persetujuan”: setujui dulu. Saat disetujui, saldo belanja anggota otomatis terpotong sebesar total pesanan (juga untuk penjualan ke pelanggan, yang membayar tunai langsung ke anggota). Lalu kirim dan konfirmasi diterima. Halaman ini diperbarui otomatis.';
const DESC_ADMIN = 'Semua pesanan koperasi (hanya baca). Petugas toko yang memproses pesanan.';

/** Pesanan toko: petugas menyetujui, menerima pembayaran dari saldo, mengirim, dan mengonfirmasi penerimaan. Pengurus melihat semuanya dan mencatat bayar tunai. */
export default function OrdersPage() {
  const { me } = useSession();
  const staff = me?.role === 'staff';
  // Pesanan baru dari aplikasi anggota harus muncul sendiri: muat ulang berkala.
  const ord = useQuery({ queryKey: ['/orders'], queryFn: () => get<OrderRow[]>('/orders'), refetchInterval: 15_000 });
  const prods = useQuery({ queryKey: ['/products'], queryFn: () => get<ProductRow[]>('/products') });
  const [filter, setFilter] = useState<Filter>('todo');
  const [dlg, setDlg] = useState<Dlg>(null);
  const os = groupOrders(ord.data ?? []);
  const names: Names = (id) => prods.data?.find((p) => p.id === id)?.name ?? '—';
  const rows = filter === 'todo' ? os.filter(needsAction) : os;
  const open: Open = (kind, o) => setDlg({ kind, o });
  return (
    <>
      <PageHead title="Pesanan" desc={staff ? DESC_STAFF : DESC_ADMIN} />
      <div className="page">
        <Gate q={ord}>
          <OrderKpis os={os} />
          <div style={{ maxWidth: 420 }}><Segmented label="Tampilkan" value={filter} onChange={setFilter} options={[{ value: 'todo', label: 'Perlu tindakan' }, { value: 'all', label: 'Semua pesanan' }]} /></div>
          <Block title={filter === 'todo' ? 'Perlu tindakan' : 'Semua pesanan'} note={filter === 'todo' ? 'Pesanan yang menunggu langkah berikutnya dari Anda.' : 'Terbaru di atas.'}>
            <OrdersTable rows={rows} filter={filter} staff={staff} names={names} open={open} />
          </Block>
        </Gate>
      </div>
      <Dialogs key={dlg ? `${dlg.kind}-${dlg.o.id}` : 'none'} dlg={dlg} staff={staff} names={names} open={open} close={() => setDlg(null)} />
    </>
  );
}
