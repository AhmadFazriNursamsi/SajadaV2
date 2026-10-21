import { MLM_ENABLED } from '../features';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FAMILY_CODES, FAMILY_CODE_LIST, INITIAL_BUDGET, PARTICIPATION_TOTAL, SHOPPING_BALANCE } from '@sajadah/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post as apiPost } from '../api';
import { Badge, Block, Btn, Combobox, Field, Gate, Kpi, Kpis, Modal, PageHead, ReadOnlyField, Table } from '../ui';
import { R, useAct, useData, useForm, useToast } from '../hooks';
import type { Funding, MemberRow, RegionRow } from '../types';
import { useSession } from '../session';

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso?: string | null) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const BUDGET_LABEL: Record<keyof typeof INITIAL_BUDGET, string> = { hpAndroid: 'HP Android', mandatoryDues: 'Iuran wajib', firstMonthlyDues: 'Iuran bulanan pertama', costume: 'Kostum komunitas', application: 'Aplikasi' };

/** Bagi PARTICIPATION_TOTAL menurut porsi investor; sisa pembulatan masuk ke investor terakhir agar total tepat. */
function defaultSplit(inv: Funding['investors']): Record<string, string> {
  const out: Record<string, string> = {};
  let left = PARTICIPATION_TOTAL;
  inv.forEach((i, idx) => {
    const v = idx === inv.length - 1 ? left : Math.round((PARTICIPATION_TOTAL * i.sharePercent) / 100);
    out[i.id] = String(v); left -= v;
  });
  return out;
}

function downloadCsv(name: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

type Cred = { name: string; username: string; password: string };
type MemberDlg = { kind: 'edit' | 'off' | 'reset' | 'fund' | 'act'; m: MemberRow } | { kind: 'add' } | null;
const errText = (x: unknown) => (x instanceof ApiError ? x.message : 'Terjadi kesalahan');
const muted = <span style={{ color: 'var(--muted)' }}>belum ada</span>;
const familyLabel = (code: string) => `${code} · ${FAMILY_CODES[code as keyof typeof FAMILY_CODES]}`;
const familyOptions = FAMILY_CODE_LIST.map((c) => ({ value: c, label: familyLabel(c) }));

// ---- Akun login (sandi acak ditampilkan sekali) ----------------------------------------------

function useAccountOps(onCred: (c: Cred) => void, onDone: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run(m: MemberRow, path: 'account' | 'account/reset') {
    setBusy(true);
    try { const r = await apiPost<{ username: string; password: string }>(`/members/${m.id}/${path}`); onDone(); onCred({ name: m.name, ...r }); void qc.invalidateQueries(); }
    catch (x) { toast(errText(x), false); }
    finally { setBusy(false); }
  }
  return { busy, run };
}

function CredDialog({ cred, onClose }: { cred: Cred; onClose: () => void }) {
  const toast = useToast();
  const copy = async () => { try { await navigator.clipboard.writeText(`Username: ${cred.username}\nKata sandi: ${cred.password}`); toast('Disalin'); } catch { toast('Tidak dapat menyalin; salin manual', false); } };
  return (
    <Modal title={`Akun login — ${cred.name}`} open onClose={onClose} footer={<><Btn kind="g" onClick={() => void copy()}>Salin</Btn><Btn onClick={onClose}>Selesai</Btn></>}>
      <ReadOnlyField label="Username" value={cred.username} />
      <ReadOnlyField label="Kata sandi sementara" value={cred.password} hint="Hanya ditampilkan sekali ini. Serahkan ke anggota; ia wajib menggantinya saat pertama masuk." />
    </Modal>
  );
}

function ResetDialog({ m, busy, onConfirm, onClose }: { m: MemberRow; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title="Reset kata sandi" open onClose={onClose} footer={<><Btn kind="g" onClick={onClose}>Batal</Btn><Btn disabled={busy} onClick={onConfirm}>Buat kata sandi baru</Btn></>}>
      <p className="note">Kata sandi lama <b>{m.name}</b> tidak berlaku lagi. Kata sandi baru dibuat acak dan wajib diganti saat anggota masuk.</p>
    </Modal>
  );
}

// ---- Dialog ubah / nonaktifkan -------------------------------------------------------------------

function EditDialog({ m, onClose }: { m: MemberRow; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ name: m.name, code: m.familyCode ?? 'I' });
  const unchanged = f.v.name.trim() === m.name && f.v.code === m.familyCode;
  return (
    <Modal title={`Ubah data — ${m.name}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || !f.v.name.trim() || unchanged} onClick={() => act.run('PATCH', `/members/${m.id}`, 'Data anggota diperbarui', { name: f.v.name.trim(), familyCode: f.v.code }, onClose)}>Simpan perubahan</Btn>
    </>}>
      <ReadOnlyField label="No. anggota" value={m.memberNo ?? '—'} hint="Nomor yang sudah terbit tidak berubah." />
      <Field {...f.bind('name', 'Nama')} />
      <Combobox label="Status keluarga" value={f.v.code} onChange={(v) => f.set('code', v)} options={familyOptions} />
    </Modal>
  );
}

function OffDialog({ m, onClose }: { m: MemberRow; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ reason: '' });
  return (
    <Modal title={`Nonaktifkan anggota — ${m.name}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn kind="d" disabled={act.busy || f.v.reason.trim().length < 5} onClick={() => act.post(`/members/${m.id}/deactivate`, `${m.name} dinonaktifkan`, { reason: f.v.reason.trim() }, onClose)}>Nonaktifkan anggota</Btn>
    </>}>
      <Field {...f.bind('reason', 'Alasan (dicatat di log)', 'mis. mengundurkan diri')} />
      <p className="note">Anggota tidak bisa lagi masuk, memesan, menjual, atau mengajak anggota baru. <b>Riwayat transaksi tetap tersimpan</b> (tidak dihapus). Ditolak bila masih ada pesanan yang belum selesai.</p>
      {m.balance > 0 && <p className="note" style={{ color: 'var(--bad-fg)' }}>Saldo belanja tersisa {R(m.balance)} tidak dikembalikan otomatis; selesaikan di luar sistem sesuai kebijakan koperasi.</p>}
    </Modal>
  );
}

// ---- Dialog tambah anggota -----------------------------------------------------------------------

function SponsorNote({ refNorm, sponsor }: { refNorm: string; sponsor: { data?: { name: string }; isError: boolean } }) {
  return (
    <>
      {refNorm.length > 0 && refNorm.length < 8 && <p className="note">Kode referal terdiri dari 8 huruf/angka.</p>}
      {sponsor.data && <p className="note">Diajak oleh <b>{sponsor.data.name}</b>: ia menjadi sponsor dan mendapat bonus dari penjualan anggota ini.</p>}
      {sponsor.isError && <p className="note" style={{ color: 'var(--bad-fg)' }}>Kode referal tidak ditemukan.</p>}
    </>
  );
}

function AddDialog({ admin, regions, onClose, onCred }: { admin: boolean; regions: RegionRow[]; onClose: () => void; onCred: (c: Cred) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const add = useForm({ name: '', village: '', code: 'I', referral: '' });
  const [addAccount, setAddAccount] = useState(true);
  const villageOpts = regions.filter((r) => r.level === 'village').map((r) => ({ value: r.id, label: r.path.join(', ') })).sort((a, b) => a.label.localeCompare(b.label));
  const refNorm = add.v.referral.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sponsorQ = useQuery({ queryKey: ['referral', refNorm], queryFn: () => get<{ name: string; code: string }>(`/members/referral/${refNorm}`), enabled: refNorm.length === 8, retry: false });
  const preview = useQuery({ queryKey: ['next-number', add.v.village], queryFn: () => get<{ memberNo: string }>(`/members/next-number?villageId=${add.v.village}`), enabled: !!add.v.village });
  const previewText = add.v.village ? (preview.data?.memberNo ?? (preview.isError ? '' : 'Menghitung…')) : '';

  async function save() {
    setBusy(true);
    try {
      const r = await apiPost<{ name: string; memberNo: string; account: { username: string; password: string } | null }>('/members', { name: add.v.name.trim(), villageId: add.v.village, familyCode: add.v.code, createAccount: admin && addAccount, referralCode: add.v.referral.trim() || undefined });
      toast(`Anggota ditambahkan: ${r.name}`);
      onClose();
      if (r.account) onCred({ name: r.name, ...r.account });
      void qc.invalidateQueries();
    } catch (x) { toast(errText(x), false); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="Tambah anggota" open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={busy || !add.v.name.trim() || !add.v.village || (refNorm.length > 0 && !sponsorQ.data)} onClick={() => void save()}>Simpan anggota</Btn>
    </>}>
      <ReadOnlyField label="No. anggota" value={previewText} placeholder="Terisi otomatis setelah daerah dipilih" hint="Diterbitkan otomatis saat disimpan (kode provinsi, kabupaten, kecamatan, tahun, urutan)." />
      <Field {...add.bind('name', 'Nama')} />
      <Combobox label="Daerah (dari Struktur daerah)" value={add.v.village} onChange={(v) => add.set('village', v)} options={villageOpts} placeholder="Pilih kelurahan / desa…" emptyText="Belum ada kelurahan/desa" />
      {villageOpts.length === 0 && <p className="note">Belum ada kelurahan/desa. Tambahkan dulu di <Link to="/wilayah" onClick={onClose}>Struktur daerah</Link>.</p>}
      {MLM_ENABLED && <><Field {...add.bind('referral', 'Kode referal (opsional)', 'XXXX-XXXX')} /><SponsorNote refNorm={refNorm} sponsor={sponsorQ} /></>}
      <Combobox label="Status keluarga" value={add.v.code} onChange={(v) => add.set('code', v)} options={familyOptions} />
      {admin && <label className="check"><input type="checkbox" checked={addAccount} onChange={(e) => setAddAccount(e.target.checked)} /> Buat akun login (username dari nama, kata sandi acak)</label>}
    </Modal>
  );
}

// ---- Modal awal & aktivasi saldo -----------------------------------------------------------------

function FundDialog({ m, invs, fundedCount, onClose }: { m: MemberRow; invs: Funding['investors']; fundedCount: number; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ ref: `FUND-${String(fundedCount + 1).padStart(3, '0')}`, date: today() });
  const [alloc, setAlloc] = useState<Record<string, string>>(() => defaultSplit(invs));
  const total = invs.reduce((s, i) => s + (Number(alloc[i.id]) || 0), 0);
  const exact = total === PARTICIPATION_TOTAL;
  const body = { ref: f.v.ref.trim(), date: f.v.date, allocations: invs.map((i) => ({ investorId: i.id, amount: Number(alloc[i.id]) || 0 })).filter((x) => x.amount > 0) };
  return (
    <Modal wide title={`Catat modal awal — ${m.name}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || !exact || !body.ref || invs.length === 0} onClick={() => act.post(`/members/${m.id}/funding`, `Modal awal dicatat: ${m.name}`, body, onClose)}>Simpan modal awal</Btn>
    </>}>
      <p className="note">Modal awal {R(PARTICIPATION_TOTAL)} untuk anggota ini berasal dari investor. Bagi jumlahnya ke tiap investor; totalnya harus tepat {R(PARTICIPATION_TOTAL)}.</p>
      <div className="row2">
        <Field label="Referensi pendanaan" value={f.v.ref} onChange={(v) => f.set('ref', v)} hint="Nomor bukti/kesepakatan." />
        <Field label="Tanggal pendanaan" type="date" value={f.v.date} onChange={(v) => f.set('date', v)} />
      </div>
      {invs.length === 0
        ? <p className="note" role="alert">Data investor sedang dimuat. Tutup dialog ini lalu buka lagi; bila tetap kosong, periksa di <Link to="/investor" onClick={onClose}>Dashboard investor</Link>.</p>
        : <>
            {invs.map((i) => <Field key={i.id} label={`Dari ${i.name} (porsi acuan ${i.sharePercent}%) — Rp`} type="number" value={alloc[i.id] ?? ''} onChange={(v) => setAlloc((s) => ({ ...s, [i.id]: v }))} />)}
            <div className="alloc-total">Total dialokasikan <Badge tone={exact ? 'ok' : 'bad'}>{R(total)}</Badge>{!exact && <span> — kurang/lebih {R(Math.abs(PARTICIPATION_TOTAL - total))} dari {R(PARTICIPATION_TOTAL)}</span>}</div>
          </>}
    </Modal>
  );
}

function ActivateDialog({ m, activeCount, onClose }: { m: MemberRow; activeCount: number; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ ref: `AKT-${String(activeCount + 1).padStart(3, '0')}`, date: today() < (m.fundedAt ?? '') ? (m.fundedAt as string) : today() });
  return (
    <Modal wide title={`Aktifkan saldo belanja — ${m.name}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || !f.v.ref.trim()} onClick={() => act.post(`/members/${m.id}/activation`, `Saldo belanja aktif: ${m.name}`, { ref: f.v.ref.trim(), date: f.v.date }, onClose)}>Aktifkan saldo {R(SHOPPING_BALANCE)}</Btn>
    </>}>
      <p className="note">Saldo belanja {R(SHOPPING_BALANCE)} langsung aktif dan hanya bisa dipakai untuk membayar pesanan di koperasi. Anggaran awal {R(PARTICIPATION_TOTAL - SHOPPING_BALANCE)} hanya dicatat (bukan transfer atau penyerahan barang):</p>
      <ul className="budget">
        {(Object.keys(INITIAL_BUDGET) as (keyof typeof INITIAL_BUDGET)[]).map((k) => <li key={k}><span>{BUDGET_LABEL[k]}</span><b className="mono">{R(INITIAL_BUDGET[k])}</b></li>)}
      </ul>
      <div className="row2">
        <Field label="Referensi aktivasi" value={f.v.ref} onChange={(v) => f.set('ref', v)} />
        <Field label="Tanggal aktivasi" type="date" value={f.v.date} onChange={(v) => f.set('date', v)} hint={m.fundedAt ? `Tidak boleh sebelum ${fmtDate(m.fundedAt)} (tanggal pendanaan).` : undefined} />
      </div>
    </Modal>
  );
}

// ---- Daftar anggota ------------------------------------------------------------------------------

interface RowActions { admin: boolean; canOps: boolean; credBusy: boolean; onEdit: (m: MemberRow) => void; onOff: (m: MemberRow) => void; onReset: (m: MemberRow) => void; onCreate: (m: MemberRow) => void; onPlace: () => void }

function NumberButton({ m, a }: { m: MemberRow; a: RowActions }) {
  const act = useAct();
  if (!a.canOps || m.memberNo) return null;
  return m.placed
    ? <Btn sm kind="s" onClick={() => act.post(`/members/${m.id}/member-number`, 'Nomor anggota diterbitkan')}>Terbitkan nomor</Btn>
    : <Btn sm kind="g" onClick={a.onPlace}>Tempatkan di Struktur daerah</Btn>;
}

function AdminButtons({ m, a }: { m: MemberRow; a: RowActions }) {
  const act = useAct();
  if (!a.admin) return null;
  return (
    <>
      <Btn sm kind="g" onClick={() => a.onEdit(m)}>Ubah…</Btn>
      {m.deactivatedAt
        ? <Btn sm kind="g" onClick={() => act.post(`/members/${m.id}/reactivate`, `${m.name} diaktifkan kembali`)}>Aktifkan kembali</Btn>
        : <Btn sm kind="d" onClick={() => a.onOff(m)}>Nonaktifkan…</Btn>}
      {m.username ? <Btn sm kind="g" onClick={() => a.onReset(m)}>Reset sandi…</Btn> : <Btn sm kind="g" disabled={a.credBusy} onClick={() => a.onCreate(m)}>Buat akun</Btn>}
    </>
  );
}

function MemberTable({ rows, a }: { rows: MemberRow[]; a: RowActions }) {
  return (
    <Table rows={rows} cols={[
      { head: 'No. anggota', mono: true, cell: (m) => m.memberNo ?? <span style={{ color: 'var(--muted)' }}>belum ada</span> },
      { head: 'Nama', cell: (m) => <>{m.name}{m.deactivatedAt && <> <Badge tone="bad">Nonaktif</Badge></>}</> },
      { head: 'Status keluarga', cell: (m) => (m.familyCode ? familyLabel(m.familyCode) : <Badge tone="bad">Belum diisi</Badge>) },
      { head: 'Daerah', cell: (m) => (m.regionPath ? <span title={m.regionPath}>{m.regionPath.split(', ').slice(0, 2).join(', ')}</span> : <Badge tone="warn">Belum ditempatkan</Badge>) },
      { head: 'Akun login', cell: (m) => (m.username ? <><code>{m.username}</code>{m.resetRequestedAt && <> <Badge tone="warn">Minta reset sandi</Badge></>}</> : muted) },
    ]} actions={(m) => <><AdminButtons m={m} a={a} /><NumberButton m={m} a={a} /></>} />
  );
}

// ---- Penyertaan modal & saldo -------------------------------------------------------------------

function FundingKpis({ ms, fundedCount, activeCount }: { ms: MemberRow[]; fundedCount: number; activeCount: number }) {
  const waiting = ms.filter((m) => m.funded && !m.active).length;
  return (
    <Kpis>
      <Kpi l="Total saldo belanja" v={R(ms.reduce((a, m) => a + (m.active ? m.balance : 0), 0))} n={`${activeCount} anggota aktif`} tone="ok" />
      <Kpi l="Penyertaan tercatat" v={`${fundedCount} anggota`} n={`dari ${ms.length} anggota`} />
      <Kpi l="Menunggu aktivasi" v={`${waiting} anggota`} n="modal awal sudah dicatat" tone={waiting ? 'warn' : ''} />
      <Kpi l="Belum ada penyertaan" v={`${ms.filter((m) => !m.funded).length} anggota`} />
    </Kpis>
  );
}

const balanceNote = (m: MemberRow) => (m.active ? `aktif sejak ${fmtDate(m.activatedAt)}` : m.funded ? 'siap diaktifkan' : 'belum ada penyertaan');

function FundStep({ m, info }: { m: MemberRow; info: Funding['members'][number] | undefined }) {
  const detail = info?.perInvestor.length ? ' · ' + info.perInvestor.map((p) => `${p.code} ${R(p.amount)}`).join(', ') : '';
  return <span className={`step ${m.funded ? 'ok' : 'todo'}`}><i>{m.funded ? '✓' : '1'}</i><span><b>Modal awal</b>{m.funded ? `Tercatat ${fmtDate(m.fundedAt)}${detail}` : 'Belum dicatat'}</span></span>;
}

function ActiveStep({ m }: { m: MemberRow }) {
  const state = m.active ? 'ok' : m.funded ? 'todo' : 'lock';
  const text = m.active ? `Aktif · ${m.activationRef ?? ''}` : m.funded ? 'Belum diaktifkan' : 'Menunggu langkah 1';
  return <span className={`step ${state}`}><i>{m.active ? '✓' : '2'}</i><span><b>Saldo belanja</b>{text}</span></span>;
}

function FundingRow({ m, info, admin, onFund, onActivate }: { m: MemberRow; info: Funding['members'][number] | undefined; admin: boolean; onFund: () => void; onActivate: () => void }) {
  return (
    <li className="prow srow">
      <div className="pmain"><b>{m.name}{m.deactivatedAt && <> <Badge tone="bad">Nonaktif</Badge></>}</b><span>{m.memberNo ?? 'belum bernomor'}</span></div>
      <div className="bal" title="Saldo belanja anggota saat ini (hanya untuk belanja di koperasi)">
        <span>Saldo belanja</span>
        <b>{m.active ? R(m.balance) : '—'}</b>
        <small>{balanceNote(m)}</small>
      </div>
      <div className="steps"><FundStep m={m} info={info} /><ActiveStep m={m} /></div>
      {admin && !m.funded && <Btn sm kind="s" onClick={onFund}>1. Catat modal awal…</Btn>}
      {admin && m.funded && !m.active && <Btn sm kind="s" onClick={onActivate}>2. Aktifkan saldo…</Btn>}
    </li>
  );
}

function FundingSection({ ms, fund, admin, open }: { ms: MemberRow[]; fund: { isLoading: boolean; error: unknown; data: Funding | undefined }; admin: boolean; open: (d: MemberDlg) => void }) {
  const info = new Map((fund.data?.members ?? []).map((x) => [x.id, x]));
  const fundedCount = ms.filter((m) => m.funded).length, activeCount = ms.filter((m) => m.active).length;
  return (
    <Block title="Penyertaan modal & saldo belanja" note={`Setiap anggota menyetor modal awal ${R(PARTICIPATION_TOTAL)}. ${R(SHOPPING_BALANCE)} menjadi saldo belanja (hanya untuk belanja di koperasi, tidak bisa ditarik), sisanya ${R(PARTICIPATION_TOTAL - SHOPPING_BALANCE)} untuk keperluan awal. Ada dua langkah: (1) catat dari investor mana dana berasal, lalu (2) aktifkan saldo belanja.`}>
      <Gate q={fund}>
        <FundingKpis ms={ms} fundedCount={fundedCount} activeCount={activeCount} />
        <ul className="plist">
          {ms.map((m) => <FundingRow key={m.id} m={m} info={info.get(m.id)} admin={admin} onFund={() => open({ kind: 'fund', m })} onActivate={() => open({ kind: 'act', m })} />)}
        </ul>
        {!admin && <div className="empty">Hanya pengurus yang dapat mencatat modal awal dan mengaktifkan saldo belanja.</div>}
      </Gate>
    </Block>
  );
}

function exportNumbers(ms: MemberRow[], toast: (m: string, ok?: boolean) => void) {
  const rows = ms.filter((m) => m.memberNo);
  if (!rows.length) return toast('Belum ada nomor anggota yang terbit.', false);
  downloadCsv('nomor-anggota.csv', [['No. anggota', 'Nama', 'Status keluarga', 'Daerah', 'Penempatan'], ...rows.map((m) => [m.memberNo!, m.name, m.familyCode ? familyLabel(m.familyCode) : '', m.area, m.regionPath ?? ''])]);
}

function MemberDialogs({ dlg, setDlg, ms, invs, regions, admin, cred, setCred, resetOps }: { dlg: MemberDlg; setDlg: (d: MemberDlg) => void; ms: MemberRow[]; invs: Funding['investors']; regions: RegionRow[]; admin: boolean; cred: Cred | null; setCred: (c: Cred | null) => void; resetOps: ReturnType<typeof useAccountOps> }) {
  const close = () => setDlg(null);
  return (
    <>
      {dlg?.kind === 'add' && <AddDialog admin={admin} regions={regions} onClose={close} onCred={setCred} />}
      {dlg?.kind === 'edit' && <EditDialog m={dlg.m} onClose={close} />}
      {dlg?.kind === 'off' && <OffDialog m={dlg.m} onClose={close} />}
      {dlg?.kind === 'reset' && <ResetDialog m={dlg.m} busy={resetOps.busy} onConfirm={() => void resetOps.run((dlg as { m: MemberRow }).m, 'account/reset')} onClose={close} />}
      {dlg?.kind === 'fund' && <FundDialog m={dlg.m} invs={invs} fundedCount={ms.filter((m) => m.funded).length} onClose={close} />}
      {dlg?.kind === 'act' && <ActivateDialog m={dlg.m} activeCount={ms.filter((m) => m.active).length} onClose={close} />}
      {cred && <CredDialog cred={cred} onClose={() => setCred(null)} />}
    </>
  );
}

export default function MembersPage() {
  const q = useData<MemberRow[]>('/members');
  const fund = useData<Funding>('/investors/funding');
  const regs = useData<RegionRow[]>('/regions');
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useSession();
  const [dlg, setDlg] = useState<MemberDlg>(null);
  const [cred, setCred] = useState<Cred | null>(null);
  const ops = useAccountOps(setCred, () => setDlg(null));
  const ms = q.data ?? [];
  const admin = me?.role === 'tenant_admin';
  const canOps = admin || me?.role === 'staff';
  const actions: RowActions = { admin, canOps, credBusy: ops.busy, onEdit: (m) => setDlg({ kind: 'edit', m }), onOff: (m) => setDlg({ kind: 'off', m }), onReset: (m) => setDlg({ kind: 'reset', m }), onCreate: (m) => void ops.run(m, 'account'), onPlace: () => nav('/wilayah') };
  return (
    <>
      <PageHead title="Anggota koperasi" desc="Data anggota, penyertaan modal awal, dan saldo belanja. Setiap tindakan dicatat di log aktivitas." />
      <div className="page">
        <Gate q={q}>
          <Block title="Daftar anggota" note="Nomor anggota dibuat otomatis saat anggota ditambahkan: kode provinsi, kabupaten, kecamatan, tahun, lalu nomor urut. Nomor yang sudah terbit tidak berubah walau anggota dipindah wilayah." tools={<><Btn kind="g" onClick={() => exportNumbers(ms, toast)}>Ekspor nomor CSV</Btn>{canOps && <Btn onClick={() => setDlg({ kind: 'add' })}>+ Tambah anggota</Btn>}</>}>
            <MemberTable rows={ms} a={actions} />
          </Block>
          <FundingSection ms={ms} fund={fund} admin={admin} open={setDlg} />
        </Gate>
      </div>
      <MemberDialogs dlg={dlg} setDlg={setDlg} ms={ms} invs={fund.data?.investors ?? []} regions={regs.data ?? []} admin={admin} cred={cred} setCred={setCred} resetOps={ops} />
    </>
  );
}
