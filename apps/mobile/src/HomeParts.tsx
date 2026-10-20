import { useCallback, useState, type ComponentProps } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from './theme';
import { mono, rupiah } from './hooks';
import { CoinIcon } from './CoinIcon';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Kepala hijau melengkung: sapaan, kolom cari (membuka halaman belanja), dan lonceng notifikasi. */
export function HomeHeader({ name, onSearch, onBell, badge }: { name: string; onSearch: () => void; onBell: () => void; badge: number }) {
  const top = useSafeAreaInsets().top;
  return (
    <View style={[s.header, { paddingTop: top + 12 }]}>
      <Text style={{ color: '#ffffff', opacity: 0.85, fontSize: 13 }}>Selamat datang,</Text>
      <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '700', marginBottom: 12 }} numberOfLines={1}>{name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable onPress={onSearch} accessibilityRole="search" style={s.search}>
          <Ionicons name="search" size={20} color={C.muted} />
          <TextInput editable={false} pointerEvents="none" placeholder="Cari barang di Sajadah" placeholderTextColor={C.muted} style={{ flex: 1, fontSize: 15, color: C.ink }} />
        </Pressable>
        <Pressable onPress={onBell} accessibilityLabel="Notifikasi" hitSlop={8} style={s.bell}>
          <Ionicons name="notifications-outline" size={22} color="#ffffff" />
          {badge > 0 && <View style={s.badge}><Text style={{ color: C.ink, fontSize: 10, fontWeight: '700' }}>{badge}</Text></View>}
        </Pressable>
      </View>
    </View>
  );
}

function Money({ label, value, hidden }: { label: string; value: number; hidden: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: C.muted, fontSize: 12 }}>{label}</Text>
      <Text style={[{ color: C.ink, fontSize: 18, fontWeight: '700', marginTop: 2 }, mono]}>{hidden ? 'Rp ••••••' : rupiah(value)}</Text>
    </View>
  );
}

/** Dompet: saldo belanja dan saldo penarikan berdampingan (ketuk saldo penarikan untuk tarik/pindah), dengan tombol sembunyikan saldo. */
export function WalletCard({ balance, reward, coins, active, onReward, onCoins }: { balance: number; reward: number; coins: number; active: boolean; onReward: () => void; onCoins: () => void }) {
  const [hidden, setHidden] = useState(false);
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Money label="Saldo belanja" value={balance} hidden={hidden} />
        <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: C.line }} />
        <Pressable onPress={onReward} accessibilityRole="button" accessibilityLabel="Saldo penarikan" style={{ flex: 1 }}>
          <Money label="Saldo penarikan ›" value={reward} hidden={hidden} />
        </Pressable>
        <Pressable onPress={() => setHidden((v) => !v)} hitSlop={10} accessibilityLabel={hidden ? 'Tampilkan saldo' : 'Sembunyikan saldo'}>
          <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={24} color={C.muted} />
        </Pressable>
      </View>
      <Pressable onPress={onCoins} accessibilityRole="button" accessibilityLabel="Koin Sajadah" style={s.coinRow}>
        <CoinIcon size={22} />
        <Text style={{ flex: 1, color: C.ink, fontWeight: '600' }}>Koin Sajadah</Text>
        <Text style={{ color: C.goldInk, fontWeight: '700' }}>{hidden ? '••••' : coins}</Text>
        <Ionicons name="chevron-forward" size={18} color={C.muted} />
      </Pressable>
      {!active && <Text style={{ color: C.warn[1], backgroundColor: C.warn[0], borderRadius: 8, padding: 8, fontSize: 12, marginTop: 10 }}>Saldo belanja belum aktif. Hubungi pengurus koperasi untuk aktivasi.</Text>}
    </View>
  );
}

export interface Banner { key: string; title: string; text: string; icon: IconName; gold?: boolean }

/** Barisan kartu yang bisa digeser mendatar (tepi ke tepi layar). */
export function HList<T extends { key: string }>({ items, render }: { items: T[]; render: (x: T) => React.ReactElement }) {
  const renderItem = useCallback(({ item }: { item: T }) => render(item), [render]);
  return <FlatList horizontal data={items} keyExtractor={(x) => x.key} renderItem={renderItem} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }} style={{ marginHorizontal: -16 }} />;
}

/** Spanduk geser mendatar berisi ringkasan penting (komisi hari ini, kode referal, dll). */
export function Banners({ items }: { items: Banner[] }) {
  return (
    <HList items={items} render={(b) => (
        <View style={[s.banner, { backgroundColor: b.gold ? C.gold : C.green }]}>
          <Ionicons name={b.icon} size={64} color={b.gold ? C.goldInk : '#ffffff'} style={{ position: 'absolute', right: 12, bottom: 8, opacity: 0.18 }} />
          <Text style={{ color: b.gold ? C.ink : '#ffffff', fontWeight: '700', fontSize: 16 }}>{b.title}</Text>
          <Text style={{ color: b.gold ? C.ink : '#ffffff', opacity: 0.9, fontSize: 13, marginTop: 4 }}>{b.text}</Text>
        </View>
      )} />
  );
}

export interface Shortcut { key: string; label: string; icon: IconName; onPress: () => void }

/** Menu pintas bergaya "Kategori Belanja": kartu ikon yang bisa digeser. */
export function ShortcutRow({ items }: { items: Shortcut[] }) {
  return (
    <HList items={items} render={(x) => (
        <Pressable onPress={x.onPress} accessibilityRole="button" style={s.shortcut}>
          <View style={s.shortcutIcon}><Ionicons name={x.icon} size={22} color={C.green} /></View>
          <Text style={{ color: C.ink, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{x.label}</Text>
        </Pressable>
      )} />
  );
}

export const SectionTitle = ({ children, action, onAction }: { children: string; action?: string; onAction?: () => void }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
    <Text style={{ fontWeight: '700', fontSize: 17, color: C.ink }}>{children}</Text>
    {action ? <Pressable onPress={onAction} hitSlop={8}><Text style={{ color: C.green, fontWeight: '600', fontSize: 13 }}>{action}</Text></Pressable> : null}
  </View>
);

export interface Status { key: string; title: string; n: number; sub: string }

/** Kartu status pesanan berjalan (seperti Live Shopping): satu kartu per tahap. */
export function StatusCards({ items, onPress }: { items: Status[]; onPress: () => void }) {
  if (items.length === 0) return <Text style={{ color: C.muted, fontSize: 13 }}>Tidak ada pesanan yang sedang berjalan.</Text>;
  return (
    <HList items={items} render={(x) => (
        <Pressable onPress={onPress} accessibilityRole="button" style={s.status}>
          <Text style={{ color: C.green, fontSize: 30, fontWeight: '700' }}>{x.n}</Text>
          <Text style={{ color: C.ink, fontWeight: '600', fontSize: 13 }}>{x.title}</Text>
          <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{x.sub}</Text>
        </Pressable>
      )} />
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: C.side, paddingHorizontal: 16, paddingBottom: 56, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ffffff', borderRadius: 12, paddingHorizontal: 12, height: 46 },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  bell: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 14 },
  card: { backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14 },
  banner: { width: 290, minHeight: 104, borderRadius: 14, padding: 16, overflow: 'hidden', justifyContent: 'center' },
  shortcut: { width: 92, backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 10, alignItems: 'center', gap: 8 },
  shortcutIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.ok[0], alignItems: 'center', justifyContent: 'center' },
  status: { width: 160, backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 12 },
});
