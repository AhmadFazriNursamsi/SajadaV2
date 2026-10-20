import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { C } from '../../src/theme';
import { useRates } from '../../src/rates';
import { dayLabel, type SalesReport } from '../../src/report';
import { Button, Card, Chips, Hero, Note, Row, Screen } from '../../src/ui';
import { rupiah, useData } from '../../src/hooks';

/** Laporan penjualan harian anggota + saldo komisi yang dihitung otomatis dari penjualan yang sudah diterima pembeli. */
export default function Report() {
  const router = useRouter();
  const [days, setDays] = useState('14');
  const q = useData<SalesReport>(`/me/sales-report?days=${days}`);
  useFocusEffect(useCallback(() => { void q.refetch(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));
  const rates = useRates();
  const r = q.data;
  return (
    <Screen queries={[q]}>
      {r && (<>
        <Hero label="Saldo komisi (sudah dihitung, belum dibayar)" value={rupiah(r.balance.available)} note={`Dibayar sampai sekarang ${rupiah(r.balance.paid)}`} />
        <Card>
          <Row title="Menunggu persetujuan pengurus" sub="penjualan sudah diterima pembeli" right={rupiah(r.balance.pending)} tone={r.balance.pending ? 'warn' : 'neutral'} />
          <Row title="Disetujui, siap dibayar" right={rupiah(r.balance.approved)} tone={r.balance.approved ? 'ok' : 'neutral'} />
          <Row title="Sudah dibayar" right={rupiah(r.balance.paid)} />
          <Row title="Dalam proses" sub={`${r.inProgress.orders} pesanan belum lunas/diterima · belum jadi komisi`} right={rupiah(r.inProgress.potentialCommission)} tone="neutral" />
        </Card>

        <Button label="+ Catat penjualan baru" kind="gold" onPress={() => router.push({ pathname: '/(member)/order', params: { mode: 'jual' } })} />
        <Note>Penjualan (ke pelanggan umum) masuk laporan setelah dicatat di aplikasi, disetujui toko, dibayar, dan diterima pelanggan. Angka tidak bisa diketik manual.</Note>
        <Text style={{ fontSize: 16, fontWeight: '600', color: C.green, marginTop: 6 }}>Penjualan per hari</Text>
        <Chips value={days} onChange={setDays} options={[{ v: '7', l: '7 hari' }, { v: '14', l: '14 hari' }, { v: '30', l: '30 hari' }]} />
        <Card>
          <Row title={`Total ${r.period.days} hari`} sub={`${r.period.ownOrders} pesanan · ${r.period.ownPacks} · omzet ${rupiah(r.period.ownTurnover)} · aktif ${r.period.activeDays} hari`} right={rupiah(r.period.total)} tone={r.period.total ? 'ok' : 'neutral'} />
          {r.days.map((d, i) => {
            const has = d.total > 0;
            const parts = [d.ownOrders ? `${d.ownOrders} pesanan · ${d.ownPacks} · omzet ${rupiah(d.ownTurnover)} · komisi ${rupiah(d.ownCommission)}` : null, d.networkCommission ? `jaringan +${rupiah(d.networkCommission)}` : null].filter(Boolean);
            return <Row key={d.date} title={`${dayLabel(d.date)}${i === 0 ? ' · hari ini' : ''}`} sub={parts.length ? parts.join(' · ') : 'Belum ada penjualan'} right={has ? rupiah(d.total) : '—'} tone={has ? 'ok' : 'neutral'} />;
          })}
        </Card>
        <View style={{ gap: 4 }}>
          <Note>Penjualan dihitung pada hari pembeli menerima barang ({r.timezone}), setelah pesanan lunas. Komisi: {rates[0]}% dari penjualan Anda, ditambah {rates.slice(1).join('/')}% dari penjualan downline tingkat 1–3 (tarif saat pesanan dibuat).</Note>
          <Note>Belanja untuk diri sendiri, dan pesanan batal tidak dihitung; anggota tidak menjual ke anggota lain. Komisi baru bisa dibayar setelah disetujui pengurus.</Note>
        </View>
      </>)}
    </Screen>
  );
}
