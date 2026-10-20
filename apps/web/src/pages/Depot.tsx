import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api, post } from '../api';
import { useSession } from '../session';
import { Badge, Block, Btn, Field, Fields, Gate, Modal, PageHead, ReadOnlyField, Table } from '../ui';
import { useAct, useData, useForm, useToast } from '../hooks';
import type { DepotRow, StaffRow } from '../types';

type Cred = { depot: string; username: string; password: string };
const errText = (x: unknown) => (x instanceof ApiError ? x.message : 'Terjadi kesalahan');
const muted = { fontSize: 12, color: 'var(--muted)' } as const;

// ---- Toko ------------------------------------------------------------------------------------

const coordText = (n: number | null | undefined) => (n == null ? '' : String(n));
const coordOf = (v: string) => (v.trim() === '' ? null : Number(v));
const initialDepotForm = (d: DepotRow | null) => ({ name: d?.name ?? '', address: d?.address ?? '', lat: coordText(d?.lat), lng: coordText(d?.lng) });

function DepotDialog({ edit, onClose }: { edit: DepotRow | 'new'; onClose: () => void }) {
  const act = useAct();
  const d = edit === 'new' ? null : edit;
  const f = useForm(initialDepotForm(d));
  const half = (f.v.lat.trim() === '') !== (f.v.lng.trim() === '');
  const badNum = Number.isNaN(Number(f.v.lat || 0)) || Number.isNaN(Number(f.v.lng || 0));
  const body = { name: f.v.name.trim(), address: f.v.address.trim() || undefined, lat: coordOf(f.v.lat), lng: coordOf(f.v.lng) };
  const save = () => (d ? act.run('PATCH', `/depots/${d.id}`, 'Toko diperbarui', body, onClose) : act.post('/depots', `Toko ditambahkan: ${f.v.name}`, body, onClose));
  return (
    <Modal title={d ? `Ubah toko — ${d.name}` : 'Tambah toko'} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || f.v.name.trim().length < 2 || half || badNum} onClick={save}>Simpan toko</Btn>
    </>}>
      <Field {...f.bind('name', 'Nama toko', 'mis. Toko Kota Bandung')} />
      <Field {...f.bind('address', 'Alamat (opsional)')} />
      <Fields>
        <Field {...f.bind('lat', 'Lintang (latitude)', '-6.9218')} />
        <Field {...f.bind('lng', 'Bujur (longitude)', '107.6071')} />
      </Fields>
      <p className="note">{half ? 'Isi lintang dan bujur sekaligus, atau kosongkan keduanya. ' : ''}Koordinat dipakai aplikasi anggota untuk menandai toko terdekat. Salin dari Google Maps: klik kanan di lokasi toko, lalu pilih angka koordinat.</p>
      {!d && <p className="note">Stok awal toko kosong. Catat penerimaan barang di menu Persediaan setelah memilih toko ini.</p>}
    </Modal>
  );
}

function DepotTable({ rows, admin, onEdit }: { rows: DepotRow[]; admin: boolean; onEdit: (d: DepotRow) => void }) {
  const act = useAct();
  return (
    <Table rows={rows} cols={[
      { head: 'Toko', cell: (d) => <><b>{d.name}</b>{d.address ? <div style={muted}>{d.address}</div> : null}</> },
      { head: 'Lokasi', mono: true, cell: (d) => (d.lat != null && d.lng != null ? `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}` : <Badge tone="warn">Belum diisi</Badge>) },
      { head: 'Stok fisik', mono: true, cell: (d) => `${d.physical}` },
      { head: 'Status', cell: (d) => <Badge tone={d.active ? 'ok' : 'bad'}>{d.active ? 'Aktif' : 'Nonaktif'}</Badge> },
    ]} actions={(d) => admin && (<>
      <Btn sm kind="g" onClick={() => onEdit(d)}>Ubah…</Btn>
      <Btn sm kind="g" onClick={() => act.run('PATCH', `/depots/${d.id}`, `Toko ${d.name} ${d.active ? 'dinonaktifkan' : 'diaktifkan'}`, { active: !d.active })}>{d.active ? 'Nonaktifkan' : 'Aktifkan'}</Btn>
    </>)} />
  );
}

// ---- Petugas toko ----------------------------------------------------------------------------

function StaffDialog({ sm, depots, onClose, onCred }: { sm: StaffRow | 'new'; depots: DepotRow[]; onClose: () => void; onCred: (c: Cred) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const st = sm === 'new' ? null : sm;
  const sf = useForm({ name: st?.name ?? '', depotId: st?.depotId ?? '' });
  const options = [{ value: '', label: 'Pilih toko…' }, ...depots.filter((d) => d.active || d.id === st?.depotId).map((d) => ({ value: d.id, label: d.name }))];

  async function save() {
    setBusy(true);
    try {
      if (st) {
        await api('PATCH', `/depots/staff/${st.id}`, { name: sf.v.name.trim(), depotId: sf.v.depotId });
        toast('Petugas diperbarui');
      } else {
        const r = await post<{ username: string; password: string }>(`/depots/${sf.v.depotId}/staff`, { name: sf.v.name.trim() });
        onCred({ depot: depots.find((d) => d.id === sf.v.depotId)?.name ?? '', ...r });
      }
      onClose(); void qc.invalidateQueries();
    } catch (x) { toast(errText(x), false); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={st ? `Ubah petugas — ${st.name}` : 'Tambah petugas toko'} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={busy || sf.v.name.trim().length < 2 || !sf.v.depotId} onClick={() => void save()}>{st ? 'Simpan' : 'Buat akun'}</Btn>
    </>}>
      <Field {...sf.bind('name', 'Nama petugas')} />
      <Field {...sf.bind('depotId', 'Toko')} options={options} />
      {!st && <p className="note">Username diambil dari nama dan kata sandi dibuat acak. Petugas wajib menggantinya saat masuk pertama kali.</p>}
    </Modal>
  );
}

function DeleteStaffDialog({ st, onClose }: { st: StaffRow; onClose: () => void }) {
  const act = useAct();
  return (
    <Modal title={`Hapus petugas — ${st.name}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn kind="d" disabled={act.busy} onClick={() => act.run('DELETE', `/depots/staff/${st.id}`, 'Akun petugas dihapus', undefined, onClose)}>Hapus akun</Btn>
    </>}>
      <p>Akun <b>{st.username}</b> akan dihapus dan petugas langsung tidak bisa masuk. Riwayat pekerjaannya tetap tersimpan.</p>
    </Modal>
  );
}

function CredDialog({ cred, onClose }: { cred: Cred; onClose: () => void }) {
  const toast = useToast();
  const copy = async () => { try { await navigator.clipboard.writeText(`Username: ${cred.username}\nKata sandi: ${cred.password}`); toast('Disalin'); } catch { toast('Tidak dapat menyalin; salin manual', false); } };
  return (
    <Modal title={`Kata sandi petugas — ${cred.depot}`} open onClose={onClose} footer={<><Btn kind="g" onClick={() => void copy()}>Salin</Btn><Btn onClick={onClose}>Selesai</Btn></>}>
      <ReadOnlyField label="Username" value={cred.username} />
      <ReadOnlyField label="Kata sandi sementara" value={cred.password} hint="Hanya ditampilkan sekali ini. Serahkan ke petugas; ia wajib menggantinya saat pertama masuk." />
    </Modal>
  );
}

const passwordBadge = (r: StaffRow) => (r.resetRequestedAt ? <Badge tone="warn">Minta atur ulang</Badge> : r.mustChangePassword ? <Badge tone="warn">Belum diganti</Badge> : <Badge tone="ok">Sudah diganti</Badge>);

function StaffTable({ rows, admin, onEdit, onReset, onDelete }: { rows: StaffRow[]; admin: boolean; onEdit: (r: StaffRow) => void; onReset: (r: StaffRow) => void; onDelete: (r: StaffRow) => void }) {
  return (
    <Table rows={rows} empty="Belum ada petugas toko." cols={[
      { head: 'Nama', cell: (r) => <b>{r.name}</b> },
      { head: 'Username', mono: true, cell: (r) => r.username },
      { head: 'Toko', cell: (r) => r.depotName ?? <Badge tone="warn">Tanpa toko</Badge> },
      { head: 'Kata sandi', cell: passwordBadge },
    ]} actions={(r) => admin && (<>
      <Btn sm kind="g" onClick={() => onEdit(r)}>Ubah…</Btn>
      <Btn sm kind="g" onClick={() => onReset(r)}>Atur ulang sandi</Btn>
      <Btn sm kind="d" onClick={() => onDelete(r)}>Hapus…</Btn>
    </>)} />
  );
}

function StaffSection({ depots, admin }: { depots: DepotRow[]; admin: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sq = useData<StaffRow[]>('/depots/staff');
  const [sm, setSm] = useState<StaffRow | 'new' | null>(null);
  const [del, setDel] = useState<StaffRow | null>(null);
  const [cred, setCred] = useState<Cred | null>(null);
  async function reset(r: StaffRow) {
    try {
      const c = await post<{ username: string; password: string }>(`/depots/staff/${r.id}/reset`, {});
      setCred({ depot: r.depotName ?? '', ...c }); void qc.invalidateQueries();
    } catch (x) { toast(errText(x), false); }
  }
  return (
    <>
      <Block title="Petugas toko" note="Akun petugas yang bekerja di toko. Kata sandi sementara hanya tampil sekali saat dibuat atau diatur ulang."
        tools={admin && <Btn onClick={() => setSm('new')} disabled={!depots.length}>+ Tambah petugas</Btn>}>
        <Gate q={sq}>
          <StaffTable rows={sq.data ?? []} admin={admin} onEdit={setSm} onReset={(r) => void reset(r)} onDelete={setDel} />
        </Gate>
      </Block>
      {sm && <StaffDialog key={sm === 'new' ? 'baru' : sm.id} sm={sm} depots={depots} onClose={() => setSm(null)} onCred={setCred} />}
      {del && <DeleteStaffDialog key={del.id} st={del} onClose={() => setDel(null)} />}
      {cred && <CredDialog cred={cred} onClose={() => setCred(null)} />}
    </>
  );
}

export default function DepotPage() {
  const q = useData<DepotRow[]>('/depots');
  const { me } = useSession();
  const admin = me?.role === 'tenant_admin';
  const [edit, setEdit] = useState<DepotRow | 'new' | null>(null); // satu popup untuk tambah ('new') dan ubah (baris toko)
  const ds = q.data ?? [];
  return (
    <>
      <PageHead title="Toko" desc="Setiap toko punya stok, pesanan, PO, dan petugas sendiri. Petugas toko hanya bekerja di tokonya; pengurus melihat semua." />
      <div className="page">
        <Gate q={q}>
          <Block title="Daftar toko" note="Anggota memilih toko saat memesan di aplikasi; pesanan menunggu persetujuan petugas toko itu." tools={admin && <Btn onClick={() => setEdit('new')}>+ Tambah toko</Btn>}>
            <DepotTable rows={ds} admin={admin} onEdit={setEdit} />
          </Block>
          <StaffSection depots={ds} admin={admin} />
        </Gate>
      </div>
      {edit && <DepotDialog key={edit === 'new' ? 'baru' : edit.id} edit={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
