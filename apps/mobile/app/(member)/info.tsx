import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INITIAL_BUDGET, PARTICIPATION_TOTAL, SHOPPING_BALANCE } from '@sajadah/shared';
import { C } from '../../src/theme';
import { rupiah } from '../../src/hooks';
import { BackBar } from '../../src/shop';

const BUDGET_TOTAL = PARTICIPATION_TOTAL - SHOPPING_BALANCE;
const ROWS: [string, number, string][] = [
  ['Saldo belanja koperasi', SHOPPING_BALANCE, 'Tidak untuk tarik tunai atau cicil emas'],
  ['Anggaran HP Android', INITIAL_BUDGET.hpAndroid, 'Anggaran awal, bukan bukti pembelian HP'],
  ['Iuran wajib', INITIAL_BUDGET.mandatoryDues, 'Bagian paket awal'],
  ['Iuran bulanan pertama', INITIAL_BUDGET.firstMonthlyDues, 'Belum ada penagihan bulanan otomatis'],
  ['Kostum komunitas', INITIAL_BUDGET.costume, 'Anggaran kostum'],
  ['Aplikasi', INITIAL_BUDGET.application, 'Bagian biaya aplikasi'],
];

function Check({ children }: { children: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Ionicons name="checkmark" size={20} color={C.green} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, fontSize: 15, color: C.ink, lineHeight: 22 }}>{children}</Text>
    </View>
  );
}

function Line({ name, value, note }: { name: string; value: number; note: string }) {
  return (
    <View style={s.line}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.ink, fontWeight: '600', fontSize: 15 }}>{name}</Text>
        <Text style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{note}</Text>
      </View>
      <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{rupiah(value)}</Text>
    </View>
  );
}

/** Informasi koperasi: penyertaan anggota dan rincian saldo belanja serta anggaran awal. */
export default function Info() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BackBar title="Informasi" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: C.green }}>SAJADAH Koperasi Digital</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color: C.green, letterSpacing: 0.3 }}>PENYERTAAN DAN SALDO BELANJA ANGGOTA</Text>
        <Text style={{ fontSize: 16, color: C.ink, lineHeight: 24 }}>Basis penyertaan setiap anggota tetap <Text style={{ fontWeight: '700' }}>{rupiah(PARTICIPATION_TOTAL)}</Text></Text>
        <View style={{ gap: 10 }}>
          <Check>{`${rupiah(SHOPPING_BALANCE)} menjadi saldo belanja yang hanya dipakai untuk pesanan koperasi`}</Check>
          <Check>{`${rupiah(BUDGET_TOTAL)} menjadi anggaran awal`}</Check>
        </View>
        <View style={s.table}>
          <View style={s.head}><Text style={{ color: '#ffffff', fontWeight: '700' }}>Komponen</Text><Text style={{ color: '#ffffff', fontWeight: '700' }}>Nilai IDR</Text></View>
          {ROWS.map(([name, value, note]) => <Line key={name} name={name} value={value} note={note} />)}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  table: { backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, overflow: 'hidden', marginTop: 4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.green, paddingHorizontal: 14, paddingVertical: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
});
