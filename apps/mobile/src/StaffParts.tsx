import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { C } from './theme';
import { useNotifs } from './notifData';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Lonceng notifikasi di kepala halaman petugas, dengan jumlah yang belum dibaca. */
export function StaffBell() {
  const router = useRouter();
  const n = useNotifs([]).unread();
  return (
    <Pressable onPress={() => router.push('/(staff)/notifications' as never)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Notifikasi, ${n} belum dibaca`} style={s.bell}>
      <Ionicons name="notifications-outline" size={24} color="#ffffff" />
      {n > 0 && <View style={s.bellBadge}><Text style={{ color: C.ink, fontSize: 10, fontWeight: '800' }}>{n > 99 ? '99+' : n}</Text></View>}
    </Pressable>
  );
}

/** Kepala hijau melengkung halaman petugas: sapaan, nama, dan toko tempat bertugas. */
export function StaffHeader({ title, subtitle, bell, children }: { title: string; subtitle?: string; bell?: boolean; children?: React.ReactNode }) {
  const top = useSafeAreaInsets().top;
  return (
    <View style={[s.header, { paddingTop: top + 14 }]}>
      {bell && <View style={{ position: 'absolute', right: 16, top: top + 12 }}><StaffBell /></View>}
      <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '700', paddingRight: bell ? 44 : 0 }} numberOfLines={1}>{title}</Text>
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
  bell: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  bellBadge: { position: 'absolute', top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48.5%', backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14 },
  tileIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.ok[0], alignItems: 'center', justifyContent: 'center' },
  action: { flex: 1, backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 12, paddingHorizontal: 4, alignItems: 'center', gap: 8 },
  actionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.ok[0], alignItems: 'center', justifyContent: 'center' },
  chip: { fontSize: 12, fontWeight: '600', borderRadius: 4, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
});
