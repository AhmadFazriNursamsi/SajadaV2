import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useData } from '../../src/hooks';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../../src/theme';

interface Installments { totalDays: number; paidDays: number; status: 'belum_mulai' | 'berjalan' | 'lunas'; today: string; startDay: string | null; paidDates: string[] }

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const OK_BG = '#1f9d55';
const SKIP_BG = '#d64545';

const key = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Satu bulan penuh: hijau = hari aktif yang sudah tercatat, merah = hari terlewat tanpa transaksi (setelah tagihan mulai), putih = hari ini dan mendatang. */
function Month({ y, m, i, paid }: { y: number; m: number; i: Installments; paid: Set<string> }) {
  const first = (new Date(y, m, 1).getDay() + 6) % 7; // Senin = 0
  const count = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: count }, (_, k) => k + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  return (
    <View>
      <View style={s.week}>{WEEKDAYS.map((w) => <Text key={w} style={s.wd}>{w}</Text>)}</View>
      {weeks.map((wk, wi) => (
        <View key={wi} style={s.week}>
          {wk.map((d, di) => {
            if (!d) return <View key={di} style={s.cell} />;
            const k = key(y, m, d);
            const state = paid.has(k) ? 'ok' : i.startDay && k > i.startDay && k < i.today ? 'skip' : 'none';
            const today = k === i.today;
            return (
              <View key={di} style={s.cell}>
                <View style={[s.day, state === 'ok' && { backgroundColor: OK_BG, borderColor: OK_BG }, state === 'skip' && { backgroundColor: SKIP_BG, borderColor: SKIP_BG }, today && state === 'none' && { borderColor: C.green, borderWidth: 2 }]}>
                  <Text style={[s.dn, state !== 'none' && { color: '#ffffff', fontWeight: '700' }]}>{d}</Text>
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function Dot({ bg, label, line }: { bg: string; label: string; line?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: bg, borderWidth: line ? 1 : 0, borderColor: C.line }} />
      <Text style={{ color: C.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Legend() {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 }}>
      <Dot bg={OK_BG} label="Sudah tercatat" />
      <Dot bg={SKIP_BG} label="Terlewat" />
      <Dot bg="#ffffff" label="Hari mendatang" line />
    </View>
  );
}

/** Tagihan harian dalam bentuk kalender; nominal dan sisa tagihan sengaja tidak ditampilkan agar anggota tidak merasa terbebani. */
export default function InstallmentsScreen() {
  const q = useData<Installments>('/me/installments');
  const { refetch } = q;
  const top = useSafeAreaInsets().top;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const i = q.data;
  const nowY = i ? Number(i.today.slice(0, 4)) : new Date().getFullYear();
  const nowM = i ? Number(i.today.slice(5, 7)) - 1 : new Date().getMonth();
  const [shift, setShift] = useState(0); // 0 = bulan ini, negatif = bulan lalu
  const paid = useMemo(() => new Set(i?.paidDates ?? []), [i]);
  // Geser kalender ke kiri = bulan berikutnya, ke kanan = bulan sebelumnya.
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderRelease: (_e, g) => { if (Math.abs(g.dx) > 40) setShift((v) => v + (g.dx < 0 ? 1 : -1)); },
  }), []);
  const idx = nowY * 12 + nowM + shift;
  const y = Math.floor(idx / 12), m = idx % 12;
  const pct = i ? Math.min(1, i.paidDays / i.totalDays) : 0;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingTop: top + 12, paddingHorizontal: 16, paddingBottom: 14 }}><Text style={{ fontSize: 24, fontWeight: '700', color: C.ink }}>Tagihan Harian</Text></View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void refetch()} />}>
        {!i ? (q.error ? <Text style={{ color: C.bad[1] }}>Gagal memuat: {(q.error as Error).message}</Text> : <ActivityIndicator color={C.green} style={{ marginTop: 40 }} />) : (<>
          <View style={s.hero}>
            <Text style={{ color: '#ffffff', opacity: 0.85, fontSize: 13 }}>{i.status === 'lunas' ? 'Selamat, sudah selesai' : 'Perjalanan Anda'}</Text>
            <Text style={{ color: '#ffffff', fontSize: 30, fontWeight: '700' }}>{i.paidDays} <Text style={{ fontSize: 16, fontWeight: '500' }}>dari {i.totalDays} hari aktif</Text></Text>
            <View style={s.track}><View style={[s.fill, { width: `${pct * 100}%` }]} /></View>
          </View>
          <View style={s.card} {...swipe.panHandlers}>
            <View style={s.nav}>
              <Pressable onPress={() => setShift((v) => v - 1)} hitSlop={10} accessibilityLabel="Bulan sebelumnya" style={s.arrow}><Text style={s.arrowT}>‹</Text></Pressable>
              <Pressable onPress={() => setShift(0)} disabled={shift === 0} accessibilityLabel="Kembali ke bulan ini" style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink }}>{MONTHS[m]} {y}</Text>
                {shift !== 0 && <Text style={{ fontSize: 11, color: C.green, fontWeight: '600' }}>Ketuk untuk ke bulan ini</Text>}
              </Pressable>
              <Pressable onPress={() => setShift((v) => v + 1)} hitSlop={10} accessibilityLabel="Bulan berikutnya" style={s.arrow}><Text style={s.arrowT}>›</Text></Pressable>
            </View>
            <Month y={y} m={m} i={i} paid={paid} />
            <Legend />
          </View>
          <View style={s.note}>
            <Text style={s.p}>Tanggal hijau adalah hari ketika belanja Anda diterima. Hari tanpa belanja ditandai merah dan tidak apa-apa; kalender hanya menggeser waktunya, tidak ada denda.</Text>
          </View>
        </>)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: C.side, borderRadius: 14, padding: 18, gap: 4 },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden', marginTop: 8 },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.gold },
  card: { backgroundColor: '#ffffff', borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  arrow: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  arrowT: { fontSize: 22, color: C.ink, lineHeight: 26 },
  week: { flexDirection: 'row' },
  wd: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: C.muted, paddingBottom: 6 },
  cell: { flex: 1, aspectRatio: 1, padding: 2 },
  day: { flex: 1, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  dn: { fontSize: 13, color: C.ink },
  note: { backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14 },
  p: { color: C.muted, fontSize: 13, lineHeight: 19 },
});
