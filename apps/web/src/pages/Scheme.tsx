import { useEffect, useMemo } from 'react';
import { INITIAL_BUDGET, PARTICIPATION_TOTAL, SHOPPING_BALANCE, simulateIncome } from '@sajadah/shared';
import { ratesText, useRates } from '../rates';
import { Badge, Block, Combobox, Field, Fields, Gate, Kpi, Kpis, PageHead, Table } from '../ui';
import { R, useData, useForm } from '../hooks';

const LEVEL_NAME = ['Penjual (atas nama Anda)', 'Sponsor langsung (tingkat 1)', 'Sponsor tingkat 2', 'Sponsor tingkat 3'];
const SIM_LEVEL = ['Penjualan ke pelanggan umum', 'Downline tingkat 1', 'Downline tingkat 2', 'Downline tingkat 3'];
const EXAMPLE = 1_000_000;
const Rs = (n: number) => (n < 0 ? `−${R(-n)}` : R(n));
const num = (s: string) => Math.max(0, Math.floor(Number(s) || 0));

export default function SchemePage() {
  const RATES = useRates();
  const prods = useData<{ id: string; name: string; price: number }[]>('/me/products');
  const f = useForm({ product: '', own: '20', l1: '5', l2: '0', l3: '0', transport: '100000', promo: '50000', other: '0' });
  const list = prods.data ?? [];
  useEffect(() => { if (!f.v.product && list[0]) f.set('product', list[0].id); }, [f.v.product, list]); // eslint-disable-line react-hooks/exhaustive-deps
  const price = list.find((p) => p.id === f.v.product)?.price ?? 0;
  const sim = useMemo(
    () => simulateIncome({ price, ownPacks: num(f.v.own), downlinePacks: [num(f.v.l1), num(f.v.l2), num(f.v.l3)], costs: num(f.v.transport) + num(f.v.promo) + num(f.v.other), rates: RATES }),
    [RATES, price, f.v.own, f.v.l1, f.v.l2, f.v.l3, f.v.transport, f.v.promo, f.v.other],
  );
  const totalRate = RATES.reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHead title="Skema komisi" desc="Cara komisi dihitung, syarat cairnya, dan simulasi pendapatan. Semua angka di sini bersumber dari aturan sistem yang sama dengan perhitungan sebenarnya." />
      <div className="page">
        <Block title="Cara komisi dihitung" note={`Setiap pesanan yang memenuhi syarat menghasilkan komisi untuk penjual dan sampai ${RATES.length - 1} tingkat sponsor di atasnya. Total paling banyak ${totalRate}% dari nilai pesanan.`}>
          <Table rows={RATES.map((p, i) => ({ id: String(i), i, p }))} cols={[
            { head: 'Penerima', cell: (r) => LEVEL_NAME[r.i] },
            { head: 'Tarif', mono: true, right: true, w: '90px', cell: (r) => `${r.p}%` },
            { head: `Contoh pesanan ${R(EXAMPLE)}`, mono: true, right: true, cell: (r) => R(Math.round((EXAMPLE * r.p) / 100)) },
          ]} />
        </Block>

        <Block title="Syarat komisi bisa cair">
          <ol className="steps-list">
            <li>Pesanan berasal dari <b>produk nyata</b> yang dibuat di toko dan <b>disetujui toko</b>.</li>
            <li>Pesanan sudah <b>lunas</b> (saldo belanja atau kas) dan <b>tidak dibatalkan</b>.</li>
            <li>Barang <b>sudah diterima</b> pembeli dan ada bukti terima.</li>
            <li>Bagian keuangan koperasi <b>menyetujui</b> lalu <b>membayar</b> komisi. Ada jeda antara pesanan dan komisi cair; status “menunggu” belum bisa dipakai.</li>
          </ol>
          <ul className="steps-list">
            <li>Penjualan dicatat lewat aplikasi (tab Pesan → <b>Jual ke pelanggan</b>), bukan dengan mengetik angka. Stok diambil dari toko, toko menyetujui pesanannya, dan pelanggan membayar tunai.</li>
            <li>Komisi hanya berasal dari <b>pesanan produk</b>. Tidak ada komisi untuk sekadar mengajak anggota baru.</li>
            <li><b>Referal:</b> beri kode referal Anda ke pelanggan yang mau jadi anggota (menu Jaringan saya). Saat petugas mendaftarkannya dengan kode itu, Anda menjadi sponsornya dan mendapat bonus {RATES[1]}% dari setiap penjualannya ke pelanggan ({RATES[2]}% dari tingkat 2, {RATES[3]}% dari tingkat 3).</li>
            <li>Rantai sponsor dibekukan saat pesanan dibuat; mengubah sponsor tidak mengubah pesanan yang sudah ada.</li>
            <li><b>Komisi hanya dari penjualan ke pelanggan umum.</b> Anggota tidak menjual ke anggota lain, dan belanja untuk diri sendiri tidak menghasilkan komisi bagi Anda maupun sponsor Anda.</li>
            <li>Sistem saat ini tidak menetapkan syarat pembelian minimum untuk mendapat komisi.</li>
          </ul>
        </Block>

        <Block title="Simulasi pendapatan bulanan" note="Isi perkiraan Anda. Ini ilustrasi untuk membantu menimbang, bukan janji atau jaminan penghasilan.">
          <Gate q={prods}>
            <div style={{ padding: '14px 18px 0' }}><Combobox label="Produk yang dijual (harga jual)" value={f.v.product} onChange={(v) => f.set('product', v)} options={list.map((p) => ({ value: p.id, label: `${p.name} — ${R(p.price)}` }))} emptyText="Belum ada produk aktif" /></div>
            <Fields>
              <Field {...f.bind('own', 'Penjualan Anda ke pelanggan (per bulan)')} type="number" />
              <Field {...f.bind('l1', 'Downline tingkat 1 (per bulan)')} type="number" />
              <Field {...f.bind('l2', 'Downline tingkat 2 (per bulan)')} type="number" />
              <Field {...f.bind('l3', 'Downline tingkat 3 (per bulan)')} type="number" />
            </Fields>
            <Fields>
              <Field {...f.bind('transport', 'Biaya transportasi & ongkir (Rp/bulan)')} type="number" />
              <Field {...f.bind('promo', 'Biaya promosi (Rp/bulan)')} type="number" />
              <Field {...f.bind('other', 'Biaya lain (Rp/bulan)')} type="number" />
            </Fields>

            <Kpis>
              <Kpi l="Komisi kotor" v={R(sim.grossCommission)} n={`${sim.effectivePercent.toFixed(1)}% dari omzet ${R(sim.turnover)}`} />
              <Kpi l="Biaya Anda" v={R(sim.costs)} n="per bulan" tone={sim.costs ? 'warn' : ''} />
              <Kpi l="Pendapatan bersih" v={Rs(sim.net)} n="komisi − biaya" tone={sim.net < 0 ? 'bad' : 'ok'} />
              <Kpi l="Titik impas" v={sim.breakEvenOwnPacks == null ? '—' : sim.breakEvenOwnPacks === 0 ? 'Sudah impas' : `${sim.breakEvenOwnPacks}`} n="penjualan Anda/bulan" />
            </Kpis>
            <Table rows={sim.lines.map((l) => ({ ...l, id: String(l.level) }))} cols={[
              { head: 'Sumber', cell: (l) => SIM_LEVEL[l.level] }, { head: 'Jumlah', mono: true, right: true, cell: (l) => l.packs },
              { head: 'Omzet', mono: true, right: true, cell: (l) => R(l.turnover) }, { head: 'Tarif', mono: true, right: true, cell: (l) => `${l.percent}%` },
              { head: 'Komisi', mono: true, right: true, cell: (l) => R(l.commission) },
            ]} />
            {sim.net < 0 && <p className="note" role="status"><Badge tone="bad">Rugi</Badge> Biaya Anda lebih besar dari komisi. Naikkan penjualan atau turunkan biaya sampai minimal {sim.breakEvenOwnPacks ?? 0}/bulan penjualan Anda.</p>}
            <p className="note"><b>Omzet bukan laba.</b> Komisi dihitung dari nilai pesanan, sedangkan pendapatan bersih Anda dikurangi biaya Anda sendiri. Belum termasuk pajak dan bagi hasil laba koperasi (lihat menu Hak saya). Komisi cair setelah semua syarat di atas terpenuhi.</p>
          </Gate>
        </Block>

        <Block title="Keanggotaan & modal awal" note="Disampaikan terbuka agar anggota tahu apa yang disetorkan dan ke mana uangnya.">
          <Table rows={[
            { id: 'total', k: 'Penyertaan modal per anggota', v: R(PARTICIPATION_TOTAL), n: 'disetor satu kali saat bergabung' },
            { id: 'saldo', k: 'Menjadi saldo belanja', v: R(SHOPPING_BALANCE), n: 'hanya untuk belanja di koperasi; tidak bisa ditarik tunai' },
            { id: 'awal', k: 'Keperluan awal koperasi', v: R(PARTICIPATION_TOTAL - SHOPPING_BALANCE), n: `HP Android ${R(INITIAL_BUDGET.hpAndroid)}, iuran wajib ${R(INITIAL_BUDGET.mandatoryDues)}, iuran bulan pertama ${R(INITIAL_BUDGET.firstMonthlyDues)}, kostum ${R(INITIAL_BUDGET.costume)}, aplikasi ${R(INITIAL_BUDGET.application)}` },
          ]} cols={[{ head: 'Komponen', cell: (r) => r.k }, { head: 'Jumlah', mono: true, right: true, cell: (r) => r.v }, { head: 'Keterangan', cell: (r) => r.n }]} />
        </Block>

        <Block title="Yang perlu Anda ketahui">
          <ul className="steps-list">
            <li>Komisi bergantung pada <b>penjualan nyata</b>; tidak ada jaminan penghasilan atau pendapatan pasif.</li>
            <li>Saldo belanja tidak bisa ditarik. Jangan menyetor di luar kemampuan Anda.</li>
            <li>Tanyakan kepada pengurus bila ada tarif, syarat, atau kebijakan pengembalian barang yang belum jelas. Tarif di halaman ini adalah tarif yang berlaku saat ini di sistem.</li>
          </ul>
        </Block>
      </div>
    </>
  );
}
