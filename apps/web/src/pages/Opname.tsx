import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OPNAME_REASONS, OPNAME_REASON_LIST } from '@sajadah/shared';
import { ApiError, api, get, post } from '../api';
import { Badge, Block, Btn, Field, Kpi, Kpis, Modal, Table, type Tone } from '../ui';
import { R, useToast } from '../hooks';
import type { CountDetail, CountLine, CountRow, CountStatus } from '../types';

const STATUS: Record<CountStatus, [string, Tone]> = { draft: ['Sedang dihitung', 'warn'], submitted: ['Menunggu pengurus', 'warn'], approved: ['Selesai · stok disesuaikan', 'ok'], cancelled: ['Dibatalkan', 'bad'] };
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const rp = (n: number) => (n < 0 ? `−${R(-n)}` : n > 0 ? `+${R(n)}` : R(0));
const tone = (n: number): Tone => (n < 0 ? 'bad' : n > 0 ? 'warn' : 'ok');

interface Edit { counted: string; reason: string; note: string }
const toEdit = (l: CountLine): Edit => ({ counted: l.countedQty == null ? '' : String(l.countedQty), reason: l.reason ?? '', note: l.note ?? '' });

/** Berita acara opname: unduh CSV (bisa dibuka di Excel). */
function downloadCsv(d: CountDetail) {
  const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['Berita Acara Stok Opname', d.no], ['Toko', d.depotName], ['Status', STATUS[d.status][0]], ['Dibuat oleh', d.createdByName], ['Diajukan oleh', d.submittedByName ?? ''], ['Disetujui oleh', d.approvedByName ?? ''], [],
    ['SKU', 'Produk', 'Stok sistem', 'Hitung fisik', 'Selisih', 'Harga beli', 'Nilai selisih', 'Alasan', 'Catatan'],
    ...d.lines.map((l) => [l.sku, l.name, l.systemQty, l.countedQty ?? '', l.variance ?? '', l.unitCost, l.value ?? '', l.reason ? OPNAME_REASONS[l.reason as keyof typeof OPNAME_REASONS] ?? l.reason : '', l.note ?? '']),
    [], ['Total selisih', d.totals.varianceQty], ['Total nilai selisih (Rp)', d.totals.varianceValue],
  ];
  const blob = new Blob(['﻿' + rows.map((r) => r.map((c) => esc(c as string)).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = `${d.no}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/** Langkah opname dalam bahasa sehari-hari; langkah aktif mengikuti dokumen yang sedang berjalan. */
function Steps({ current, ops }: { current: number; ops: boolean }) {
  const steps = ops
    ? ['Mulai opname', 'Hitung barang di rak lalu isi hasilnya', 'Kirim ke pengurus', 'Pengurus menyetujui, stok disesuaikan']
    : ['Petugas memulai opname', 'Petugas menghitung barang di rak', 'Petugas mengirim hasil', 'Pengurus menyetujui, stok disesuaikan'];
  return (
    <ol style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, margin: 0, padding: '14px 18px', listStyle: 'none', borderBottom: '1px solid var(--line)' }} aria-label="Langkah opname">
      {steps.map((t, i) => (
        <li key={t} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', opacity: i + 1 === current ? 1 : 0.62 }}>
          <span aria-hidden="true" style={{ flex: 'none', width: 26, height: 26, borderRadius: 13, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, background: i + 1 < current ? 'var(--brand)' : i + 1 === current ? 'var(--gold)' : 'var(--ok-bg)', color: i + 1 < current ? '#fff' : 'var(--ink)' }}>{i + 1 < current ? '✓' : i + 1}</span>
          <span style={{ fontSize: 13, lineHeight: 1.35, fontWeight: i + 1 === current ? 600 : 400 }}>{t}{i + 1 === current ? <b style={{ display: 'block', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Anda di sini</b> : null}</span>
        </li>
      ))}
    </ol>
  );
}

/** Bagian "Stok opname" di halaman Persediaan: daftar dokumen + layar hitung/persetujuan. */
export default function OpnameSection({ depotId, depotName, ops }: { depotId: string; depotName: string; ops: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['stock-counts', depotId], queryFn: () => get<CountRow[]>(`/stock-counts?depotId=${depotId}`), enabled: !!depotId });
  const [openId, setOpenId] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [startNote, setStartNote] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = list.data ?? [];
  const running = rows.find((r) => r.status === 'draft' || r.status === 'submitted');
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['stock-counts'] }); void qc.invalidateQueries({ queryKey: [`/products?depotId=${depotId}`] }); void qc.invalidateQueries({ queryKey: ['stock-count'] }); void qc.invalidateQueries(); };

  async function start() {
    setBusy(true);
    try { const r = await post<{ id: string; no: string }>('/stock-counts', { depotId, note: startNote.trim() || undefined }); toast(`${r.no} dimulai`); setStartOpen(false); setStartNote(''); refresh(); setOpenId(r.id); }
    catch (x) { toast(x instanceof ApiError ? x.message : 'Terjadi kesalahan', false); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Block title="Stok opname" note={`Opname = mencocokkan barang yang benar-benar ada di rak ${depotName} dengan catatan sistem. Kalau ada yang beda, stok dikoreksi setelah pengurus menyetujui.`}
        tools={ops && <Btn disabled={!!running} onClick={() => setStartOpen(true)}>{running ? `${running.no} sedang berjalan` : '+ Mulai opname baru'}</Btn>}>
        <Steps ops={ops} current={!running ? 1 : running.status === 'draft' ? 2 : 3} />
        <Table empty={ops ? 'Belum ada opname. Tekan “+ Mulai opname baru” untuk mulai menghitung.' : 'Belum ada opname di toko ini.'} rows={rows} cols={[
          { head: 'No.', mono: true, w: '110px', cell: (r) => r.no },
          { head: 'Status', cell: (r) => <><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>{r.needsAdmin && r.status !== 'cancelled' && r.status !== 'approved' && <> <Badge tone="bad">Di atas toleransi</Badge></>}</> },
          { head: 'Dibuat', cell: (r) => <>{r.createdByName}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(r.createdAt).toLocaleString('id-ID')}</div></> },
          { head: 'Produk sudah dihitung', mono: true, right: true, cell: (r) => `${r.countedCount} dari ${r.lineCount}` },
          { head: 'Beda', mono: true, right: true, cell: (r) => (r.countedCount ? <Badge tone={tone(r.varianceQty)}>{signed(r.varianceQty)}</Badge> : '—') },
          { head: 'Nilai beda', mono: true, right: true, cell: (r) => (r.countedCount ? rp(r.varianceValue) : '—') },
        ]} actions={(r) => <Btn sm kind={r.status === 'draft' || r.status === 'submitted' ? 's' : 'g'} onClick={() => setOpenId(r.id)}>{r.status === 'draft' && ops ? 'Lanjutkan menghitung' : 'Lihat'}</Btn>} />
      </Block>

      <Modal title="Mulai opname baru" open={startOpen} onClose={() => setStartOpen(false)} footer={<>
        <Btn kind="g" onClick={() => setStartOpen(false)}>Batal</Btn>
        <Btn disabled={busy} onClick={() => void start()}>Mulai opname</Btn>
      </>}>
        <p className="note" style={{ margin: 0 }}>Sistem mencatat jumlah stok semua produk di <b>{depotName}</b> saat ini sebagai pembanding. Setelah itu Anda menghitung barang di rak, mengisi hasilnya, lalu mengirimkannya ke pengurus.</p>
        <Field label="Catatan (opsional)" value={startNote} onChange={setStartNote} ph="mis. opname akhir bulan Oktober" />
        <p className="note">Hanya satu opname yang boleh berjalan di satu toko. Penjualan atau kiriman yang terjadi saat Anda menghitung tidak hilang; koreksi dihitung ke stok terbaru saat disetujui.</p>
      </Modal>

      {openId && <CountModal id={openId} ops={ops} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </>
  );
}

interface ViewLine { l: CountLine; e: Edit; valid: boolean; variance: number | null; value: number | null; needReason: boolean; needNote: boolean; belowReserved: boolean }
type Ask = null | 'approve' | 'reject' | 'cancel';

/** Hitung ulang selisih dari isian (sebelum disimpan) agar petugas langsung melihat dampaknya. */
function buildView(d: CountDetail | undefined, edits: Record<string, Edit>, editable: boolean): ViewLine[] {
  return (d?.lines ?? []).map((l) => {
    const e = edits[l.id] ?? toEdit(l);
    const empty = e.counted.trim() === '';
    const counted = empty ? null : Number(e.counted);
    const valid = counted != null && Number.isInteger(counted) && counted >= 0;
    const variance = valid ? counted! - l.systemQty : null;
    return { l, e, valid: empty || valid, variance, value: variance == null ? null : variance * l.unitCost, needReason: editable && variance != null && variance !== 0 && !e.reason, needNote: editable && e.reason === 'lainnya' && !e.note.trim(), belowReserved: editable && valid && counted! < l.reserved };
  });
}

function totalsOf(view: ViewLine[]) {
  const c = view.filter((v) => v.variance != null);
  const sum = (xs: ViewLine[]) => xs.reduce((s, v) => s + v.value!, 0);
  return { counted: c.length, qty: c.reduce((s, v) => s + v.variance!, 0), value: sum(c), gain: sum(c.filter((v) => v.variance! > 0)), loss: sum(c.filter((v) => v.variance! < 0)) };
}

const problemLabel = (p: ViewLine) => (!p.valid ? 'angka tidak valid' : p.belowReserved ? 'kurang dari dipesan' : p.needReason ? 'alasan' : 'catatan');

/** Data dokumen opname, isian hitungan, dan aksi (simpan, kirim, setujui, kembalikan, batalkan). */
function useCountDoc(id: string, ops: boolean, onClose: () => void, onChanged: () => void) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['stock-count', id], queryFn: () => get<CountDetail>(`/stock-counts/${id}`) });
  const d = q.data;
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [askText, setAskText] = useState('');
  useEffect(() => { if (d && !dirty) setEdits(Object.fromEntries(d.lines.map((l) => [l.id, toEdit(l)]))); }, [d, dirty]);
  const editable = !!d && d.status === 'draft' && ops;
  const set = (lineId: string, patch: Partial<Edit>) => { setDirty(true); setEdits((e) => ({ ...e, [lineId]: { ...e[lineId]!, ...patch } })); };
  const view = useMemo(() => buildView(d, edits, editable), [d, edits, editable]);
  const tot = useMemo(() => totalsOf(view), [view]);
  const problems = view.filter((v) => !v.valid || v.needReason || v.needNote || v.belowReserved);
  const body = () => ({ lines: view.map(({ l, e }) => ({ lineId: l.id, countedQty: e.counted.trim() === '' ? null : Number(e.counted), reason: e.reason || null, note: e.note.trim() || null })) });
  const run = async (fn: () => Promise<unknown>, ok: string, close = false) => {
    setBusy(true);
    try { await fn(); toast(ok); setDirty(false); onChanged(); await q.refetch(); if (close) onClose(); }
    catch (x) { toast(x instanceof ApiError ? x.message : 'Terjadi kesalahan', false); }
    finally { setBusy(false); setAsk(null); setAskText(''); }
  };
  return {
    d, editable, canApprove: !!d?.canApprove, set, view, tot, problems, dirty, busy, ask, setAsk, askText, setAskText,
    save: () => run(() => api('PUT', `/stock-counts/${id}/lines`, body()), 'Hitungan disimpan'),
    submit: () => run(async () => { await api('PUT', `/stock-counts/${id}/lines`, body()); await post(`/stock-counts/${id}/submit`); }, 'Diajukan untuk persetujuan'),
    approve: () => run(() => post(`/stock-counts/${id}/approve`), 'Opname disetujui; stok disesuaikan', true),
    reject: () => run(() => post(`/stock-counts/${id}/reject`, { reason: askText.trim() }), 'Dikembalikan untuk hitung ulang', true),
    cancel: () => run(() => post(`/stock-counts/${id}/cancel`, { reason: askText.trim() }), 'Opname dibatalkan', true),
  };
}
type Doc = ReturnType<typeof useCountDoc>;

function CountNotices({ doc, d }: { doc: Doc; d: CountDetail }) {
  return (
    <>
      <p className="note" style={{ margin: 0 }}>
        <Badge tone={STATUS[d.status][1]}>{STATUS[d.status][0]}</Badge>{' '}
        Dibuat {d.createdByName}{d.submittedByName ? ` · diajukan ${d.submittedByName}` : ''}{d.approvedByName ? ` · disetujui ${d.approvedByName}` : ''}{d.note ? ` · ${d.note}` : ''}
      </p>
      {doc.editable && <div className="note" role="note" style={{ margin: 0, padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--ok-bg)' }}><b>Cara mengisi:</b> hitung barang yang benar-benar ada di rak, lalu tulis jumlahnya di kolom <b>Hasil hitung di rak</b>. Sama dengan catatan sistem? Tidak perlu alasan. Beda? Pilih alasannya (rusak, hilang, dan seterusnya). Produk yang belum dihitung boleh dikosongkan. Kalau sudah selesai, tekan <b>Kirim ke pengurus</b>.</div>}
      {d.returnNote && d.status === 'draft' && <p className="note" role="status" style={{ color: 'var(--bad-fg)', margin: 0 }}>Dikembalikan untuk hitung ulang: {d.returnNote}</p>}
      {d.cancelReason && <p className="note" style={{ color: 'var(--bad-fg)', margin: 0 }}>Dibatalkan: {d.cancelReason}</p>}
      {d.needsAdmin && d.status !== 'cancelled' && <p className="note" role="status" style={{ margin: 0 }}><Badge tone="bad">Di atas toleransi</Badge> Selisih melebihi batas ({d.policy.tolerancePct}% per produk / {R(d.policy.toleranceValue)} per dokumen): {d.exceedReason}. {d.status === 'draft' ? 'Setelah diajukan, persetujuan harus oleh pengurus.' : 'Persetujuan harus oleh pengurus.'}</p>}
      {d.status === 'submitted' && !doc.canApprove && <p className="note" style={{ margin: 0 }}>Menunggu persetujuan pengurus.</p>}
    </>
  );
}

function CountKpis({ tot, total }: { tot: ReturnType<typeof totalsOf>; total: number }) {
  return (
    <Kpis>
      <Kpi l="Sudah dihitung" v={`${tot.counted} dari ${total}`} n="produk" />
      <Kpi l="Beda total" v={`${signed(tot.qty)}`} n={rp(tot.value)} tone={tot.qty ? tone(tot.qty) : ''} />
      <Kpi l="Barang kurang" v={rp(tot.loss)} n="nilai harga beli" tone={tot.loss ? 'bad' : ''} />
      <Kpi l="Barang lebih" v={rp(tot.gain)} n="nilai harga beli" tone={tot.gain ? 'warn' : ''} />
    </Kpis>
  );
}

const reasonText = (reason: string | null) => (reason ? OPNAME_REASONS[reason as keyof typeof OPNAME_REASONS] ?? reason : '—');

function CountedCell({ v, editable, onChange }: { v: ViewLine; editable: boolean; onChange: (p: Partial<Edit>) => void }) {
  const { l, e, valid, belowReserved } = v;
  return (
    <td className="r">{editable
      ? <input className={`cell-in${!valid || belowReserved ? ' bad' : ''}`} type="number" min={0} inputMode="numeric" aria-label={`Hitung fisik ${l.name}`} value={e.counted} onChange={(ev) => onChange({ counted: ev.target.value })} />
      : <span className="mono">{l.countedQty ?? '—'}</span>}
      {belowReserved && <div className="sub bad-t">≥ dipesan ({l.reserved})</div>}</td>
  );
}

function ReasonCell({ v, editable, onChange }: { v: ViewLine; editable: boolean; onChange: (p: Partial<Edit>) => void }) {
  const { l, e, variance, needReason } = v;
  if (variance == null || variance === 0) return <td><span className="sub">—</span></td>;
  if (!editable) return <td>{reasonText(l.reason)}</td>;
  return (
    <td>
      <select className={`cell-sel${needReason ? ' bad' : ''}`} aria-label={`Alasan selisih ${l.name}`} value={e.reason} onChange={(ev) => onChange({ reason: ev.target.value })}>
        <option value="">Pilih alasan…</option>{OPNAME_REASON_LIST.map((k) => <option key={k} value={k}>{OPNAME_REASONS[k]}</option>)}
      </select>
    </td>
  );
}

function NoteCell({ v, editable, onChange }: { v: ViewLine; editable: boolean; onChange: (p: Partial<Edit>) => void }) {
  const { l, e, variance, needNote } = v;
  if (variance == null || variance === 0 || !editable) return <td><span className="sub">{l.note ?? ''}</span></td>;
  return <td><input className={`cell-in txt${needNote ? ' bad' : ''}`} aria-label={`Catatan ${l.name}`} placeholder={e.reason === 'lainnya' ? 'wajib dijelaskan' : 'opsional'} value={e.note} onChange={(ev) => onChange({ note: ev.target.value })} /></td>;
}

function CountRowView({ v, status, editable, onChange }: { v: ViewLine; status: CountDetail['status']; editable: boolean; onChange: (p: Partial<Edit>) => void }) {
  const { l, variance, value } = v;
  const moved = l.moved !== 0 && status !== 'approved';
  return (
    <tr className={variance ? (variance < 0 ? 'neg' : 'pos') : ''}>
      <td><b>{l.name}</b><div className="sub">{l.sku}{moved ? <> · <span className="warn-t" title="Stok sistem berubah sejak opname dimulai; selisih dihitung terhadap stok awal dan diterapkan ke stok saat ini.">stok berubah {signed(l.moved)} sejak mulai</span></> : null}</div></td>
      <td className="r mono">{l.systemQty}</td>
      <td className="r mono">{l.reserved || '—'}</td>
      <CountedCell v={v} editable={editable} onChange={onChange} />
      <td className="r mono">{variance == null ? '—' : <Badge tone={tone(variance)}>{signed(variance)}</Badge>}</td>
      <td className="r mono">{value == null || value === 0 ? '—' : rp(value)}</td>
      <ReasonCell v={v} editable={editable} onChange={onChange} />
      <NoteCell v={v} editable={editable} onChange={onChange} />
    </tr>
  );
}

function CountTable({ doc, d }: { doc: Doc; d: CountDetail }) {
  return (
    <div className="opname-wrap">
      <table className="opname">
        <thead><tr><th>Produk</th><th className="r">Catatan sistem</th><th className="r">Sudah dipesan</th><th className="r">Hasil hitung di rak</th><th className="r">Beda</th><th className="r">Nilai beda</th><th>Alasan beda</th><th>Catatan</th></tr></thead>
        <tbody>{doc.view.map((v) => <CountRowView key={v.l.id} v={v} status={d.status} editable={doc.editable} onChange={(p) => doc.set(v.l.id, p)} />)}</tbody>
      </table>
    </div>
  );
}

function CountFooter({ doc, d, onClose }: { doc: Doc; d: CountDetail; onClose: () => void }) {
  const { editable, canApprove, busy } = doc;
  return (
    <>
      <Btn kind="g" onClick={onClose}>Tutup</Btn>
      <Btn kind="g" onClick={() => downloadCsv(d)}>Unduh berita acara (CSV)</Btn>
      {editable && <Btn kind="d" disabled={busy} onClick={() => doc.setAsk('cancel')}>Batalkan opname</Btn>}
      {editable && <Btn kind="s" disabled={busy || !doc.dirty || doc.problems.some((p) => !p.valid)} onClick={() => void doc.save()}>Simpan sementara</Btn>}
      {editable && <Btn disabled={busy || !doc.tot.counted || doc.problems.length > 0} onClick={() => void doc.submit()}>Kirim ke pengurus</Btn>}
      {canApprove && <Btn kind="d" disabled={busy} onClick={() => doc.setAsk('reject')}>Kembalikan untuk hitung ulang…</Btn>}
      {canApprove && <Btn disabled={busy} onClick={() => doc.setAsk('approve')}>Setujui & posting…</Btn>}
    </>
  );
}

function AskFooter({ doc }: { doc: Doc }) {
  const { ask, busy, askText } = doc;
  const short = askText.trim().length < 3;
  return (
    <>
      <Btn kind="g" onClick={() => doc.setAsk(null)}>Batal</Btn>
      {ask === 'approve' && <Btn disabled={busy} onClick={() => void doc.approve()}>Ya, setujui & posting</Btn>}
      {ask === 'reject' && <Btn kind="d" disabled={busy || short} onClick={() => void doc.reject()}>Kembalikan</Btn>}
      {ask === 'cancel' && <Btn kind="d" disabled={busy || short} onClick={() => void doc.cancel()}>Batalkan opname</Btn>}
    </>
  );
}

const askTitle = (ask: Ask, no: string) => (ask === 'approve' ? `Setujui & posting ${no}` : ask === 'reject' ? 'Kembalikan untuk hitung ulang' : 'Batalkan opname');

function AskDialog({ doc, d }: { doc: Doc; d: CountDetail | undefined }) {
  const { ask } = doc;
  return (
    <Modal title={askTitle(ask, d?.no ?? '')} open={!!ask} onClose={() => doc.setAsk(null)} footer={<AskFooter doc={doc} />}>
      {ask === 'approve' && d && (
        <p className="note" style={{ margin: 0 }}>Stok akan disesuaikan sekarang: <b>{signed(d.totals.varianceQty)}</b> (nilai <b>{rp(d.totals.varianceValue)}</b>) pada {d.lines.filter((l) => l.variance).length} produk. Penyesuaian dicatat di kartu stok dan tidak dapat dibatalkan; koreksi berikutnya lewat opname baru.</p>
      )}
      {ask && ask !== 'approve' && <Field label={ask === 'reject' ? 'Alasan (dilihat petugas)' : 'Alasan pembatalan'} value={doc.askText} onChange={doc.setAskText} ph="minimal 3 karakter" />}
    </Modal>
  );
}

function CountModal({ id, ops, onClose, onChanged }: { id: string; ops: boolean; onClose: () => void; onChanged: () => void }) {
  const doc = useCountDoc(id, ops, onClose, onChanged);
  const { d } = doc;
  return (
    <>
      <Modal xl title={d ? `${d.no} · ${d.depotName}` : 'Opname'} open onClose={onClose} footer={d ? <CountFooter doc={doc} d={d} onClose={onClose} /> : null}>
        {d ? (<>
          <CountNotices doc={doc} d={d} />
          <CountKpis tot={doc.tot} total={d.lines.length} />
          <CountTable doc={doc} d={d} />
          {doc.editable && doc.problems.length > 0 && <p className="note" role="status" style={{ color: 'var(--bad-fg)', margin: 0 }}>Lengkapi dulu: {doc.problems.map((p) => `${p.l.name} (${problemLabel(p)})`).join(', ')}.</p>}
          {doc.editable && <p className="note" style={{ margin: 0 }}>Beda = hasil hitung − catatan sistem (minus berarti barang kurang). Nilai beda memakai harga beli saat opname dimulai.</p>}
        </>) : <div className="empty">Memuat…</div>}
      </Modal>
      <AskDialog doc={doc} d={d} />
    </>
  );
}
