import { useEffect, useMemo, useState } from 'react';
import { Badge, Block, Btn, Combobox, Field, Fields, Gate, Modal, PageHead, Table } from '../ui';
import { R, useAct, useData, useForm, useToast } from '../hooks';
import { ApiError, api } from '../api';
import { useQueryClient } from '@tanstack/react-query';
import { imageSrc, resizeToJpeg } from '../image';
import type { CentralRow } from '../types';

const num = (v: string) => Math.floor(Number(v.replace(/\D/g, '')) || 0);

function problemOf(f: { name: string }, sell: number, safety: number, target: number, reward: number) {
  if (f.name.trim().length < 2) return 'Isi nama produk (minimal 2 huruf).';
  if (sell <= 0) return 'Isi harga.';
  if (reward > 100) return 'Imbalan maksimal 100%.';
  return target < safety ? 'Target stok tidak boleh di bawah stok aman.' : '';
}

/** Foto produk: dipilih dari berkas, dikecilkan di browser, lalu langsung diunggah. */
function PhotoField({ p }: { p: CentralRow }) {
  const act = useAct();
  const [err, setErr] = useState('');
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    try { act.post(`/central/products/${p.id}/image`, `Foto ${p.name} diperbarui`, { contentType: 'image/jpeg', data: await resizeToJpeg(file) }); }
    catch { setErr('Berkas bukan gambar yang bisa dibaca.'); }
  };
  const src = imageSrc(p.image);
  return (
    <div className="photo">
      {src ? <img className="thumb thumb-lg" src={src} alt={p.name} /> : <div className="thumb thumb-lg" />}
      <label className="field">Foto produk
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={act.busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        <span className="hint-sm">{err || 'Tampil di toko anggota. Otomatis dikecilkan.'}</span>
      </label>
    </div>
  );
}

/** Foto untuk produk yang belum dibuat: disimpan dulu di dialog, diunggah setelah produk tersimpan. */
function NewPhotoField({ file, onPick }: { file: File | null; onPick: (f: File | null) => void }) {
  const [err, setErr] = useState('');
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return (
    <div className="photo">
      {preview ? <img className="thumb thumb-lg" src={preview} alt="Pratinjau foto" /> : <div className="thumb thumb-lg" />}
      <label className="field">Foto produk (opsional)
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; setErr(f && !f.type.startsWith('image/') ? 'Berkas bukan gambar.' : ''); onPick(f && f.type.startsWith('image/') ? f : null); }} />
        <span className="hint-sm">{err || 'Tampil di toko anggota. Otomatis dikecilkan.'}</span>
      </label>
    </div>
  );
}

/** Dialog produk baru / ubah. Dipasang hanya saat terbuka, jadi isian selalu mulai dari nilai produk yang dipilih. */
const NEW_CATEGORY = '__baru__';
const DEFAULT_CATEGORIES = ['Makanan', 'Minuman', 'Sembako', 'Kebutuhan rumah', 'Perawatan diri'];

/** Kategori: pilih dari yang sudah dipakai produk lain (plus beberapa bawaan), atau buat baru. */
function CategoryField({ value, onChange, known }: { value: string; onChange: (v: string) => void; known: string[] }) {
  const names = useMemo(() => {
    // satu entri per nama tanpa membedakan huruf besar/kecil; ejaan dengan huruf kapital di awal diutamakan
    const byKey = new Map<string, string>();
    for (const n of [...DEFAULT_CATEGORIES, ...known, ...(value ? [value] : [])]) {
      const k = n.trim().toLowerCase();
      if (k && (!byKey.has(k) || (n[0] === n[0]!.toUpperCase() && byKey.get(k)![0] !== byKey.get(k)![0]!.toUpperCase()))) byKey.set(k, n.trim());
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'id'));
  }, [known, value]);
  const [custom, setCustom] = useState(false);
  const options = [{ value: '', label: '(Tanpa kategori)' }, ...names.map((n) => ({ value: n, label: n })), { value: NEW_CATEGORY, label: '+ Kategori baru…' }];
  return (
    <>
      <Combobox label="Kategori (tampil di toko anggota)" value={custom ? NEW_CATEGORY : value} placeholder="Pilih kategori…" options={options}
        onChange={(v) => { if (v === NEW_CATEGORY) { setCustom(true); onChange(''); } else { setCustom(false); onChange(v); } }} />
      {custom && <Field label="Nama kategori baru" value={value} onChange={onChange} ph="mis. Makanan beku" focus />}
    </>
  );
}

function ProductDialog({ p, known, onClose }: { p: CentralRow | null; known: string[]; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ name: p?.name ?? '', sku: '', sell: p ? String(p.sellPrice) : '', safety: p ? String(p.safety) : '5', target: p ? String(p.target) : '20', category: p?.category ?? '', description: p?.description ?? '', coins: p ? String(p.coins) : '0', reward: p ? String(p.rewardPercent) : '20' });
  const sell = num(f.v.sell), safety = num(f.v.safety), target = num(f.v.target);
  const problem = problemOf(f.v, sell, safety, target, num(f.v.reward));
  const name = f.v.name.trim();
  const body = { name, sellPrice: sell, safety, target, category: f.v.category.trim(), description: f.v.description.trim(), coins: num(f.v.coins), rewardPercent: num(f.v.reward) };
  const toast = useToast();
  const qc = useQueryClient();
  const [photo, setPhoto] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const create = async () => {
    setCreating(true);
    try {
      const made = await api<{ id: string }>('POST', '/central/products', { ...body, sku: f.v.sku.trim() || undefined });
      let note = `Produk ${name} dibuat`;
      if (photo) {
        try { await api('POST', `/central/products/${made.id}/image`, { contentType: 'image/jpeg', data: await resizeToJpeg(photo) }); }
        catch { note += ', tetapi foto gagal diunggah — tambahkan lewat Ubah…'; }
      }
      toast(note);
      void qc.invalidateQueries();
      onClose();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Terjadi kesalahan', false); }
    finally { setCreating(false); }
  };
  const save = () => (p ? act.run('PATCH', `/central/products/${p.id}`, `${name} diperbarui`, body, onClose) : void create());
  const exampleReward = Math.floor((sell * Math.min(num(f.v.reward), 100)) / 100);
  return (
    <Modal lg title={p ? `Ubah produk — ${p.name}` : 'Produk baru'} open onClose={onClose} footer={<>
      <span className="pf-problem" role={problem ? 'status' : undefined}>{problem}</span>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || creating || !!problem} onClick={save}>{p ? 'Simpan perubahan' : 'Buat produk'}</Btn>
    </>}>
      <div className="pform">
        <div className="pf-main">
          <section className="pf-sec">
            <h4>Informasi produk</h4>
            <div className="pf-grid">
              <div className="pf-span2"><Field {...f.bind('name', 'Nama produk', 'mis. Bakso Ayam 500 g')} focus /></div>
              {p ? <Field label="SKU" value={p.sku} onChange={() => undefined} hint="Tidak bisa diubah" /> : <Field {...f.bind('sku', 'SKU (opsional)', 'otomatis, mis. PRD-07')} />}
              <CategoryField value={f.v.category} onChange={(v) => f.set('category', v)} known={known} />
              <div className="pf-span2"><Field {...f.bind('description', 'Deskripsi (tampil di toko anggota)')} type="textarea" /></div>
            </div>
          </section>
          <section className="pf-sec">
            <h4>Harga &amp; stok</h4>
            <div className="pf-grid c3">
              <Field {...f.bind('sell', 'Harga (Rp)', 'mis. 100.000')} type="rupiah" />
              <Field {...f.bind('safety', 'Stok aman')} type="number" hint="Di bawah ini dianggap menipis" />
              <Field {...f.bind('target', 'Target stok')} type="number" hint="Dasar hitung kebutuhan beli" />
            </div>
          </section>
          <section className="pf-sec">
            <h4>Imbalan anggota</h4>
            <div className="pf-grid">
              <Field {...f.bind('reward', 'Imbalan saldo penarikan (%)')} type="number" hint="0 = tanpa imbalan, maksimal 100" />
              <Field {...f.bind('coins', 'Koin per produk')} type="number" hint="Koin tiap satuan produk" />
            </div>
            <p className="pf-example">
              {sell > 0 && num(f.v.reward) > 0
                ? <>Contoh: anggota membeli seharga <b>{R(sell)}</b> → saldo belanja terpotong {R(sell)}, lalu <b>{R(exampleReward)}</b> masuk ke saldo penarikan setelah barang diterima.</>
                : 'Imbalan masuk ke saldo penarikan anggota saat belanja sendiri sudah diterima. Saldo belanja tetap terpotong sebesar harga penuh.'}
            </p>
          </section>
        </div>
        <div className="pf-side">{p ? <PhotoField p={p} /> : <NewPhotoField file={photo} onPick={setPhoto} />}</div>
      </div>
    </Modal>
  );
}

function ProductTable({ rows, onEdit }: { rows: CentralRow[]; onEdit: (p: CentralRow) => void }) {
  const act = useAct();
  return (
    <Table rows={rows} cols={[
      { head: 'Produk', cell: (x) => <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{imageSrc(x.image) ? <img className="thumb" src={imageSrc(x.image)!} alt="" /> : <div className="thumb" />}<div><b>{x.name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{x.sku}{x.category ? ` · ${x.category}` : ''}</div></div></div> },
      { head: 'Harga', mono: true, right: true, cell: (x) => R(x.sellPrice) },
      { head: 'Koin', mono: true, right: true, cell: (x) => x.coins },
      { head: 'Imbalan', mono: true, right: true, cell: (x) => `${x.rewardPercent}%` },
      { head: 'Stok aman / target', mono: true, right: true, cell: (x) => `${x.safety} / ${x.target}` },
      { head: 'Status', cell: (x) => <Badge tone={x.active ? 'ok' : 'bad'}>{x.active ? 'Aktif' : 'Nonaktif'}</Badge> },
    ]} actions={(x) => (<>
      <Btn sm kind="g" onClick={() => onEdit(x)}>Ubah…</Btn>
      <Btn sm kind="g" onClick={() => act.run('PATCH', `/products/${x.id}/active`, `${x.name} ${x.active ? 'dinonaktifkan' : 'diaktifkan'}`)}>{x.active ? 'Nonaktifkan' : 'Aktifkan'}</Btn>
    </>)} />
  );
}

type Dialog = { p: CentralRow | null } | null;

/** Master produk (pengurus): buat produk baru, ubah nama/harga/batas stok, aktif-nonaktif. SKU dibuat otomatis dan tidak berubah. */
export default function ProductsPage() {
  const q = useData<CentralRow[]>('/central/stock');
  const [dlg, setDlg] = useState<Dialog>(null);
  const categories = useMemo(() => [...new Set((q.data ?? []).map((x) => x.category?.trim()).filter((c): c is string => !!c))], [q.data]);
  return (
    <>
      <PageHead title="Produk" desc="Daftar produk koperasi. Produk baru langsung tersedia di semua toko dengan stok 0; isi stoknya lewat Persediaan → Pengiriman (barang masuk ke pusat), lalu kirim ke toko." />
      <div className="page">
        <Gate q={q}>
          <Block title="Daftar produk" note="Harga baru hanya berlaku untuk pesanan berikutnya; pesanan lama tetap memakai harga saat dibuat. Produk nonaktif tidak bisa dipesan atau dikirim." tools={<Btn onClick={() => setDlg({ p: null })}>+ Produk baru</Btn>}>
            <ProductTable rows={q.data ?? []} onEdit={(x) => setDlg({ p: x })} />
          </Block>
        </Gate>
      </div>
      {dlg && <ProductDialog key={dlg.p?.id ?? 'baru'} p={dlg.p} known={categories} onClose={() => setDlg(null)} />}
    </>
  );
}
