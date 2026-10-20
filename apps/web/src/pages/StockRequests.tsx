import { useState } from 'react';
import { Badge, Block, Btn, Field, Fields, Gate, Modal, Table, type Tone } from '../ui';
import { useAct, useData, useForm } from '../hooks';
import type { ProductRow, StockRequestRow } from '../types';

const STATUS: Record<StockRequestRow['status'], [string, Tone]> = { pending: ['Menunggu pusat', 'warn'], sent: ['Dikirim', 'ok'], rejected: ['Ditolak', 'bad'], cancelled: ['Dibatalkan', 'bad'] };
/** Buka invoice PDF permintaan di tab baru (sesi login ikut lewat cookie). */
const openInvoice = (id: string) => window.open(`/api/central/requests/${id}/invoice`, '_blank', 'noopener');
const sentLabel = (r: StockRequestRow) => (r.status !== 'sent' ? null : r.totalSent < r.totalQty ? `Dikirim sebagian (${r.totalSent}/${r.totalQty})` : `Dikirim penuh (${r.totalSent})`);

/** Sisi toko: petugas/pengurus meminta stok ke pusat dan memantau statusnya. */
export function DepotRequests({ depotId, depotName, products, canAct }: { depotId: string; depotName: string; products: ProductRow[]; canAct: boolean }) {
  const q = useData<StockRequestRow[]>(`/central/requests?depotId=${depotId}`, !!depotId);
  const act = useAct();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const f = useForm({ note: '' });
  const rows = q.data ?? [];
  const items = products.filter((p) => p.active).map((p) => ({ p, n: Math.floor(Number(qty[p.id] ?? '')) || 0 })).filter((x) => x.n > 0);
  const start = () => {
    // Saran jumlah: target − stok fisik untuk produk yang habis/menipis.
    const sug: Record<string, string> = {};
    for (const p of products) if (p.active && p.available <= p.safety) sug[p.id] = String(Math.max(1, p.target - p.physical - p.inTransit));
    setQty(sug); f.set('note', ''); setOpen(true);
  };
  const waiting = rows.filter((r) => r.status === 'pending');
  return (
    <>
      <Block title={`Permintaan stok ke pusat — ${depotName}`} note={canAct ? 'Minta pusat mengirim produk yang habis atau menipis. Pengurus memproses: bisa dikirim penuh, sebagian, atau ditolak. Kiriman yang dibuat muncul di tab Stok sebagai “Kiriman dari pusat”.' : 'Daftar permintaan toko ini ke pusat (hanya baca). Permintaan dibuat oleh petugas toko; pengurus memprosesnya di menu Stok pusat.'} tools={canAct && <Btn onClick={start}>+ Buat permintaan</Btn>}>
        <Gate q={q}>
          <Table empty="Belum ada permintaan." rows={rows} cols={[
            { head: 'No.', mono: true, cell: (r) => <>{r.no}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.invoiceNo ?? ''}</div></> },
            { head: 'Diajukan', mono: true, cell: (r) => <>{new Date(r.createdAt).toLocaleString('id-ID')}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.createdByName}</div></> },
            { head: 'Isi permintaan', cell: (r) => <>{r.lines.map((l) => <div key={l.productId}>{l.qty} {l.name}{r.status === 'sent' ? <span style={{ color: l.qtySent < l.qty ? 'var(--warn, #9a6a00)' : 'var(--muted)' }}> · dikirim {l.qtySent}</span> : null}</div>)}{r.note ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.note}</div> : null}</> },
            { head: 'Status', cell: (r) => <><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>{sentLabel(r) ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sentLabel(r)} · {r.shipmentNo}</div> : null}{r.status === 'rejected' || (r.status === 'sent' && r.decisionNote) ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.decisionNote}</div> : null}</> },
          ]} actions={(r) => (<>
            <Btn sm kind="g" onClick={() => openInvoice(r.id)}>Invoice PDF</Btn>
            {canAct && r.status === 'pending' && <Btn sm kind="d" onClick={() => { if (window.confirm(`Batalkan permintaan ${r.no}?`)) act.post(`/central/requests/${r.id}/cancel`, `${r.no} dibatalkan`); }}>Batalkan</Btn>}
          </>)} />
          {waiting.length > 0 && <p className="note" style={{ margin: 0, padding: '10px 18px 14px' }}>{waiting.length} permintaan masih menunggu pusat.</p>}
        </Gate>
      </Block>

      <Modal xl title={`Permintaan stok — ${depotName}`} open={open} onClose={() => setOpen(false)} footer={<>
        <Btn kind="g" onClick={() => setOpen(false)}>Batal</Btn>
        <Btn disabled={act.busy || items.length === 0} onClick={() => act.post('/central/requests', `Permintaan dikirim ke pusat (${items.reduce((s, x) => s + x.n, 0)})`, { depotId, note: f.v.note.trim() || undefined, items: items.map((x) => ({ productId: x.p.id, qty: x.n })) }, () => setOpen(false))}>Kirim permintaan</Btn>
      </>}>
        <p className="note" style={{ margin: 0 }}>Isi jumlah pada produk yang dibutuhkan. Produk yang habis atau menipis sudah diisi dengan saran (sampai mencapai target stok); ubah sesuai kebutuhan.</p>
        <Table rows={products.filter((p) => p.active)} fixed cols={[
          { head: 'Produk', cell: (p) => <><b>{p.name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.sku}</div></> },
          { head: 'Ada di toko', mono: true, right: true, w: '110px', cell: (p) => p.physical },
          { head: 'Kondisi', w: '100px', cell: (p) => (p.available <= 0 ? <Badge tone="bad">Habis</Badge> : p.available <= p.safety ? <Badge tone="warn">Menipis</Badge> : <Badge tone="ok">Aman</Badge>) },
          { head: 'Minta', w: '140px', cell: (p) => <input type="number" min={0} aria-label={`Jumlah minta ${p.name}`} value={qty[p.id] ?? ''} placeholder="0" style={{ width: 100, padding: '6px 8px' }} onChange={(e) => setQty((c) => ({ ...c, [p.id]: e.target.value }))} /> },
        ]} />
        <Fields><Field {...f.bind('note', 'Catatan untuk pusat (opsional)', 'mis. stok habis hari ini, mohon dikirim besok')} /></Fields>
        <p className="note">{items.length ? <>Total diminta <b>{items.reduce((s, x) => s + x.n, 0)}</b> ({items.length} produk).</> : 'Isi jumlah minimal pada satu produk.'}</p>
      </Modal>
    </>
  );
}

const muted = { fontSize: 12, color: 'var(--muted)' } as const;
const stamp = (r: StockRequestRow) => new Date(r.createdAt).toLocaleString('id-ID');
const cappedQty = (l: StockRequestRow['lines'][number]) => String(Math.min(l.qty, l.central ?? 0));

function StatusCell({ r }: { r: StockRequestRow }) {
  const sent = sentLabel(r);
  return <><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>{sent ? <div style={muted}>{sent} · {r.shipmentNo}</div> : r.decisionNote ? <div style={muted}>{r.decisionNote}</div> : null}</>;
}

function PendingTable({ rows, onProcess, onReject }: { rows: StockRequestRow[]; onProcess: (r: StockRequestRow) => void; onReject: (r: StockRequestRow) => void }) {
  return (
    <Table empty="Tidak ada permintaan yang menunggu." rows={rows} cols={[
      { head: 'No.', mono: true, cell: (r) => r.no },
      { head: 'Toko', cell: (r) => <><b>{r.depotName}</b><div style={muted}>{r.createdByName} · {stamp(r)}</div></> },
      { head: 'Diminta · stok pusat', cell: (r) => <>{r.lines.map((l) => <div key={l.productId}>{l.qty} {l.name} <span style={{ color: (l.central ?? 0) >= l.qty ? 'var(--muted)' : 'var(--bad)' }}>· pusat {l.central ?? 0}</span></div>)}{r.note ? <div style={muted}>{r.note}</div> : null}</> },
    ]} actions={(r) => (<>
      <Btn sm kind="g" onClick={() => openInvoice(r.id)}>Invoice PDF</Btn>
      <Btn sm onClick={() => onProcess(r)}>Proses…</Btn>
      <Btn sm kind="d" onClick={() => onReject(r)}>Tolak…</Btn>
    </>)} />
  );
}

function HistoryTable({ rows }: { rows: StockRequestRow[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <div style={{ padding: '0 18px 6px' }}><p className="note" style={{ margin: '10px 0 6px' }}>Sudah diproses (10 terbaru)</p></div>
      <Table rows={rows.slice(0, 10)} cols={[
        { head: 'No.', mono: true, cell: (r) => r.no },
        { head: 'Toko', cell: (r) => r.depotName },
        { head: 'Isi', cell: (r) => r.lines.map((l) => `${r.status === 'sent' ? `${l.qtySent}/` : ''}${l.qty} ${l.name}`).join(', ') },
        { head: 'Status', cell: (r) => <StatusCell r={r} /> },
      ]} actions={(r) => <Btn sm kind="g" onClick={() => openInvoice(r.id)}>Invoice PDF</Btn>} />
    </>
  );
}

const qtyInput = { width: 100, padding: '6px 8px' } as const;

function ProcessNote({ bad, total, short, qtyOf }: { bad: StockRequestRow['lines'][number] | undefined; total: number; short: StockRequestRow['lines']; qtyOf: (id: string) => number }) {
  if (bad) return <p className="note"><span style={{ color: 'var(--bad)' }}>{bad.name}: jumlah kirim tidak boleh melebihi yang diminta ({bad.qty}) atau stok pusat ({bad.central ?? 0}).</span></p>;
  if (total < 1) return <p className="note">Isi jumlah kirim minimal pada satu produk, atau tolak permintaan ini.</p>;
  return <p className="note">Total kirim <b>{total}</b>.{short.length ? <> Kurang dari permintaan: {short.map((l) => `${l.name} (${qtyOf(l.productId)}/${l.qty})`).join(', ')}.</> : ' Memenuhi seluruh permintaan.'}</p>;
}

/** Dialog proses permintaan; dipasang hanya saat terbuka sehingga jumlah kirim selalu mulai dari saran. */
function ProcessDialog({ req, onClose }: { req: StockRequestRow; onClose: () => void }) {
  const act = useAct();
  const [send, setSend] = useState<Record<string, string>>(() => Object.fromEntries(req.lines.map((l) => [l.productId, cappedQty(l)])));
  const f = useForm({ note: '' });
  const qtyOf = (id: string) => Math.max(0, Math.floor(Number(send[id] ?? '')) || 0);
  const bad = req.lines.find((l) => qtyOf(l.productId) > l.qty || qtyOf(l.productId) > (l.central ?? 0));
  const total = req.lines.reduce((s, l) => s + qtyOf(l.productId), 0);
  const short = req.lines.filter((l) => qtyOf(l.productId) < l.qty);
  const submit = () => act.post(`/central/requests/${req.id}/fulfill`, `${req.no} diproses, kiriman dibuat (${total})`, { note: f.v.note.trim() || undefined, items: req.lines.map((l) => ({ productId: l.productId, qty: qtyOf(l.productId) })) }, onClose);
  return (
    <Modal xl title={`Proses ${req.no} — ${req.depotName}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || total < 1 || !!bad} onClick={submit}>Kirim sekarang</Btn>
    </>}>
      <p className="note" style={{ margin: 0 }}>Jumlah kirim sudah diisi sebesar yang diminta atau sebesar stok pusat bila kurang. Ubah bila perlu; 0 berarti produk itu tidak dikirim.</p>
      <Table rows={req.lines} fixed cols={[
        { head: 'Produk', cell: (l) => <><b>{l.name}</b><div style={muted}>{l.sku}</div></> },
        { head: 'Diminta', mono: true, right: true, w: '90px', cell: (l) => l.qty },
        { head: 'Stok pusat', mono: true, right: true, w: '100px', cell: (l) => l.central ?? 0 },
        { head: 'Kirim', w: '140px', cell: (l) => <input type="number" min={0} aria-label={`Jumlah kirim ${l.name}`} value={send[l.productId] ?? ''} style={qtyInput} onChange={(e) => setSend((c) => ({ ...c, [l.productId]: e.target.value }))} /> },
      ]} />
      <Fields><Field {...f.bind('note', 'Catatan untuk toko (opsional)', 'mis. sisanya menunggu barang masuk')} /></Fields>
      <ProcessNote bad={bad} total={total} short={short} qtyOf={qtyOf} />
    </Modal>
  );
}

function RejectDialog({ req, onClose }: { req: StockRequestRow; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ reason: '' });
  return (
    <Modal title={`Tolak ${req.no}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Kembali</Btn>
      <Btn kind="d" disabled={act.busy || f.v.reason.trim().length < 5} onClick={() => act.post(`/central/requests/${req.id}/reject`, `${req.no} ditolak`, { reason: f.v.reason.trim() }, onClose)}>Tolak permintaan</Btn>
    </>}>
      <Field {...f.bind('reason', 'Alasan (dilihat petugas)', 'mis. stok pusat habis, tunggu PO')} focus />
    </Modal>
  );
}

/** Sisi pusat (pengurus): permintaan masuk dari toko; kirim penuh/sebagian atau tolak. */
export function CentralRequests() {
  const q = useData<StockRequestRow[]>('/central/requests');
  const [proc, setProc] = useState<StockRequestRow | null>(null);
  const [rej, setRej] = useState<StockRequestRow | null>(null);
  const rows = q.data ?? [];
  return (
    <>
      <Block title="Menunggu diproses" note="Tekan Proses untuk mengirim (penuh atau sebagian). Kiriman yang dibuat tampil di tab Pengiriman.">
        <Gate q={q}>
          <PendingTable rows={rows.filter((r) => r.status === 'pending')} onProcess={setProc} onReject={setRej} />
          <HistoryTable rows={rows.filter((r) => r.status !== 'pending')} />
        </Gate>
      </Block>
      {proc && <ProcessDialog key={proc.id} req={proc} onClose={() => setProc(null)} />}
      {rej && <RejectDialog key={rej.id} req={rej} onClose={() => setRej(null)} />}
    </>
  );
}
