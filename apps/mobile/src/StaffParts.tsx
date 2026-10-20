import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from './theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Kepala hijau melengkung halaman petugas: sapaan, nama, dan toko tempat bertugas. */
export function StaffHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  const top = useSafeAreaInsets().top;
  return (
    <View style={[s.header, { paddingTop: top + 14 }]}>
      <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '700' }} numberOfLines={1}>{title}</Text>
      {subtitle ? <Text style={{ color: '#ffffff', opacity: 0.85, fontSize: 14, marginTop: 2 }} numberOfLines={1}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

export interface Tile { key: string; label: string; n: number; icon: IconName; hot?: boolean; onPress: () => void }

/** Kartu angka tugas: dua kolom, merah-keemasan bila ada yang menunggu. */
export function TaskTiles({ items }: { items: Tile[] }) {
  return (
    <View style={s.tiles}>
      {items.map((t) => (
        <Pressable key={t.key} onPress={t.onPress} accessibilityRole="button" accessibilityLabel={`${t.label}: ${t.n}`} style={s.tile}>
          <View style={[s.tileIcon, t.n > 0 && t.hot && { backgroundColor: C.warn[0] }]}><Ionicons name={t.icon} size={20} color={t.n > 0 && t.hot ? C.warn[1] : C.green} /></View>
          <Text style={{ color: C.ink, fontSize: 26, fontWeight: '700', marginTop: 8 }}>{t.n}</Text>
          <Text style={{ color: C.muted, fontSize: 13 }}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export interface Action { key: string; label: string; icon: IconName; onPress: () => void }

/** Baris menu pintas bulat bergaya "Kategori Belanja". */
export function ActionRow({ items }: { items: Action[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {items.map((x) => (
        <Pressable key={x.key} onPress={x.onPress} accessibilityRole="button" style={s.action}>
          <View style={s.actionIcon}><Ionicons name={x.icon} size={22} color={C.green} /></View>
          <Text style={{ color: C.ink, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{x.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Lencana status kecil (hijau/emas/merah) dengan teks. */
export function StatusChip({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'bad' }) {
  const [bg, fg] = tone === 'ok' ? ['#d9f5dd', '#1b6b2a'] : tone === 'warn' ? [C.warn[0], C.warn[1]] : [C.bad[0], C.bad[1]];
  return <Text style={[s.chip, { backgroundColor: bg, color: fg }]}>{label}</Text>;
}

const s = StyleSheet.create({
  header: { backgroundColor: C.side, paddingHorizontal: 16, paddingBottom: 56, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48.5%', backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14 },
  tileIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.ok[0], alignItems: 'center', justifyContent: 'center' },
  action: { flex: 1, backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 12, paddingHorizontal: 4, alignItems: 'center', gap: 8 },
  actionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.ok[0], alignItems: 'center', justifyContent: 'center' },
  chip: { fontSize: 12, fontWeight: '600', borderRadius: 4, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
});
