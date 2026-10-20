import { useState } from 'react';
import { Badge, Block, Btn, Field, Fields, Gate, Modal, PageHead, Table } from '../ui';
import { R, useAct, useData, useForm } from '../hooks';
import { imageSrc, resizeToJpeg } from '../image';
import type { CentralRow } from '../types';

const num = (v: string) => Math.floor(Number(v.replace(/\D/g, '')) || 0);

function problemOf(f: { name: string }, sell: number, safety: number, target: number, list: number) {
  if (f.name.trim().length < 2) return 'Isi nama produk (minimal 2 huruf).';
  if (sell <= 0) return 'Isi harga jual.';
  if (list && list <= sell) return 'Harga normal harus di atas harga jual (atau kosongkan).';
  return target < safety ? 'Target stok tidak boleh di bawah stok aman.' : '';
}

function ProblemNote({ problem }: { problem: string }) {
  return <p className="note">{problem}</p>;
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

/** Dialog produk baru / ubah. Dipasang hanya saat terbuka, jadi isian selalu mulai dari nilai produk yang dipilih. */
function ProductDialog({ p, onClose }: { p: CentralRow | null; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ name: p?.name ?? '', sku: '', sell: p ? String(p.sellPrice) : '', safety: p ? String(p.safety) : '5', target: p ? String(p.target) : '20', category: p?.category ?? '', description: p?.description ?? '', list: p?.listPrice ? String(p.listPrice) : '', coins: p ? String(p.coins) : '0' });
  const sell = num(f.v.sell), safety = num(f.v.safety), target = num(f.v.target);
  const list = num(f.v.list);
  const problem = problemOf(f.v, sell, safety, target, list);
  const name = f.v.name.trim();
  const body = { name, sellPrice: sell, safety, target, category: f.v.category.trim(), description: f.v.description.trim(), listPrice: list, coins: num(f.v.coins) };
  const save = () => (p
    ? act.run('PATCH', `/central/products/${p.id}`, `${name} diperbarui`, body, onClose)
    : act.post('/central/products', `Produk ${name} dibuat`, { ...body, sku: f.v.sku.trim() || undefined }, onClose));
  return (
    <Modal title={p ? `Ubah produk — ${p.name}` : 'Produk baru'} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || !!problem} onClick={save}>{p ? 'Simpan perubahan' : 'Buat produk'}</Btn>
    </>}>
      <Fields>
        <Field {...f.bind('name', 'Nama produk', 'mis. Produk baru')} focus />
        {p ? <Field label="SKU" value={p.sku} onChange={() => undefined} hint="Tidak bisa diubah" /> : <Field {...f.bind('sku', 'SKU (opsional)', 'otomatis, mis. PRD-04')} />}
        <Field {...f.bind('sell', 'Harga jual (Rp)')} type="number" />
        <Field {...f.bind('safety', 'Stok aman')} type="number" hint="Di bawah ini produk dianggap menipis" />
        <Field {...f.bind('target', 'Target stok')} type="number" hint="Dipakai menghitung kebutuhan beli" />
        <Field {...f.bind('category', 'Kategori (tampil di toko anggota)', 'mis. Makanan')} />
        <Field {...f.bind('list', 'Harga normal (Rp, opsional)')} type="number" hint="Dicoret di toko bila diisi dan di atas harga jual" />
        <Field {...f.bind('coins', 'Koin per produk')} type="number" hint="Koin yang didapat anggota tiap produk, saat belanja sendiri sudah diterima" />
        <Field {...f.bind('description', 'Deskripsi produk')} type="textarea" />
      </Fields>
      {p && <PhotoField p={p} />}
      <ProblemNote problem={problem} />
    </Modal>
  );
}

function ProductTable({ rows, onEdit }: { rows: CentralRow[]; onEdit: (p: CentralRow) => void }) {
  const act = useAct();
  return (
    <Table rows={rows} cols={[
      { head: 'Produk', cell: (x) => <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{imageSrc(x.image) ? <img className="thumb" src={imageSrc(x.image)!} alt="" /> : <div className="thumb" />}<div><b>{x.name}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{x.sku}{x.category ? ` · ${x.category}` : ''}</div></div></div> },
      { head: 'Harga jual', mono: true, right: true, cell: (x) => R(x.sellPrice) },
      { head: 'Koin', mono: true, right: true, cell: (x) => x.coins },
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
      {dlg && <ProductDialog key={dlg.p?.id ?? 'baru'} p={dlg.p} onClose={() => setDlg(null)} />}
    </>
  );
}
