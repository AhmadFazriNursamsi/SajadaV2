import { useState } from 'react';
import { Badge, Block, Btn, Field, Gate, Kpi, Kpis, Modal, PageHead, ReadOnlyField, Segmented, Table } from '../ui';
import { useAct, useData, useForm } from '../hooks';
import { useQuery } from '@tanstack/react-query';
import { get } from '../api';
import OpnameSection from './Opname';
import { DepotRequests } from './StockRequests';
import CentralStockPage from './CentralStock';
import { SHIPMENT_ISSUES, SHIPMENT_ISSUE_LIST } from '@sajadah/shared';
import type { Movement, ProductRow, ShipmentRow, StockRequestRow } from '../types';
import { useSession } from '../session';
import { useDepot } from '../depot';

type Tab = 'pusat' | 'reqin' | 'ship' | 'stok' | 'minta' | 'opname';
type Dialog = { kind: 'receive' | 'card'; p: ProductRow } | null;
type DepotCtx = ReturnType<typeof useDepot>;
const MOVE: Record<string, string> = { opening: 'Saldo awal', receipt: 'Penerimaan', po_receipt: 'Penerimaan PO', shipment: 'Pengiriman', return: 'Retur (layak jual)', transfer_in: 'Kiriman dari pusat', opname: 'Opname' };
const muted = { fontSize: 12, color: 'var(--muted)' } as const;
const box = { border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', display: 'grid', gap: 4, fontSize: 14 } as const;
const REQ_PREFIX = /^Permintaan REQ-\d+( — )?/;
const cleanNote = (n: string | null) => n?.replace(REQ_PREFIX, '') ?? '';

/** Status stok satu produk di toko: Habis / Menipis (≤ safety stock) / Aman. */
const stockState = (p: ProductRow) => (p.available <= 0 ? ['Habis', 'bad'] as const : p.available <= p.safety ? ['Menipis', 'warn'] as const : ['Aman', 'ok'] as const);

// ---- Pemeriksaan kiriman (petugas) ---------------------------------------------------------------

type Entry = { qty: string; issue: string; note: string };
type ShipLine = ShipmentRow['lines'][number];
interface RecvRow { l: ShipLine; c: Entry; got: number; valid: boolean; diff: number; over: boolean; needIssue: boolean; needNote: boolean }
const blank = (l: ShipLine): Entry => ({ qty: String(l.qty), issue: '', note: '' });

function buildRecvRows(lines: ShipLine[], chk: Record<string, Entry>): RecvRow[] {
  return lines.map((l) => {
    const c = chk[l.productId] ?? blank(l);
    const got = c.qty.trim() === '' ? NaN : Math.floor(Number(c.qty));
    const valid = Number.isInteger(got) && got >= 0 && got <= 1_000_000;
    const diff = valid ? l.qty - got : 0;
    const over = valid && got > l.qty;
    const noteMissing = !c.note.trim();
    return { l, c, got, valid, diff, over, needIssue: diff > 0 && !c.issue, needNote: (diff > 0 && c.issue === 'lainnya' && noteMissing) || (over && noteMissing) };
  });
}

function RecvHeader({ s }: { s: ShipmentRow }) {
  const note = cleanNote(s.note);
  const short = !!s.request?.lines.some((q) => q.qtySent < q.qty);
  return (
    <div style={box}>
      <div><b>Dikirim oleh</b> {s.createdByName} · {new Date(s.createdAt).toLocaleString('id-ID')}</div>
      <div><b>Dari</b> gudang pusat <b>ke</b> {s.depotName} · total <b>{s.totalQty}</b> ({s.lines.length} produk)</div>
      {note ? <div><b>Catatan pengirim:</b> {note}</div> : null}
      {s.request ? <div><b>Menjawab permintaan {s.request.no}</b>{short ? <span style={{ color: 'var(--bad)' }}> · dikirim kurang dari yang Anda minta (lihat kolom Diminta)</span> : ' · sesuai yang Anda minta'}</div> : null}
    </div>
  );
}

function DiffBadge({ r }: { r: RecvRow }) {
  if (!r.valid) return <>—</>;
  if (r.diff > 0) return <Badge tone="bad">−{r.diff}</Badge>;
  return r.over ? <Badge tone="warn">+{r.got - r.l.qty}</Badge> : <Badge tone="ok">sesuai</Badge>;
}

function IssueCell({ r, onChange }: { r: RecvRow; onChange: (p: Partial<Entry>) => void }) {
  if (r.over) return <td><span className="sub">Kelebihan</span></td>;
  if (r.diff <= 0) return <td><span className="sub">—</span></td>;
  return (
    <td>
      <select className={`cell-sel${r.needIssue ? ' bad' : ''}`} aria-label={`Alasan selisih ${r.l.name}`} value={r.c.issue} onChange={(e) => onChange({ issue: e.target.value })}>
        <option value="">Pilih alasan…</option>{SHIPMENT_ISSUE_LIST.map((k) => <option key={k} value={k}>{SHIPMENT_ISSUES[k]}</option>)}
      </select>
    </td>
  );
}

function RecvNoteCell({ r, onChange }: { r: RecvRow; onChange: (p: Partial<Entry>) => void }) {
  if (r.diff === 0 || !r.valid) return <td><span className="sub" /></td>;
  return <td><input className={`cell-in txt${r.needNote ? ' bad' : ''}`} aria-label={`Catatan ${r.l.name}`} placeholder={r.over || r.c.issue === 'lainnya' ? 'wajib dijelaskan' : 'opsional'} value={r.c.note} onChange={(e) => onChange({ note: e.target.value })} /></td>;
}

function RecvRowView({ r, s, onChange }: { r: RecvRow; s: ShipmentRow; onChange: (p: Partial<Entry>) => void }) {
  const { l, c, valid, diff, over } = r;
  return (
    <tr className={diff > 0 ? 'neg' : over ? 'pos' : ''}>
      <td><b>{l.name}</b><div className="sub">{l.sku}</div></td>
      {s.request && <td className="r mono">{s.request.lines.find((q) => q.productId === l.productId)?.qty ?? '—'}</td>}
      <td className="r mono">{l.qty}</td>
      <td className="r"><input className={`cell-in${!valid ? ' bad' : ''}`} type="number" min={0} inputMode="numeric" aria-label={`Diterima ${l.name}`} value={c.qty} onChange={(e) => onChange({ qty: e.target.value })} />{!valid && <div className="sub bad-t">angka ≥ 0</div>}</td>
      <td className="r mono"><DiffBadge r={r} /></td>
      <IssueCell r={r} onChange={onChange} />
      <RecvNoteCell r={r} onChange={onChange} />
    </tr>
  );
}

function RecvSummary({ problem, diff, over, rows, total }: { problem: boolean; diff: number; over: number; rows: RecvRow[]; total: number }) {
  if (problem) return <p className="note" style={{ margin: 0, color: 'var(--bad-fg)' }}>Lengkapi dulu: jumlah diterima (angka 0 atau lebih), alasan untuk setiap kekurangan, dan catatan untuk setiap kelebihan.</p>;
  if (!diff && !over) return <p className="note" style={{ margin: 0 }}>Semua sesuai kiriman. Stok toko bertambah <b>{total}</b>.</p>;
  return <p className="note" style={{ margin: 0 }}>{diff ? <>Kurang <b>{diff}</b>. </> : null}{over ? <>Lebih <b>{over}</b>. </> : null}Stok toko bertambah {rows.reduce((n, r) => n + (r.valid ? r.got : 0), 0)} (sebesar yang diterima), dan pengurus akan melihat selisihnya.</p>;
}

/** Dialog periksa kiriman; dipasang hanya saat terbuka sehingga isian selalu mulai dari jumlah kiriman. */
function ReceiveShipmentDialog({ s, onClose }: { s: ShipmentRow; onClose: () => void }) {
  const act = useAct();
  const [chk, setChk] = useState<Record<string, Entry>>({});
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState('');
  const rows = buildRecvRows(s.lines, chk);
  const problem = rows.some((r) => !r.valid || r.needIssue || r.needNote);
  const diff = rows.reduce((n, r) => n + (r.valid && r.diff > 0 ? r.diff : 0), 0);
  const over = rows.reduce((n, r) => n + (r.over ? r.got - r.l.qty : 0), 0);
  const patch = (l: ShipLine, p: Partial<Entry>) => setChk((m) => ({ ...m, [l.productId]: { ...(m[l.productId] ?? blank(l)), ...p } }));
  const off = !!(diff || over);
  const submit = () => act.post(`/central/shipments/${s.id}/receive`, off ? `${s.no} diterima dengan selisih; dilaporkan ke pengurus` : `${s.no} diterima sesuai kiriman`, { note: note.trim() || undefined, items: rows.map((r) => ({ productId: r.l.productId, qty: r.got, issue: r.diff > 0 ? r.c.issue : undefined, note: r.diff !== 0 ? r.c.note.trim() || undefined : undefined })) }, onClose);
  return (
    <Modal xl title={`Periksa kiriman ${s.no}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || !sure || problem} onClick={submit}>{off ? 'Terima dengan selisih' : 'Terima kiriman'}</Btn>
    </>}>
      <RecvHeader s={s} />
      <p className="note" style={{ margin: 0 }}>Buka kiriman, hitung barang yang benar-benar ada, lalu isi kolom <b>Diterima</b>. Kolom sudah terisi sama dengan yang dikirim; ubah bila ada yang kurang, rusak, atau justru lebih. Kurang: pilih alasannya. Lebih: jelaskan di catatan. Stok toko bertambah sebesar jumlah diterima, dan selisihnya dilaporkan ke pengurus.</p>
      <div className="opname-wrap">
        <table className="opname">
          <thead><tr><th>Produk</th>{s.request && <th className="r">Diminta</th>}<th className="r">Dikirim pusat</th><th className="r">Diterima</th><th className="r">Selisih</th><th>Alasan selisih</th><th>Catatan</th></tr></thead>
          <tbody>{rows.map((r) => <RecvRowView key={r.l.productId} r={r} s={s} onChange={(p) => patch(r.l, p)} />)}</tbody>
        </table>
      </div>
      <Field label="Catatan penerimaan (opsional)" value={note} onChange={setNote} ph="mis. dus penyok, diterima Pak Budi" />
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> Saya sudah memeriksa barang fisik dan jumlah di atas sesuai kenyataan.</label>
      <RecvSummary problem={problem} diff={diff} over={over} rows={rows} total={s.totalQty} />
    </Modal>
  );
}

// ---- Dialog barang masuk & riwayat ---------------------------------------------------------------

function ReceiptDialog({ p, d, onClose }: { p: ProductRow; d: DepotCtx; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ qty: '' });
  const qty = Math.floor(Number(f.v.qty));
  const save = () => act.post(`/products/${p.id}/receipts`, `${qty} ${p.name} tercatat masuk`, { depotId: d.depotId, qty }, onClose);
  return (
    <Modal title={`Barang masuk — ${p.name}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || !(qty >= 1)} onClick={save}>Simpan barang masuk</Btn>
    </>}>
      <ReadOnlyField label="Toko" value={d.depot?.name ?? ''} />
      <ReadOnlyField label="Stok di toko sekarang" value={`${p.physical}`} />
      <Field {...f.bind('qty', 'Jumlah barang masuk')} type="number" onEnter={() => qty >= 1 && save()} />
      <p className="note">{qty >= 1 ? <>Stok di toko menjadi <b>{p.physical + qty}</b>.</> : 'Isi jumlah barang yang diterima di toko ini.'}</p>
    </Modal>
  );
}

function CardDialog({ p, d, onClose }: { p: ProductRow; d: DepotCtx; onClose: () => void }) {
  const card = useQuery({ queryKey: ['card', p.id, d.depotId], queryFn: () => get<Movement[]>(`/products/${p.id}/movements?depotId=${d.depotId}&limit=100`) });
  return (
    <Modal xl title={`Riwayat stok — ${p.name}`} open onClose={onClose} footer={<Btn onClick={onClose}>Tutup</Btn>}>
      <p className="note" style={{ margin: 0 }}>Semua keluar-masuk stok di <b>{d.depot?.name}</b>, terbaru di atas. Saldo sekarang <b>{p.physical}</b>. 100 mutasi terakhir.</p>
      {card.isLoading ? <div className="empty">Memuat…</div> : (
        <Table empty="Belum ada mutasi." rows={card.data ?? []} cols={[
          { head: 'Waktu', mono: true, w: '150px', cell: (m) => new Date(m.at).toLocaleString('id-ID') },
          { head: 'Jenis', cell: (m) => MOVE[m.type] ?? m.type },
          { head: 'Jumlah', mono: true, right: true, cell: (m) => <Badge tone={m.qty < 0 ? 'bad' : 'ok'}>{m.qty > 0 ? `+${m.qty}` : m.qty}</Badge> },
          { head: 'Saldo', mono: true, right: true, cell: (m) => m.balanceAfter },
          { head: 'Referensi', mono: true, cell: (m) => m.refNo ?? '—' },
          { head: 'Keterangan', cell: (m) => m.note ?? '' },
          { head: 'Oleh', cell: (m) => m.actor ?? '—' },
        ]} />
      )}
    </Modal>
  );
}

// ---- Tab Stok toko ------------------------------------------------------------------------------

function StockTable({ ps, ops, low, open }: { ps: ProductRow[]; ops: boolean; low: number; open: (kind: 'receive' | 'card', p: ProductRow) => void }) {
  return (
    <>
      <Table rows={ps} fixed cols={[
        { head: 'Produk', cell: (p) => <><b>{p.name}</b><div style={muted}>{p.sku}{p.active ? '' : ' · nonaktif'}</div></> },
        { head: 'Ada di toko', mono: true, right: true, w: '90px', cell: (p) => p.physical },
        { head: 'Sudah dipesan', mono: true, right: true, w: '100px', cell: (p) => p.reserved },
        { head: 'Bisa dijual', mono: true, right: true, w: '90px', cell: (p) => <b>{p.available}</b> },
        { head: 'Kiriman menuju toko', mono: true, right: true, w: '130px', cell: (p) => (p.inTransit > 0 ? <Badge tone="warn">{p.inTransit}</Badge> : <span style={{ color: 'var(--muted)' }}>—</span>) },
        { head: 'Kondisi', w: '80px', cell: (p) => { const [l, t] = stockState(p); return <Badge tone={t}>{l}</Badge>; } },
      ]} actions={(p) => (<>
        {ops && <Btn sm onClick={() => open('receive', p)}>+ Barang masuk</Btn>}
        <Btn sm kind="g" onClick={() => open('card', p)}>Riwayat stok</Btn>
      </>)} />
      {low > 0 && <p className="note" style={{ margin: 0, padding: '10px 18px 14px' }}>Ada produk yang hampir habis. {ops ? <>Minta ke pusat lewat tab “Minta stok ke pusat”.</> : <>Kirim dari pusat lewat tab “Stok pusat”.</>}</p>}
    </>
  );
}

function IncomingBlock({ d, incoming, ops, onReceive }: { d: DepotCtx; incoming: ShipmentRow[]; ops: boolean; onReceive: (s: ShipmentRow) => void }) {
  return (
    <Block title="Kiriman dari pusat" note={`Kiriman yang sedang menuju ${d.depot?.name ?? 'depot'}. Saat barang tiba, periksa isinya dan cocokkan dengan kiriman. Stok toko bertambah sebesar jumlah yang benar-benar diterima.`}>
      <Table empty="Tidak ada kiriman yang menunggu diterima." rows={incoming} cols={[
        { head: 'No.', mono: true, cell: (x) => x.no },
        { head: 'Dikirim', cell: (x) => <>{new Date(x.createdAt).toLocaleString('id-ID')}<div style={muted}>oleh {x.createdByName}{x.request ? ` · permintaan ${x.request.no}` : ''}</div></> },
        { head: 'Isi kiriman', cell: (x) => <>{x.lines.map((l) => <div key={l.productId}>{l.qty} {l.name}</div>)}{cleanNote(x.note) ? <div style={muted}>{cleanNote(x.note)}</div> : null}</> },
      ]} actions={(x) => ops && <Btn sm onClick={() => onReceive(x)}>Periksa & terima…</Btn>} />
    </Block>
  );
}

function StockTab({ d, ps, incoming, ops, open, onReceive }: { d: DepotCtx; ps: ProductRow[]; incoming: ShipmentRow[]; ops: boolean; open: (kind: 'receive' | 'card', p: ProductRow) => void; onReceive: (s: ShipmentRow) => void }) {
  const sum = (k: 'physical' | 'reserved' | 'available' | 'inTransit') => ps.reduce((a, p) => a + p[k], 0);
  const low = ps.filter((p) => p.active && p.available <= p.safety).length;
  return (
    <>
      <Kpis>
        <Kpi l="Bisa dijual" v={`${sum('available')}`} n="sudah dikurangi yang dipesan" tone="ok" />
        <Kpi l="Ada di toko" v={`${sum('physical')}`} n={d.depot?.name} />
        <Kpi l="Perlu dibeli lagi" v={low} n="produk hampir habis" tone={low ? 'warn' : 'ok'} />
      </Kpis>
      <Block title={`Stok di ${d.depot?.name ?? 'depot'}`} note="Bisa dijual = Ada di toko − Sudah dipesan. “Menipis” berarti sudah mencapai batas aman.">
        <StockTable ps={ps} ops={ops} low={low} open={open} />
      </Block>
      <IncomingBlock d={d} incoming={incoming} ops={ops} onReceive={onReceive} />
    </>
  );
}

// ---- Tab & halaman ------------------------------------------------------------------------------

interface TabDef { value: Tab; label: string; badge?: number; hint: string }

/** Satu menu untuk dua peran. Pengurus: pusat + semua toko (hanya baca di toko). Petugas: tokonya sendiri. */
function tabsFor(admin: boolean, pendingReq: number, shipCount: number): TabDef[] {
  if (admin) {
    return [
      { value: 'pusat', label: 'Stok pusat', hint: 'Stok produk di gudang pusat. Catat barang yang masuk dari pemasok, lalu kirim ke toko yang kekurangan.' },
      { value: 'reqin', label: 'Permintaan toko', badge: pendingReq, hint: 'Petugas toko meminta stok ke pusat. Kirim penuh, kirim sebagian bila stok pusat kurang, atau tolak dengan alasan.' },
      { value: 'ship', label: 'Pengiriman', badge: shipCount, hint: 'Lacak kiriman dari pusat ke toko: belum diterima toko, sudah diterima, atau dibatalkan. Kiriman baru dibuat dengan “+ Kirim ke toko”.' },
      { value: 'stok', label: 'Stok per toko', hint: 'Rincian stok satu toko: ada di toko, sudah dipesan, bisa dijual, kiriman yang sedang menuju toko, dan riwayat stok. Hanya baca.' },
      { value: 'opname', label: 'Stok opname', hint: 'Periksa hasil hitung fisik yang diajukan petugas, lalu setujui atau kembalikan untuk dihitung ulang.' },
    ];
  }
  return [
    { value: 'stok', label: 'Stok toko', hint: 'Lihat jumlah barang di toko, catat barang masuk, terima kiriman dari pusat, dan baca riwayat keluar-masuknya.' },
    { value: 'minta', label: 'Minta stok ke pusat', hint: 'Minta pusat mengirim produk yang habis atau menipis, lalu pantau statusnya.' },
    { value: 'opname', label: 'Stok opname', hint: 'Hitung barang di rak lalu cocokkan dengan catatan. Selisih harus beralasan lalu disetujui pengurus.' },
  ];
}

function TabBar({ tabs, tab, onPick }: { tabs: TabDef[]; tab: Tab; onPick: (t: Tab) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.value} type="button" role="tab" aria-selected={t.value === tab} className={t.value === tab ? 'on' : ''} onClick={() => onPick(t.value)}>{t.label}{!!t.badge && <span className="pill" style={{ marginLeft: 8 }}>{t.badge}</span>}</button>)}
    </div>
  );
}

function DepotPanel({ tab, d, ps, incoming, ops, open, onReceive }: { tab: Tab; d: DepotCtx; ps: ProductRow[]; incoming: ShipmentRow[]; ops: boolean; open: (kind: 'receive' | 'card', p: ProductRow) => void; onReceive: (s: ShipmentRow) => void }) {
  const name = d.depot?.name ?? '';
  return (
    <>
      {tab === 'stok' && <StockTab d={d} ps={ps} incoming={incoming} ops={ops} open={open} onReceive={onReceive} />}
      {tab === 'minta' && d.depotId && <DepotRequests depotId={d.depotId} depotName={name} products={ps} canAct={ops} />}
      {tab === 'opname' && d.depotId && <OpnameSection depotId={d.depotId} depotName={name} ops={ops} />}
    </>
  );
}

/** Tab aktif dan lencananya. Lencana tab pengurus: permintaan toko yang menunggu dan kiriman yang masih di jalan. */
function useInventoryTabs(admin: boolean, view: 'stok' | 'minta' | 'opname' | undefined) {
  const [chosen, setChosen] = useState<Tab | null>(null);
  const reqAll = useData<StockRequestRow[]>('/central/requests', admin);
  const shipOpen = useData<ShipmentRow[]>('/central/shipments?status=in_transit', admin);
  const pendingReq = (reqAll.data ?? []).filter((r) => r.status === 'pending').length;
  const tabs = tabsFor(admin, pendingReq, (shipOpen.data ?? []).length);
  const tab: Tab = admin ? (chosen ?? (pendingReq > 0 ? 'reqin' : 'pusat')) : (view ?? 'stok');
  const tabInfo = tabs.find((t) => t.value === tab) ?? tabs[0]!;
  return { tabs, tab, tabInfo, setChosen, depotTab: tab === 'stok' || tab === 'minta' || tab === 'opname' }; // depotTab: tab yang bekerja pada satu toko
}

function InventoryDialogs({ dlg, recv, d, closeDlg, closeRecv }: { dlg: Dialog; recv: ShipmentRow | null; d: DepotCtx; closeDlg: () => void; closeRecv: () => void }) {
  return (
    <>
      {dlg?.kind === 'receive' && <ReceiptDialog key={dlg.p.id} p={dlg.p} d={d} onClose={closeDlg} />}
      {dlg?.kind === 'card' && <CardDialog key={dlg.p.id} p={dlg.p} d={d} onClose={closeDlg} />}
      {recv && <ReceiveShipmentDialog key={recv.id} s={recv} onClose={closeRecv} />}
    </>
  );
}

/** `view` hanya dipakai petugas: tiap tab menjadi menu sendiri di sidebar. Pengurus memakai tab di halaman ini. */
export default function InventoryPage({ view }: { view?: 'stok' | 'minta' | 'opname' }) {
  const d = useDepot();
  const q = useData<ProductRow[]>(`/products?depotId=${d.depotId}`, d.ready);
  const ship = useData<ShipmentRow[]>(`/central/shipments?status=in_transit&depotId=${d.depotId}`, d.ready);
  const { me } = useSession();
  const [dlg, setDlg] = useState<Dialog>(null);
  const [recv, setRecv] = useState<ShipmentRow | null>(null);
  const admin = me?.role === 'tenant_admin';
  const ops = me?.role === 'staff'; // hanya petugas yang mengubah stok toko; pengurus melihat dan menyetujui opname
  const { tabs, tab, tabInfo, setChosen, depotTab } = useInventoryTabs(admin, view);
  const open = (kind: 'receive' | 'card', p: ProductRow) => setDlg({ kind, p });
  return (
    <>
      <PageHead title={admin ? 'Persediaan' : tabInfo.label} desc={admin ? 'Stok pusat, permintaan dan pengiriman ke toko, serta stok tiap toko. Stok toko hanya dilihat, karena diisi petugas masing-masing toko.' : tabInfo.hint} />
      <div className="page">
        {admin && <TabBar tabs={tabs} tab={tab} onPick={setChosen} />}
        {admin && <p className="note" style={{ margin: 0 }}>{tabInfo.hint}</p>}
        {depotTab && d.depots.length > 1 && <div style={{ maxWidth: 560 }}><Segmented label="Toko" value={d.depotId} onChange={d.setDepotId} options={d.depots.map((x) => ({ value: x.id, label: x.name }))} /></div>}
        {tab === 'pusat' && <CentralStockPage tab="stok" />}
        {tab === 'reqin' && <CentralStockPage tab="minta" />}
        {tab === 'ship' && <CentralStockPage tab="kirim" />}
        {depotTab && <Gate q={d.query.isLoading ? d.query : q}><DepotPanel tab={tab} d={d} ps={q.data ?? []} incoming={ship.data ?? []} ops={ops} open={open} onReceive={setRecv} /></Gate>}
      </div>
      <InventoryDialogs dlg={dlg} recv={recv} d={d} closeDlg={() => setDlg(null)} closeRecv={() => setRecv(null)} />
    </>
  );
}
