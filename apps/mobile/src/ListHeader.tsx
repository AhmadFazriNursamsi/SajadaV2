import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from './theme';

export function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[s.pill, active && { borderColor: C.green, backgroundColor: C.ok[0] }]}>
      <Text style={{ color: active ? C.green : C.muted, fontSize: 15, fontWeight: active ? '700' : '400' }}>{label}</Text>
      <Ionicons name="chevron-down" size={16} color={active ? C.green : C.muted} />
    </Pressable>
  );
}

export function Header({ title, placeholder, searching, q, onQ, onToggle }: { title: string; placeholder: string; searching: boolean; q: string; onQ: (v: string) => void; onToggle: () => void }) {
  const top = useSafeAreaInsets().top;
  return (
    <View style={[s.header, { paddingTop: top + 12 }]}>
      {searching ? (
        <View style={s.search}>
          <Ionicons name="search" size={18} color={C.muted} />
          <TextInput value={q} onChangeText={onQ} autoFocus placeholder={placeholder} placeholderTextColor={C.muted} style={{ flex: 1, fontSize: 15, color: C.ink, paddingVertical: 0 }} />
        </View>
      ) : <Text style={{ flex: 1, fontSize: 24, fontWeight: '700', color: C.ink }}>{title}</Text>}
      <Pressable onPress={onToggle} hitSlop={10} accessibilityLabel={searching ? 'Tutup pencarian' : 'Cari transaksi'}><Ionicons name={searching ? 'close' : 'search'} size={26} color={C.ink} /></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: C.bg },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ffffff', borderRadius: 10, paddingHorizontal: 10, height: 42, borderWidth: 1, borderColor: C.line },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
});
