import { useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useData, rupiah } from '../../src/hooks';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../../src/theme';
import { Card, Row } from '../../src/ui';

interface Entry { id: string; day: string; seq: number; due: number; paid: number; arrearsAfter: number; refNo: string | null }
interface Installments { amount: number; totalDays: number; paidDays: number; remainingDays: number; arrears: number; remainingAmount: number; status: 'belum_mulai' | 'berjalan' | 'lunas'; chargedToday: boolean; entries: Entry[] }

const day = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const STATUS = { belum_mulai: 'Belum mulai', berjalan: 'Berjalan', lunas: 'Lunas' } as const;

function Progress({ i }: { i: Installments }) {
  const pct = Math.min(1, i.paidDays / i.totalDays);
  const years = (i.remainingDays / 365).toFixed(1).replace('.', ',');
  return (
    <View style={s.hero}>
      <Text style={{ color: '#ffffff', opacity: 0.85, fontSize: 13 }}>Tagihan harian · {STATUS[i.status]}</Text>
      <Text style={{ color: '#ffffff', fontSize: 30, fontWeight: '700' }}>{i.paidDays} <Text style={{ fontSize: 16, fontWeight: '500' }}>dari {i.totalDays} hari aktif</Text></Text>
      <View style={s.track}><View style={[s.fill, { width: `${pct * 100}%` }]} /></View>
      <Text style={{ color: C.gold, fontSize: 12, marginTop: 6 }}>{i.status === 'lunas' ? 'Selamat, tagihan sudah lunas.' : `Sisa ${i.remainingDays} hari aktif (±${years} tahun bila aktif tiap hari)`}</Text>
    </View>
  );
}

/** Tagihan harian: Rp30.000/hari aktif dari saldo penarikan selama 730 hari aktif; hari tanpa belanja dilewati sehingga tenor memanjang. */
export default function InstallmentsScreen() {
  const q = useData<Installments>('/me/installments');
  const { refetch } = q;
  const top = useSafeAreaInsets().top;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const i = q.data;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingTop: top + 12, paddingHorizontal: 16, paddingBottom: 14 }}><Text style={{ fontSize: 24, fontWeight: '700', color: C.ink }}>Tagihan Harian</Text></View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void refetch()} />}>
        {!i ? (q.error ? <Text style={{ color: C.bad[1] }}>Gagal memuat: {(q.error as Error).message}</Text> : <ActivityIndicator color={C.green} style={{ marginTop: 40 }} />) : (<>
          <Progress i={i} />
          <Card>
            <Row title="Setoran per hari aktif" right={rupiah(i.amount)} />
            <Row title="Sisa tagihan" sub={`${i.remainingDays} hari × ${rupiah(i.amount)}${i.arrears ? ` + tunggakan ${rupiah(i.arrears)}` : ''}`} right={rupiah(i.remainingAmount)} />
            <Row title="Tunggakan" sub="Dipotong otomatis dari imbalan berikutnya" right={rupiah(i.arrears)} tone={i.arrears ? 'bad' : 'ok'} />
            <Row title="Hari ini" right={i.chargedToday ? 'Sudah dipotong' : 'Belum ada transaksi'} tone={i.chargedToday ? 'ok' : 'warn'} />
          </Card>
          <View style={s.note}>
            <Text style={{ color: C.ink, fontWeight: '700', marginBottom: 4 }}>Cara kerjanya</Text>
            <Text style={s.p}>• Tiap hari ada belanja sendiri yang <Text style={{ fontWeight: '700' }}>diterima</Text>, saldo penarikan dipotong {rupiah(i.amount)} (sekali per hari).</Text>
            <Text style={s.p}>• Hari tanpa transaksi dilewati. Makin jarang belanja, makin panjang waktu pelunasan.</Text>
            <Text style={s.p}>• Bila saldo penarikan kurang, hari itu tetap terhitung dan kekurangannya jadi tunggakan yang dipotong lebih dulu dari imbalan berikutnya.</Text>
            <Text style={s.p}>• Lunas setelah {i.totalDays} hari aktif dan tidak ada tunggakan.</Text>
          </View>
          <Text style={s.h}>Riwayat potongan</Text>
          <Card>
            {i.entries.length === 0 ? <Row title="Belum ada potongan" sub="Mulai saat belanja sendiri pertama diterima." /> : i.entries.map((e) => (
              <Row key={e.id} title={e.seq ? `Hari aktif ke-${e.seq}` : 'Pelunasan tunggakan'} sub={`${day(e.day)}${e.refNo ? ` · ${e.refNo}` : ''}${e.arrearsAfter ? ` · tunggakan ${rupiah(e.arrearsAfter)}` : ''}`} right={`−${rupiah(e.paid)}`} tone={e.paid < e.due ? 'warn' : 'neutral'} />
            ))}
          </Card>
        </>)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: C.side, borderRadius: 14, padding: 18, gap: 4 },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden', marginTop: 8 },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.gold },
  note: { backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14, gap: 6 },
  p: { color: C.muted, fontSize: 13, lineHeight: 19 },
  h: { fontSize: 17, fontWeight: '700', color: C.ink, marginTop: 6 },
});
