import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, post as apiPost } from '../api';
import { resizeToJpeg } from '../image';
import { Badge, Block, Btn, Field, Gate, Modal, PageHead, Table } from '../ui';
import { useAct, useData, useForm, useToast } from '../hooks';

interface Voucher { id: string; name: string; description: string | null; coinCost: number; stock: number; active: boolean; imageUrl: string | null }
interface Redemption {
  id: string; no: string; memberName: string; memberNo: string | null; voucherName: string; coins: number;
  status: 'pending' | 'fulfilled' | 'rejected'; code: string | null; reason: string | null; decidedByName: string | null; createdAt: string;
}

const STATUS = { pending: ['warn', 'Menunggu'], fulfilled: ['ok', 'Diterbitkan'], rejected: ['bad', 'Ditolak'] } as const;
const stamp = (s: string) => new Date(s).toLocaleString('id-ID');
const num = (s: string) => Number(s.replace(/\D/g, '')) || 0;
const sub = { fontSize: 12, color: 'var(--muted)' } as const;

/** Foto voucher: dipilih dari berkas, dikecilkan di browser, lalu langsung diunggah. */
function PhotoField({ v }: { v: Voucher }) {
  const act = useAct();
  const [err, setErr] = useState('');
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    try { act.post(`/vouchers/${v.id}/image`, `Foto ${v.name} diperbarui`, { contentType: 'image/jpeg', data: await resizeToJpeg(file) }); }
    catch { setErr('Berkas bukan gambar yang bisa dibaca.'); }
  };
  return (
    <div className="photo">
      {v.imageUrl ? <img className="thumb thumb-lg" src={v.imageUrl} alt={v.name} /> : <div className="thumb thumb-lg" />}
      <label className="field">Foto voucher
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={act.busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        <span className="hint-sm">{err || 'Tampil di katalog voucher anggota. Otomatis dikecilkan.'}</span>
      </label>
    </div>
  );
}

/** Foto untuk voucher yang belum dibuat: dipilih dan dikecilkan dulu, diunggah setelah voucher tersimpan. */
function NewPhotoField({ photo, onPick }: { photo: string | null; onPick: (data: string | null) => void }) {
  const [err, setErr] = useState('');
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    try { onPick(await resizeToJpeg(file)); } catch { setErr('Berkas bukan gambar yang bisa dibaca.'); }
  };
  return (
    <div className="photo">
      {photo ? <img className="thumb thumb-lg" src={`data:image/jpeg;base64,${photo}`} alt="Foto voucher" /> : <div className="thumb thumb-lg" />}
      <label className="field">Foto voucher
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        <span className="hint-sm">{err || 'Tampil di katalog voucher anggota. Otomatis dikecilkan.'}</span>
      </label>
    </div>
  );
}

/** Buat voucher; bila ada foto, diunggah segera setelahnya. Voucher tetap tersimpan walau foto gagal. */
function useCreateVoucher(onDone: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const create = async (body: Record<string, unknown>, photo: string | null) => {
    setBusy(true);
    try {
      const v = await apiPost<{ id: string }>('/vouchers', body);
      if (photo) {
        try { await apiPost(`/vouchers/${v.id}/image`, { contentType: 'image/jpeg', data: photo }); toast(`${String(body.name)} dibuat`); }
        catch (e) { toast(`Voucher dibuat, tetapi foto gagal diunggah: ${e instanceof ApiError ? e.message : 'coba lagi lewat Ubah'}`, false); }
      } else toast(`${String(body.name)} dibuat`);
      onDone();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Terjadi kesalahan', false); }
    finally { setBusy(false); void qc.invalidateQueries(); }
  };
  return { create, busy };
}

function VoucherDialog({ v, onClose }: { v: Voucher | null; onClose: () => void }) {
  const act = useAct();
  const [photo, setPhoto] = useState<string | null>(null);
  const made = useCreateVoucher(onClose);
  const f = useForm({ name: v?.name ?? '', description: v?.description ?? '', cost: v ? String(v.coinCost) : '', stock: v ? String(v.stock) : '1' });
  const name = f.v.name.trim();
  const body = { name, description: f.v.description.trim(), coinCost: num(f.v.cost), stock: num(f.v.stock) };
  const bad = name.length < 2 || body.coinCost < 1;
  return (
    <Modal title={v ? `Ubah voucher — ${v.name}` : 'Voucher baru'} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || made.busy || bad} onClick={() => (v ? act.run('PATCH', `/vouchers/${v.id}`, `${name} diperbarui`, body, onClose) : void made.create(body, photo))}>{v ? 'Simpan perubahan' : 'Buat voucher'}</Btn>
    </>}>
      <Field {...f.bind('name', 'Nama voucher', 'mis. Voucher Umroh')} focus />
      <Field {...f.bind('cost', 'Harga (koin)')} type="number" />
      <Field {...f.bind('stock', 'Stok')} type="number" hint="Berkurang 1 tiap penukaran; kembali bila penukaran ditolak" />
      <Field {...f.bind('description', 'Keterangan (dilihat anggota)')} type="textarea" />
      {v ? <PhotoField v={v} /> : <NewPhotoField photo={photo} onPick={setPhoto} />}
    </Modal>
  );
}

function FulfillDialog({ r, onClose }: { r: Redemption; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ code: '' });
  return (
    <Modal title={`Terbitkan ${r.no}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Kembali</Btn>
      <Btn disabled={act.busy} onClick={() => act.post(`/voucher-redemptions/${r.id}/fulfill`, `${r.no} diterbitkan`, { code: f.v.code.trim() }, onClose)}>Terbitkan voucher</Btn>
    </>}>
      <p>Voucher <b>{r.voucherName}</b> untuk <b>{r.memberName}</b>. Siapkan voucher di luar aplikasi, lalu isi kode atau catatannya agar anggota bisa memakainya.</p>
      <Field {...f.bind('code', 'Kode / catatan (dilihat anggota)', 'mis. UMROH-2026-001')} focus />
    </Modal>
  );
}

function RejectDialog({ r, onClose }: { r: Redemption; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ reason: '' });
  return (
    <Modal title={`Tolak ${r.no}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Kembali</Btn>
      <Btn kind="d" disabled={act.busy || f.v.reason.trim().length < 3} onClick={() => act.post(`/voucher-redemptions/${r.id}/reject`, `${r.no} ditolak; koin dikembalikan`, { reason: f.v.reason.trim() }, onClose)}>Tolak penukaran</Btn>
    </>}>
      <p className="note">{r.coins} koin otomatis kembali ke {r.memberName} dan stok voucher bertambah 1.</p>
      <Field {...f.bind('reason', 'Alasan (dilihat anggota)', 'mis. kuota habis di pemasok')} focus />
    </Modal>
  );
}

type Dialog = { kind: 'voucher'; v: Voucher | null } | { kind: 'fulfill' | 'reject'; r: Redemption } | null;

/** Voucher koin (pengurus): katalog yang bisa ditukar anggota dan antrean penukaran yang perlu diterbitkan atau ditolak. */
export default function VouchersPage() {
  const vs = useData<Voucher[]>('/vouchers');
  const rs = useData<Redemption[]>('/voucher-redemptions');
  const act = useAct();
  const [dlg, setDlg] = useState<Dialog>(null);
  return (
    <>
      <PageHead title="Voucher koin" desc="Koin didapat anggota dari belanja (koin per produk diatur di halaman Produk). Anggota menukarnya dengan voucher di sini, mis. umroh. Pengurus menerbitkan atau menolak tiap penukaran." />
      <div className="page">
        <Gate q={rs}>
          <Block title="Penukaran anggota" note="Koin anggota langsung dipotong saat menukar. Bila ditolak, koin dan stok kembali.">
            <Table rows={rs.data ?? []} empty="Belum ada penukaran." cols={[
              { head: 'Penukaran', cell: (x) => <><b>{x.no}</b><div style={sub}>{stamp(x.createdAt)}</div></> },
              { head: 'Anggota', cell: (x) => <>{x.memberName}<div style={sub}>{x.memberNo ?? '—'}</div></> },
              { head: 'Voucher', cell: (x) => x.voucherName },
              { head: 'Koin', mono: true, right: true, cell: (x) => x.coins },
              { head: 'Status', cell: (x) => <><Badge tone={STATUS[x.status][0]}>{STATUS[x.status][1]}</Badge>{x.code || x.reason ? <div style={sub}>{x.code ?? x.reason}</div> : null}</> },
            ]} actions={(x) => (x.status === 'pending' ? (<>
              <Btn sm onClick={() => setDlg({ kind: 'fulfill', r: x })}>Terbitkan…</Btn>
              <Btn sm kind="d" onClick={() => setDlg({ kind: 'reject', r: x })}>Tolak…</Btn>
            </>) : null)} />
          </Block>
        </Gate>
        <Gate q={vs}>
          <Block title="Katalog voucher" tools={<Btn sm onClick={() => setDlg({ kind: 'voucher', v: null })}>Voucher baru…</Btn>}>
            <Table rows={vs.data ?? []} empty="Belum ada voucher." cols={[
              { head: 'Voucher', cell: (x) => <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{x.imageUrl ? <img className="thumb" src={x.imageUrl} alt="" /> : <div className="thumb" />}<div><b>{x.name}</b>{x.description ? <div style={sub}>{x.description}</div> : null}</div></div> },
              { head: 'Harga', mono: true, right: true, cell: (x) => `${x.coinCost} koin` },
              { head: 'Stok', mono: true, right: true, cell: (x) => x.stock },
              { head: 'Status', cell: (x) => <Badge tone={x.active ? 'ok' : 'bad'}>{x.active ? 'Aktif' : 'Nonaktif'}</Badge> },
            ]} actions={(x) => (<>
              <Btn sm kind="g" onClick={() => setDlg({ kind: 'voucher', v: x })}>Ubah…</Btn>
              <Btn sm kind="g" onClick={() => act.run('PATCH', `/vouchers/${x.id}`, `${x.name} ${x.active ? 'dinonaktifkan' : 'diaktifkan'}`, { active: !x.active })}>{x.active ? 'Nonaktifkan' : 'Aktifkan'}</Btn>
            </>)} />
          </Block>
        </Gate>
      </div>
      {dlg?.kind === 'voucher' && <VoucherDialog key={dlg.v?.id ?? 'new'} v={dlg.v && (vs.data?.find((x) => x.id === dlg.v!.id) ?? dlg.v)} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'fulfill' && <FulfillDialog key={dlg.r.id} r={dlg.r} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'reject' && <RejectDialog key={dlg.r.id} r={dlg.r} onClose={() => setDlg(null)} />}
    </>
  );
}
