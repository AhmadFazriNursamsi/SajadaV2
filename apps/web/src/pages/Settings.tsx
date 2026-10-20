import { MLM_ENABLED } from '../features';
import { useState } from 'react';
import { COMMISSION_RATE_MAX, COMMISSION_TOTAL_MAX } from '@sajadah/shared';
import { Badge, Block, Btn, Field, Fields, Gate, Kpi, Kpis, Modal, PageHead, Table } from '../ui';
import { R, useAct, useData, useForm } from '../hooks';
import { ratesText, type PlanNow } from '../rates';
import { useSession } from '../session';

type Tolerance = { tolerancePct: number; toleranceValue: number };
const LV = ['Penjual (atas nama anggota)', 'Sponsor tingkat 1', 'Sponsor tingkat 2', 'Sponsor tingkat 3'];
const stamp = (iso: string) => new Date(iso).toLocaleString('id-ID');

// ---- Konsistensi data ---------------------------------------------------------------------------

function HealthSection() {
  const q = useData<{ ok: boolean; checks: { name: string; ok: boolean }[] }>('/system/consistency');
  const health = useData<{ status: string; db: string; version: string }>('/health');
  const { me } = useSession();
  return (
    <Gate q={q}>
      <Kpis>
        <Kpi l="Pengguna" v={me?.name ?? '—'} n={me?.role} />
        <Kpi l="Basis data" v={health.data?.db ?? '—'} n={`API v${health.data?.version ?? ''}`} />
        <Kpi l="Pemeriksaan" v={q.data?.ok ? 'Konsisten' : 'Ada selisih'} tone={q.data?.ok ? 'ok' : 'bad'} />
      </Kpis>
      <Block title="Pemeriksaan konsistensi data tenant">
        <Table rows={(q.data?.checks ?? []).map((c, i) => ({ id: String(i), ...c }))} cols={[{ head: 'Pemeriksaan', cell: (c) => c.name }, { head: 'Hasil', cell: (c) => <Badge tone={c.ok ? 'ok' : 'bad'}>{c.ok ? 'Lolos' : 'Selisih'}</Badge> }]} />
      </Block>
    </Gate>
  );
}

// ---- Tarif komisi -------------------------------------------------------------------------------

function ratesProblem(nums: number[], filled: boolean, reason: string): string {
  const total = nums.reduce((a, b) => a + b, 0);
  if (!filled) return 'Isi keempat tarif.';
  if (nums.some((n) => n < 0)) return 'Tarif tidak boleh negatif.';
  if (nums.some((n) => n > COMMISSION_RATE_MAX)) return `Tarif per tingkat maksimal ${COMMISSION_RATE_MAX}%.`;
  if (total > COMMISSION_TOTAL_MAX) return `Total tarif maksimal ${COMMISSION_TOTAL_MAX}%.`;
  if (total <= 0) return 'Total tarif harus lebih dari 0%.';
  return reason.trim().length < 5 ? 'Jelaskan alasan perubahan (minimal 5 karakter).' : '';
}

function RatesDialog({ rates, onClose }: { rates: number[]; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ r0: String(rates[0] ?? ''), r1: String(rates[1] ?? ''), r2: String(rates[2] ?? ''), r3: String(rates[3] ?? ''), reason: '' });
  const raw = [f.v.r0, f.v.r1, f.v.r2, f.v.r3];
  const nums = raw.map((x) => Number(x.replace(',', '.')));
  const total = nums.reduce((a, b) => a + b, 0);
  const filled = raw.every((x) => x.trim() !== '') && nums.every((n) => Number.isFinite(n));
  const problem = ratesProblem(nums, filled, f.v.reason);
  return (
    <Modal title="Ubah tarif komisi" open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || !!problem} onClick={() => act.run('PUT', '/commission-plan', 'Tarif komisi diperbarui', { rates: nums, reason: f.v.reason.trim() }, onClose)}>Simpan tarif</Btn>
    </>}>
      <Fields>
        <Field {...f.bind('r0', 'Penjual (%)')} type="number" /><Field {...f.bind('r1', 'Sponsor tingkat 1 (%)')} type="number" />
        <Field {...f.bind('r2', 'Sponsor tingkat 2 (%)')} type="number" /><Field {...f.bind('r3', 'Sponsor tingkat 3 (%)')} type="number" />
      </Fields>
      <Field {...f.bind('reason', 'Alasan perubahan (dicatat)')} />
      <p className="note" role="status">{problem ? <span style={{ color: 'var(--bad-fg)' }}>{problem}</span> : <>Total <b>{+total.toFixed(2)}%</b> dari nilai pesanan. Hanya berlaku untuk pesanan baru.</>}</p>
      <p className="note">Batas wajar: tiap tingkat paling banyak {COMMISSION_RATE_MAX}% dan total paling banyak {COMMISSION_TOTAL_MAX}%. Umumkan perubahan ke anggota sebelum berlaku.</p>
    </Modal>
  );
}

function PlanFooter({ plan }: { plan: PlanNow | undefined }) {
  const rates = plan?.rates ?? [];
  return <p className="note" style={{ margin: 0, padding: '10px 18px 14px' }}>Total {ratesText(rates)} = {+rates.reduce((a, b) => a + b, 0).toFixed(2)}% dari nilai pesanan. Berlaku sejak {plan?.since ? stamp(plan.since) : '—'} · {plan?.reason}{plan?.by ? ` (${plan.by})` : ''}</p>;
}

function CommissionSection({ admin }: { admin: boolean }) {
  const plan = useData<PlanNow>('/commission-plan');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Block title="Tarif komisi" note="Berlaku hanya untuk pesanan yang dibuat setelah perubahan; pesanan lama tetap memakai tarif saat dibuat (seperti rantai sponsornya). Setiap perubahan dicatat dengan alasan." tools={admin && <Btn onClick={() => setOpen(true)}>Ubah tarif…</Btn>}>
        <Gate q={plan}>
          <Table rows={(plan.data?.rates ?? []).map((r, i) => ({ id: String(i), i, r }))} cols={[
            { head: 'Penerima', cell: (x) => LV[x.i] }, { head: 'Tarif', mono: true, right: true, cell: (x) => `${+x.r.toFixed(2)}%` },
          ]} />
          <PlanFooter plan={plan.data} />
        </Gate>
      </Block>
      {open && <RatesDialog rates={plan.data?.rates ?? []} onClose={() => setOpen(false)} />}
    </>
  );
}

function HistorySection() {
  const hist = useData<{ id: string; rates: number[]; reason: string; createdByName: string; createdAt: string }[]>('/commission-plan/history');
  return (
    <Block title="Riwayat perubahan tarif">
      <Table empty="Belum ada perubahan." rows={hist.data ?? []} cols={[
        { head: 'Waktu', mono: true, cell: (h) => stamp(h.createdAt) }, { head: 'Tarif', mono: true, cell: (h) => ratesText(h.rates) + '%' },
        { head: 'Oleh', cell: (h) => h.createdByName }, { head: 'Alasan', cell: (h) => h.reason },
      ]} />
    </Block>
  );
}

// ---- Toleransi opname ---------------------------------------------------------------------------

function toleranceProblem(pct: string, value: string): string {
  const p = Number(pct), v = Number(value.replace(/\D/g, ''));
  if (pct.trim() === '' || !Number.isInteger(p) || p < 0 || p > 100) return 'Persen harus bilangan bulat 0–100.';
  return value.trim() === '' || !Number.isInteger(v) || v < 0 ? 'Isi nilai Rupiah (angka).' : '';
}

function ToleranceDialog({ tol, onClose }: { tol: Tolerance | undefined; onClose: () => void }) {
  const act = useAct();
  const tf = useForm({ pct: String(tol?.tolerancePct ?? 5), value: String(tol?.toleranceValue ?? 500000) });
  const problem = toleranceProblem(tf.v.pct, tf.v.value);
  const body = { tolerancePct: Number(tf.v.pct), toleranceValue: Number(tf.v.value.replace(/\D/g, '')) };
  return (
    <Modal title="Ubah toleransi selisih opname" open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || !!problem} onClick={() => act.run('PUT', '/stock-counts/policy', 'Toleransi opname diperbarui', body, onClose)}>Simpan toleransi</Btn>
    </>}>
      <Fields><Field {...tf.bind('pct', 'Selisih per produk (%)')} type="number" /><Field {...tf.bind('value', 'Nilai selisih per dokumen (Rp)')} type="number" /></Fields>
      <p className="note" role="status">{problem ? <span style={{ color: 'var(--bad-fg)' }}>{problem}</span> : 'Selisih di atas salah satu batas perlu persetujuan pengurus. Perubahan dicatat di log aktivitas.'}</p>
    </Modal>
  );
}

type Company = { name: string; legalName: string | null; address: string | null; npwp: string | null; phone: string | null; signatory: string | null; signatoryTitle: string | null };

function CompanyDialog({ c, onClose }: { c: Company; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ legalName: c.legalName ?? '', address: c.address ?? '', npwp: c.npwp ?? '', phone: c.phone ?? '', signatory: c.signatory ?? '', signatoryTitle: c.signatoryTitle ?? '' });
  const body = Object.fromEntries(Object.entries(f.v).map(([k, v]) => [k, v.trim()]));
  return (
    <Modal title="Profil badan usaha" open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy} onClick={() => act.run('PUT', '/company-profile', 'Profil badan usaha disimpan', body, onClose)}>Simpan</Btn>
    </>}>
      <Fields>
        <Field {...f.bind('legalName', 'Nama badan usaha / koperasi', 'mis. Koperasi Sajadah Digital')} focus />
        <Field {...f.bind('npwp', 'NPWP', '00.000.000.0-000.000')} />
        <Field {...f.bind('phone', 'Telepon', 'mis. 022-1234567')} />
        <Field {...f.bind('address', 'Alamat lengkap')} type="textarea" />
        <Field {...f.bind('signatory', 'Nama penandatangan', 'mis. Ahmad Fauzi')} />
        <Field {...f.bind('signatoryTitle', 'Jabatan penandatangan', 'mis. Ketua Pengurus')} />
      </Fields>
      <p className="note">Data ini tampil di kop dan kolom tanda tangan invoice permintaan stok. Isi sesuai dokumen resmi koperasi.</p>
    </Modal>
  );
}

function CompanySection({ admin }: { admin: boolean }) {
  const q = useData<Company>('/company-profile');
  const [open, setOpen] = useState(false);
  const c = q.data;
  const rows: [string, string | null][] = c ? [['Nama badan usaha', c.legalName], ['NPWP', c.npwp], ['Telepon', c.phone], ['Alamat', c.address], ['Penandatangan', c.signatory ? `${c.signatory}${c.signatoryTitle ? `, ${c.signatoryTitle}` : ''}` : null]] : [];
  return (
    <>
      <Block title="Profil badan usaha (kop invoice)" note="Dipakai pada invoice PDF permintaan stok ke pusat. Yang kosong tampil sebagai “(belum diisi)” di dokumen." tools={admin ? <Btn sm onClick={() => setOpen(true)}>Ubah…</Btn> : undefined}>
        <Gate q={q}>
          <Table rows={rows.map(([k, v]) => ({ id: k, k, v }))} cols={[{ head: 'Data', cell: (x) => x.k }, { head: 'Isi', cell: (x) => x.v ?? <span style={{ color: 'var(--muted)' }}>(belum diisi)</span> }]} />
        </Gate>
      </Block>
      {open && c && <CompanyDialog c={c} onClose={() => setOpen(false)} />}
    </>
  );
}

function ToleranceSection({ admin }: { admin: boolean }) {
  const tol = useData<Tolerance>('/stock-counts/policy');
  const [open, setOpen] = useState(false);
  const rows = [
    { id: 'p', k: 'Selisih per produk', v: `${tol.data?.tolerancePct ?? 0}% dari stok sistem`, n: 'mis. stok sistem 20: selisih lebih dari 1 = di atas toleransi pada 5%' },
    { id: 'v', k: 'Nilai selisih per dokumen', v: R(tol.data?.toleranceValue ?? 0), n: 'jumlah |selisih| × harga beli seluruh produk dalam satu opname' },
  ];
  return (
    <>
      <Block title="Toleransi selisih stok opname" note="Selisih opname yang melebihi batas ini diberi tanda “Di atas toleransi” agar diperiksa teliti sebelum disetujui. Berlaku untuk opname yang diajukan sesudah perubahan." tools={admin && <Btn onClick={() => setOpen(true)}>Ubah toleransi…</Btn>}>
        <Gate q={tol}>
          <Table rows={rows} cols={[{ head: 'Batas', cell: (r) => r.k }, { head: 'Nilai', mono: true, cell: (r) => r.v }, { head: 'Keterangan', cell: (r) => r.n }]} />
        </Gate>
      </Block>
      {open && <ToleranceDialog tol={tol.data} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function SettingsPage() {
  const { me } = useSession();
  const admin = me?.role === 'tenant_admin';
  return (
    <>
      <PageHead title="Pengaturan" desc="Pemeriksaan konsistensi data dan status layanan. Pencadangan basis data dilakukan di level PostgreSQL (pg_dump), bukan dari browser." />
      <div className="page">
        <HealthSection />
        {MLM_ENABLED && <CommissionSection admin={admin} />}
        <CompanySection admin={admin} />
        <ToleranceSection admin={admin} />
        {admin && <HistorySection />}
      </div>
    </>
  );
}
