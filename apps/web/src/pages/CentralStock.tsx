import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../api';
import { Badge, Block, Btn, Combobox, Field, Fields, Gate, Modal, ReadOnlyField, Table, type Tone } from '../ui';
import { useAct, useData, useForm } from '../hooks';
import { SHIPMENT_ISSUES } from '@sajadah/shared';
import { CentralRequests } from './StockRequests';
import type { CentralRow, DepotRow, Movement, ShipmentRow, ShipmentStatus } from '../types';

const MOVE: Record<string, string> = { opening: 'Saldo awal', receipt: 'Barang masuk', shipment: 'Dikirim ke toko', shipment_cancel: 'Kiriman dibatalkan' };
const STATUS: Record<ShipmentStatus, [string, Tone]> = { in_transit: ['Belum diterima toko', 'warn'], received: ['Sudah diterima toko', 'ok'], cancelled: ['Dibatalkan', 'bad'] };
export type Tab = 'stok' | 'minta' | 'kirim';
type Dialog = { kind: 'in'; p: CentralRow | null } | { kind: 'card'; p: CentralRow } | { kind: 'ship' } | { kind: 'cancel'; s: ShipmentRow } | { kind: 'detail'; s: ShipmentRow } | null;

const muted = { fontSize: 12, color: 'var(--muted)' } as const;
const stamp = (iso: string) => new Date(iso).toLocaleString('id-ID');
const issueText = (issue: string | null) => (issue ? SHIPMENT_ISSUES[issue as keyof typeof SHIPMENT_ISSUES] ?? issue : null);
const signedQty = (n: number) => (n > 0 ? `+${n}` : String(n));

// ---- Tab Stok & Pengiriman ----------------------------------------------------------------------

function StockTools({ open }: { open: (d: Dialog) => void }) {
  return <><Btn kind="g" onClick={() => open({ kind: 'in', p: null })}>+ Barang masuk ke pusat</Btn><Btn onClick={() => open({ kind: 'ship' })}>+ Kirim ke toko</Btn></>;
}

function StockTab({ rows, open }: { rows: CentralRow[]; open: (d: Dialog) => void }) {
  return (
    <Block title="Stok gudang pusat" note="Jumlah yang ada di gudang pusat dan siap dikirim ke toko. Kiriman yang sudah keluar dari pusat dilacak di tab Pengiriman." tools={<StockTools open={open} />}>
      <Table rows={rows} cols={[
        { head: 'Produk', cell: (p) => <><b>{p.name}</b><div style={muted}>{p.sku}{p.active ? '' : ' · nonaktif'}</div></> },
        { head: 'Stok pusat', mono: true, right: true, cell: (p) => <Badge tone={p.central <= 0 ? 'bad' : 'ok'}>{p.central}</Badge> },
        { head: 'Kondisi', cell: (p) => (p.central <= 0 ? <Badge tone="bad">Habis</Badge> : <Badge tone="ok">Ada</Badge>) },
      ]} actions={(p) => (<>
        <Btn sm onClick={() => open({ kind: 'in', p })}>+ Barang masuk</Btn>
        <Btn sm kind="g" onClick={() => open({ kind: 'card', p })}>Riwayat stok</Btn>
      </>)} />
    </Block>
  );
}

function ShipmentLines({ s }: { s: ShipmentRow }) {
  return (
    <>
      {s.lines.map((l) => (
        <div key={l.productId}>
          {l.qtyReceived != null && l.qtyReceived !== l.qty
            ? <>diterima <b>{l.qtyReceived}</b> dari {l.qty} {l.name}<div style={{ fontSize: 12, color: 'var(--bad)' }}>{issueText(l.issue)}{l.issueNote ? ` — ${l.issueNote}` : ''}</div></>
            : <>{l.qty} {l.name}</>}
        </div>
      ))}
      {s.note ? <div style={muted}>{s.note}</div> : null}
    </>
  );
}

function ShipmentStatusCell({ s }: { s: ShipmentRow }) {
  const received = s.status === 'received';
  return (
    <>
      <Badge tone={received && s.hasIssue ? 'bad' : STATUS[s.status][1]}>{received && s.hasIssue ? 'Diterima, ada selisih' : STATUS[s.status][0]}</Badge>
      {received && s.receivedAt ? <div style={muted}>{new Date(s.receivedAt).toLocaleDateString('id-ID')} · {s.receivedByName}</div> : null}
      {received ? <div style={{ fontSize: 12, color: s.hasIssue ? 'var(--bad)' : 'var(--muted)' }}>{s.hasIssue ? 'Petugas melaporkan selisih' : 'Petugas: semua sesuai kiriman'}{s.receiveNote ? ` · “${s.receiveNote}”` : ''}</div> : null}
      {s.status === 'cancelled' ? <div style={muted}>{s.cancelReason}</div> : null}
    </>
  );
}

function ShipmentsTab({ q, rows, open }: { q: { isLoading: boolean; error: unknown; data: unknown }; rows: ShipmentRow[]; open: (d: Dialog) => void }) {
  return (
    <Block title="Pengiriman ke toko" note="100 kiriman terbaru. Kiriman yang belum diterima masih bisa dibatalkan; stoknya kembali ke pusat. Barang yang datang dari pemasok dicatat lewat “+ Barang masuk ke pusat”." tools={<StockTools open={open} />}>
      <Gate q={q}>
        <Table empty="Belum ada pengiriman." rows={rows} cols={[
          { head: 'No.', mono: true, cell: (s) => s.no },
          { head: 'Tanggal', mono: true, cell: (s) => stamp(s.createdAt) },
          { head: 'Toko tujuan', cell: (s) => s.depotName },
          { head: 'Isi kiriman', cell: (s) => <ShipmentLines s={s} /> },
          { head: 'Status', cell: (s) => <ShipmentStatusCell s={s} /> },
        ]} actions={(s) => (<>
          {s.status === 'received' && <Btn sm kind={s.hasIssue ? 's' : 'g'} onClick={() => open({ kind: 'detail', s })}>Detail penerimaan</Btn>}
          {s.status === 'in_transit' && <Btn sm kind="d" onClick={() => open({ kind: 'cancel', s })}>Batalkan…</Btn>}
        </>)} />
      </Gate>
    </Block>
  );
}

// ---- Dialog -------------------------------------------------------------------------------------

function ReceiptDialog({ initial, products, onClose }: { initial: CentralRow | null; products: CentralRow[]; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ qty: '', note: '', productId: initial?.id ?? '' });
  const qty = Math.floor(Number(f.v.qty));
  const product = products.find((p) => p.id === f.v.productId) ?? null;
  const ok = qty >= 1 && !!product;
  return (
    <Modal title="Barang masuk ke gudang pusat" open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || !ok} onClick={() => act.post('/central/receipts', `${qty} ${product!.name} tercatat masuk gudang pusat`, { productId: product!.id, qty, note: f.v.note.trim() || undefined }, onClose)}>Simpan barang masuk</Btn>
    </>}>
      <Combobox label="Produk" value={f.v.productId} onChange={(v) => f.set('productId', v)} options={products.filter((p) => p.active).map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))} placeholder="Pilih produk…" />
      <ReadOnlyField label="Stok pusat sekarang" value={product ? `${product.central}` : '—'} />
      <Fields>
        <Field {...f.bind('qty', 'Jumlah masuk')} type="number" />
        <Field {...f.bind('note', 'Catatan (opsional)', 'mis. dari CV Sumber Prima, faktur 123')} />
      </Fields>
      <p className="note">{ok ? <>Stok pusat {product!.name} menjadi <b>{product!.central + qty}</b>.</> : 'Pilih produk dan isi jumlah barang yang diterima di gudang pusat.'}</p>
    </Modal>
  );
}

type CartLine = { p: CentralRow; q: number };

function ShipNote({ lines, over }: { lines: CartLine[]; over: CartLine | undefined }) {
  const total = lines.reduce((n, l) => n + l.q, 0);
  if (over) return <p className="note"><span style={{ color: 'var(--bad)' }}>Stok pusat {over.p.name} hanya {over.p.central}.</span></p>;
  if (!lines.length) return <p className="note">Isi jumlah pada produk yang ingin dikirim.</p>;
  return <p className="note">Total kirim <b>{total}</b> ({lines.length} produk). Stok pusat langsung berkurang; stok toko bertambah setelah diterima petugas.</p>;
}

function ShipDialog({ products, depots, onClose }: { products: CentralRow[]; depots: DepotRow[]; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ note: '', depotId: depots[0]?.id ?? '' });
  const [cart, setCart] = useState<Record<string, string>>({});
  const active = products.filter((p) => p.active);
  const lines: CartLine[] = products.map((p) => ({ p, q: Math.floor(Number(cart[p.id] ?? '')) || 0 })).filter((l) => l.q > 0);
  const over = lines.find((l) => l.q > l.p.central);
  const ok = !!f.v.depotId && lines.length > 0 && !over;
  const total = lines.reduce((n, l) => n + l.q, 0);
  const submit = () => act.post('/central/shipments', `Kiriman dibuat (${total})`, { depotId: f.v.depotId, note: f.v.note.trim() || undefined, items: lines.map((l) => ({ productId: l.p.id, qty: l.q })) }, onClose);
  return (
    <Modal xl title="Kirim ke toko" open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || !ok} onClick={submit}>Kirim sekarang</Btn>
    </>}>
      <Combobox label="Toko tujuan" value={f.v.depotId} onChange={(v) => f.set('depotId', v)} options={depots.map((d) => ({ value: d.id, label: d.name }))} placeholder="Pilih toko…" />
      <Table rows={active} fixed cols={[
        { head: 'Produk', cell: (p) => <><b>{p.name}</b><div style={muted}>{p.sku}</div></> },
        { head: 'Stok pusat', mono: true, right: true, w: '110px', cell: (p) => p.central },
        { head: 'Kirim', w: '150px', cell: (p) => <input type="number" min={0} aria-label={`Jumlah kirim ${p.name}`} value={cart[p.id] ?? ''} placeholder="0" style={{ width: 110, padding: '6px 8px' }} onChange={(e) => setCart((c) => ({ ...c, [p.id]: e.target.value }))} /> },
      ]} />
      <Field {...f.bind('note', 'Catatan (opsional)', 'mis. kiriman rutin pekan ini')} />
      <ShipNote lines={lines} over={over} />
    </Modal>
  );
}

const diffBadge = (l: ShipmentRow['lines'][number]) => {
  const d = (l.qtyReceived ?? l.qty) - l.qty;
  return d === 0 ? <Badge tone="ok">sesuai</Badge> : <Badge tone={d < 0 ? 'bad' : 'warn'}>{signedQty(d)}</Badge>;
};
const dash = <span style={{ color: 'var(--muted)' }}>—</span>;

function DetailDialog({ s, onClose }: { s: ShipmentRow; onClose: () => void }) {
  const got = s.lines.reduce((n, l) => n + (l.qtyReceived ?? l.qty), 0);
  return (
    <Modal xl title={`Detail penerimaan ${s.no}`} open onClose={onClose} footer={<Btn onClick={onClose}>Tutup</Btn>}>
      <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', display: 'grid', gap: 4, fontSize: 14 }}>
        <div><b>Dikirim</b> {stamp(s.createdAt)} oleh {s.createdByName} ke <b>{s.depotName}</b> · {s.totalQty}{s.request ? ` · menjawab permintaan ${s.request.no}` : ''}</div>
        <div><b>Diperiksa dan diterima</b> {s.receivedAt ? stamp(s.receivedAt) : '—'} oleh <b>{s.receivedByName ?? '—'}</b> (petugas toko) · {got} diterima</div>
        <div><b>Catatan petugas:</b> {s.receiveNote || <span style={{ color: 'var(--muted)' }}>tidak ada</span>}</div>
        <div>{s.hasIssue ? <Badge tone="bad">Ada selisih antara kiriman dan penerimaan</Badge> : <Badge tone="ok">Semua sesuai kiriman</Badge>}</div>
      </div>
      <Table rows={s.lines} cols={[
        { head: 'Produk', cell: (l) => <><b>{l.name}</b><div style={muted}>{l.sku}</div></> },
        { head: 'Dikirim', mono: true, right: true, cell: (l) => l.qty },
        { head: 'Diterima', mono: true, right: true, cell: (l) => l.qtyReceived ?? l.qty },
        { head: 'Selisih', mono: true, right: true, cell: diffBadge },
        { head: 'Alasan petugas', cell: (l) => issueText(l.issue) ?? dash },
        { head: 'Catatan petugas', cell: (l) => l.issueNote ?? dash },
      ]} />
      {s.hasIssue && <p className="note" style={{ margin: 0 }}>Selisih ini belum otomatis mengubah stok pusat. Tindak lanjuti dengan petugas toko bila perlu (mis. cek ulang barang atau koreksi pencatatan).</p>}
    </Modal>
  );
}

function CancelDialog({ s, onClose }: { s: ShipmentRow; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ reason: '' });
  return (
    <Modal title={`Batalkan ${s.no}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Kembali</Btn>
      <Btn kind="d" disabled={act.busy || f.v.reason.trim().length < 5} onClick={() => act.post(`/central/shipments/${s.id}/cancel`, 'Kiriman dibatalkan, stok kembali ke pusat', { reason: f.v.reason.trim() }, onClose)}>Batalkan kiriman</Btn>
    </>}>
      <p className="note" style={{ margin: 0 }}>{s.totalQty} ke {s.depotName} akan kembali ke stok pusat.</p>
      <Field {...f.bind('reason', 'Alasan (tercatat di log)', 'mis. salah toko tujuan')} focus />
    </Modal>
  );
}

function CardDialog({ p, onClose }: { p: CentralRow; onClose: () => void }) {
  const card = useQuery({ queryKey: ['central-card', p.id], queryFn: () => get<Movement[]>(`/central/products/${p.id}/movements?limit=100`) });
  return (
    <Modal xl title={`Riwayat stok pusat — ${p.name}`} open onClose={onClose} footer={<Btn onClick={onClose}>Tutup</Btn>}>
      <p className="note" style={{ margin: 0 }}>Semua keluar-masuk stok gudang pusat, terbaru di atas. Saldo sekarang <b>{p.central}</b>. 100 mutasi terakhir.</p>
      {card.isLoading ? <div className="empty">Memuat…</div> : (
        <Table empty="Belum ada mutasi." rows={card.data ?? []} cols={[
          { head: 'Waktu', mono: true, w: '150px', cell: (m) => stamp(m.at) },
          { head: 'Jenis', cell: (m) => MOVE[m.type] ?? m.type },
          { head: 'Jumlah', mono: true, right: true, cell: (m) => <Badge tone={m.qty < 0 ? 'bad' : 'ok'}>{signedQty(m.qty)}</Badge> },
          { head: 'Saldo', mono: true, right: true, cell: (m) => m.balanceAfter },
          { head: 'Referensi', mono: true, cell: (m) => m.refNo ?? '—' },
          { head: 'Keterangan', cell: (m) => m.note ?? '' },
          { head: 'Oleh', cell: (m) => m.actor ?? '—' },
        ]} />
      )}
    </Modal>
  );
}

function Dialogs({ dlg, close, products, depots }: { dlg: Dialog; close: () => void; products: CentralRow[]; depots: DepotRow[] }) {
  if (!dlg) return null;
  switch (dlg.kind) {
    case 'in': return <ReceiptDialog initial={dlg.p} products={products} onClose={close} />;
    case 'ship': return <ShipDialog products={products} depots={depots} onClose={close} />;
    case 'detail': return <DetailDialog s={dlg.s} onClose={close} />;
    case 'cancel': return <CancelDialog s={dlg.s} onClose={close} />;
    case 'card': return <CardDialog p={dlg.p} onClose={close} />;
  }
}

/** Isi tab pusat pada menu Persediaan (pengurus): stok pusat & kirim, permintaan toko, pengiriman. */
export default function CentralStockPage({ tab }: { tab: Tab }) {
  const stock = useData<CentralRow[]>('/central/stock');
  const ships = useData<ShipmentRow[]>('/central/shipments');
  const depots = useData<DepotRow[]>('/depots');
  const [dlg, setDlg] = useState<Dialog>(null);
  const ps = stock.data ?? [];
  const ds = (depots.data ?? []).filter((d) => d.active);
  return (
    <>
      <div style={{ display: 'contents' }}>
        <Gate q={stock}>
          {tab === 'minta' && <CentralRequests />}
          {tab === 'stok' && <StockTab rows={ps} open={setDlg} />}
          {tab === 'kirim' && <ShipmentsTab q={ships} rows={ships.data ?? []} open={setDlg} />}
        </Gate>
      </div>
      <Dialogs key={dlg ? `${dlg.kind}-${'p' in dlg ? dlg.p?.id : 's' in dlg ? dlg.s.id : ''}` : 'none'} dlg={dlg} close={() => setDlg(null)} products={ps} depots={ds} />
    </>
  );
}
