import { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { INITIAL_BUDGET, PARTICIPATION_TOTAL, SHOPPING_BALANCE, simulateIncome } from '@sajadah/shared';
import { C } from '../../src/theme';
import { useRates } from '../../src/rates';
import { Card, Chips, Hero, Note, Row, Screen } from '../../src/ui';
import { rupiah, useData } from '../../src/hooks';

const LEVEL = ['Penjual (atas nama Anda)', 'Sponsor langsung (tingkat 1)', 'Sponsor tingkat 2', 'Sponsor tingkat 3'];
const SIM = ['Penjualan ke pelanggan umum', 'Downline tingkat 1', 'Downline tingkat 2', 'Downline tingkat 3'];
const EXAMPLE = 1_000_000;
const num = (s: string) => Math.max(0, Math.floor(Number(s.replace(/\D/g, '')) || 0));
const signed = (n: number) => (n < 0 ? `−${rupiah(-n)}` : rupiah(n));

function Num({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return (
    <View style={{ flex: 1, minWidth: 140, gap: 4 }}>
      <Text style={{ fontSize: 12, color: C.muted }}>{label}</Text>
      <TextInput value={value} onChangeText={set} keyboardType="number-pad" style={{ borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink }} />
    </View>
  );
}
const H = ({ children }: { children: string }) => <Text style={{ fontSize: 16, fontWeight: '600', color: C.green, marginTop: 6 }}>{children}</Text>;
const Li = ({ children }: { children: React.ReactNode }) => <Text style={{ color: C.ink, lineHeight: 20 }}>•  {children}</Text>;

/** Skema komisi, syarat cair, simulasi pendapatan bulanan, dan rincian modal awal — sama dengan halaman web "Skema komisi". */
export default function Scheme() {
  const RATES = useRates();
  const prods = useData<{ id: string; name: string; price: number }[]>('/me/products');
  const list = useMemo(() => prods.data ?? [], [prods.data]);
  const [pid, setPid] = useState('');
  const [v, setV] = useState({ own: '20', l1: '5', l2: '0', l3: '0', transport: '100000', promo: '50000', other: '0' });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  useEffect(() => { if (!pid && list[0]) setPid(list[0].id); }, [pid, list]);
  const price = list.find((p) => p.id === pid)?.price ?? 0;
  const sim = useMemo(() => simulateIncome({ price, ownPacks: num(v.own), downlinePacks: [num(v.l1), num(v.l2), num(v.l3)], costs: num(v.transport) + num(v.promo) + num(v.other), rates: RATES }), [RATES, price, v]);
  const totalRate = RATES.reduce((a, b) => a + b, 0);

  return (
    <Screen queries={[prods]}>
      <H>Cara komisi dihitung</H>
      <Note>Setiap pesanan yang memenuhi syarat memberi komisi untuk penjual dan sampai {RATES.length - 1} tingkat sponsor di atasnya. Total paling banyak {totalRate}% dari nilai pesanan.</Note>
      <Card>
        {RATES.map((p, i) => <Row key={LEVEL[i]} title={LEVEL[i]!} sub={`Contoh pesanan ${rupiah(EXAMPLE)} → ${rupiah(Math.round((EXAMPLE * p) / 100))}`} right={`${p}%`} tone="ok" />)}
      </Card>

      <H>Syarat komisi bisa cair</H>
      <Card>
        <View style={{ padding: 12, gap: 6 }}>
          <Li>Pesanan dari <Text style={{ fontWeight: '600' }}>produk nyata</Text>, dibuat di toko dan <Text style={{ fontWeight: '600' }}>disetujui toko</Text>.</Li>
          <Li>Pesanan <Text style={{ fontWeight: '600' }}>lunas</Text> dan tidak dibatalkan.</Li>
          <Li>Barang <Text style={{ fontWeight: '600' }}>sudah diterima</Text> pembeli dengan bukti terima.</Li>
          <Li>Keuangan koperasi <Text style={{ fontWeight: '600' }}>menyetujui</Text> lalu <Text style={{ fontWeight: '600' }}>membayar</Text> komisi. Ada jeda; status “menunggu” belum bisa dipakai.</Li>
          <Li>Penjualan dicatat lewat aplikasi (tab Pesan → Jual ke pelanggan), bukan dengan mengetik angka. Stok diambil dari toko, toko menyetujui pesanannya, dan pelanggan membayar tunai.</Li>
          <Li>Komisi hanya dari pesanan produk, bukan dari sekadar mengajak anggota baru.</Li>
          <Li><Text style={{ fontWeight: '600' }}>Referal:</Text> beri kode referal Anda (tab Jaringan) ke pelanggan yang mau jadi anggota. Saat petugas mendaftarkannya dengan kode itu, Anda jadi sponsornya dan mendapat bonus {RATES[1]}% dari setiap penjualannya ke pelanggan ({RATES[2]}% dari tingkat 2, {RATES[3]}% dari tingkat 3).</Li>
          <Li>Rantai sponsor dibekukan saat pesanan dibuat; mengubah sponsor tidak mengubah pesanan lama.</Li>
          <Li><Text style={{ fontWeight: '600' }}>Komisi hanya dari penjualan ke pelanggan umum.</Text> Anggota tidak menjual ke anggota lain, dan belanja untuk diri sendiri tidak menghasilkan komisi bagi Anda maupun sponsor Anda.</Li>
          <Li>Sistem saat ini tidak menetapkan syarat pembelian minimum.</Li>
        </View>
      </Card>

      <H>Simulasi pendapatan bulanan</H>
      <Note>Isi perkiraan Anda. Ini ilustrasi, bukan janji atau jaminan penghasilan.</Note>
      {list.length > 0 && <Chips value={pid} onChange={setPid} options={list.map((p) => ({ v: p.id, l: `${p.name} · ${rupiah(p.price)}` }))} />}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Num label="Penjualan Anda ke pelanggan (per bulan)" value={v.own} set={set('own')} />
        <Num label="Downline tingkat 1 (per bulan)" value={v.l1} set={set('l1')} />
        <Num label="Downline tingkat 2 (per bulan)" value={v.l2} set={set('l2')} />
        <Num label="Downline tingkat 3 (per bulan)" value={v.l3} set={set('l3')} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Num label="Transportasi & ongkir (Rp/bulan)" value={v.transport} set={set('transport')} />
        <Num label="Promosi (Rp/bulan)" value={v.promo} set={set('promo')} />
        <Num label="Biaya lain (Rp/bulan)" value={v.other} set={set('other')} />
      </View>

      <Hero label="Pendapatan bersih per bulan (komisi − biaya)" value={signed(sim.net)} note={sim.net < 0 ? 'Biaya lebih besar dari komisi' : `Komisi kotor ${rupiah(sim.grossCommission)}`} />
      <Card>
        {sim.lines.map((l) => <Row key={l.level} title={SIM[l.level]!} sub={`${l.packs} · omzet ${rupiah(l.turnover)} · ${l.percent}%`} right={rupiah(l.commission)} tone={l.commission ? 'ok' : 'neutral'} />)}
        <Row title="Biaya Anda" right={rupiah(sim.costs)} tone={sim.costs ? 'warn' : 'neutral'} />
        <Row title="Titik impas" sub="penjualan Anda minimal per bulan" right={sim.breakEvenOwnPacks == null ? '—' : sim.breakEvenOwnPacks === 0 ? 'Sudah impas' : `${sim.breakEvenOwnPacks}`} tone={sim.net < 0 ? 'bad' : 'ok'} />
      </Card>
      <Note>Omzet bukan laba. Komisi dihitung dari nilai pesanan, sedangkan pendapatan bersih dikurangi biaya Anda sendiri. Belum termasuk pajak dan bagi hasil laba koperasi (tab Hak saya).</Note>

      <H>Keanggotaan & modal awal</H>
      <Card>
        <Row title="Penyertaan modal per anggota" sub="disetor satu kali saat bergabung" right={rupiah(PARTICIPATION_TOTAL)} />
        <Row title="Menjadi saldo belanja" sub="hanya untuk belanja di koperasi; tidak bisa ditarik tunai" right={rupiah(SHOPPING_BALANCE)} tone="ok" />
        <Row title="Keperluan awal koperasi" sub={`HP Android ${rupiah(INITIAL_BUDGET.hpAndroid)}, iuran wajib ${rupiah(INITIAL_BUDGET.mandatoryDues)}, iuran bulan pertama ${rupiah(INITIAL_BUDGET.firstMonthlyDues)}, kostum ${rupiah(INITIAL_BUDGET.costume)}, aplikasi ${rupiah(INITIAL_BUDGET.application)}`} right={rupiah(PARTICIPATION_TOTAL - SHOPPING_BALANCE)} />
      </Card>

      <H>Yang perlu Anda ketahui</H>
      <Card>
        <View style={{ padding: 12, gap: 6 }}>
          <Li>Komisi bergantung pada <Text style={{ fontWeight: '600' }}>penjualan nyata</Text>; tidak ada jaminan penghasilan atau pendapatan pasif.</Li>
          <Li>Saldo belanja tidak bisa ditarik. Jangan menyetor di luar kemampuan Anda.</Li>
          <Li>Tanyakan kepada pengurus bila ada tarif, syarat, atau kebijakan pengembalian barang yang belum jelas.</Li>
        </View>
      </Card>
    </Screen>
  );
}
