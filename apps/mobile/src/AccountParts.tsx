import type { ComponentProps } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from './theme';
import { mono, rupiah } from './hooks';
import { apiBase } from './api';
import { CoinIcon } from './CoinIcon';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Foto profil bulat; bila belum ada, inisial nama. */
export function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (url) return <Image source={{ uri: apiBase() + url }} accessibilityLabel={`Foto ${name}`} style={[box, { backgroundColor: '#e0ebe8' }]} />;
  return <View style={[s.avatar, box]}><Text style={{ color: C.green, fontSize: size * 0.36, fontWeight: '700' }}>{(name.trim()[0] ?? '?').toUpperCase()}</Text></View>;
}

/** Kepala hijau "Akun Saya": avatar inisial, nama, nomor HP, nomor anggota, dan ajakan melengkapi profil. */
export function AccountHeader({ name, avatarUrl, phone, family, memberNo, complete, onComplete }: { name: string; avatarUrl: string | null; family: string | null; phone: string | null; memberNo: string | null; complete: boolean; onComplete: () => void }) {
  const top = useSafeAreaInsets().top;
  return (
    <View style={[s.header, { paddingTop: top + 16 }]}>
      <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '700', marginBottom: 14 }}>Akun Saya</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Pressable onPress={onComplete} accessibilityLabel="Ubah foto profil"><Avatar name={name} url={avatarUrl} size={84} /></Pressable>
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={{ color: '#ffffff', fontSize: 20, fontWeight: '700' }}>{name}</Text>
          <Text style={{ color: '#ffffff', fontSize: 15 }}>{phone ?? 'Nomor HP belum diisi'}</Text>
          <Text style={[{ color: C.gold, fontSize: 13, fontWeight: '600' }, mono]}>{memberNo ?? 'Belum bernomor'}</Text>
          <Text style={{ color: '#ffffff', fontSize: 13 }}>{family ? `Status keluarga: ${family}` : 'Status keluarga belum diisi'}</Text>
          {!complete && <Pressable onPress={onComplete} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Text style={{ color: '#ffffff', fontSize: 13 }}>Lengkapi profil kamu</Text><Ionicons name="chevron-forward" size={16} color="#ffffff" /></Pressable>}
        </View>
      </View>
    </View>
  );
}

function Balance({ icon, label, value, action, onPress }: { icon: IconName; label: string; value: number; action: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ flex: 1, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={s.dot}><Ionicons name={icon} size={18} color={C.green} /></View>
        <Text style={{ color: C.muted, fontSize: 13 }}>{label}</Text>
      </View>
      <Text style={[{ color: C.ink, fontSize: 17, fontWeight: '700' }, mono]}>{rupiah(value)}</Text>
      <Text style={{ color: C.green, fontSize: 13, fontWeight: '600' }}>{action}</Text>
    </Pressable>
  );
}

/** Kartu saldo di kepala: saldo belanja dan saldo penarikan berdampingan, menimpa tepi bawah kepala hijau. */
export function BalanceCard({ balance, active, reward, coins, onReward, onCoins }: { balance: number; active: boolean; reward: number; coins: number; onReward: () => void; onCoins: () => void }) {
  return (
    <View style={s.card}>
      <Text style={{ color: C.ink, fontSize: 16, fontWeight: '700', marginBottom: 12 }}>Saldo Saya</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Balance icon="wallet-outline" label="Saldo belanja" value={balance} action={active ? 'Aktif' : 'Belum aktif'} onPress={() => undefined} />
        <View style={{ width: 1, backgroundColor: C.line }} />
        <Balance icon="cash-outline" label="Saldo penarikan" value={reward} action="Tarik / pindahkan ›" onPress={onReward} />
      </View>
      <Pressable onPress={onCoins} accessibilityRole="button" accessibilityLabel="Koin Sajadah" style={s.coinRow}>
        <CoinIcon size={22} />
        <Text style={{ flex: 1, color: C.ink, fontWeight: '600' }}>Koin Sajadah</Text>
        <Text style={{ color: C.goldInk, fontWeight: '700' }}>{coins}</Text>
        <Ionicons name="chevron-forward" size={18} color={C.muted} />
      </Pressable>
    </View>
  );
}

/** Kemajuan kelengkapan profil (nama, nomor HP, alamat). */
export function ProfileProgress({ done, total, hint, onPress }: { done: number; total: number; hint: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={s.plain}>
      <Text style={{ color: C.ink, fontSize: 16, fontWeight: '700' }}>Lengkapi profil kamu</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <View style={s.track}><View style={[s.fill, { width: `${Math.round((done / total) * 100)}%` }]} /></View>
        <Text style={{ color: C.ink, fontWeight: '600' }}>{done}/{total}</Text>
        <Ionicons name="chevron-forward" size={18} color={C.green} />
      </View>
      <Text style={{ color: C.muted, fontSize: 13, marginTop: 8 }}>{hint}</Text>
    </Pressable>
  );
}

export const SectionHead = ({ children }: { children: string }) => <Text style={{ color: C.ink, fontSize: 18, fontWeight: '700', marginTop: 8 }}>{children}</Text>;

/** Baris menu pengaturan: judul, keterangan, dan panah ke kanan. */
export function MenuRow({ title, sub, onPress, danger }: { title: string; sub?: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={s.menu}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: danger ? C.bad[1] : C.ink, fontSize: 16 }}>{title}</Text>
        {sub ? <Text style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={C.muted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: C.side, paddingHorizontal: 16, paddingBottom: 56 },
  avatar: { backgroundColor: '#e0ebe8', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.panel, borderRadius: 12, padding: 16, marginHorizontal: 16, marginTop: -40, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  dot: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.ok[0], alignItems: 'center', justifyContent: 'center' },
  plain: { backgroundColor: C.panel, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.line },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.neutral[0], overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.green },
  menu: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
});
