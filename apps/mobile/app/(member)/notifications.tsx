import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../../src/theme';
import { useShop } from '../../src/shopData';
import { BackBar } from '../../src/shop';
import { INFO_CATS, TRX_CATS, ago, useNotifs, type Notif, type NotifTab } from '../../src/notifData';

const BLUE = C.green;

function Tabs({ tab, onTab, info, trx }: { tab: NotifTab; onTab: (t: NotifTab) => void; info: number; trx: number }) {
  const items: [NotifTab, string, number][] = [['info', 'Informasi', info], ['trx', 'Transaksi', trx]];
  return (
    <View style={s.tabs}>
      {items.map(([k, label, n]) => (
        <Pressable key={k} onPress={() => onTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={[s.tab, tab === k && { borderBottomColor: BLUE }]}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: tab === k ? BLUE : C.muted }}>{label}</Text>
          {n > 0 && <View style={s.badge}><Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '700' }}>{n}</Text></View>}
        </Pressable>
      ))}
    </View>
  );
}

function Chips({ cats, value, onPick }: { cats: string[]; value: string; onPick: (c: string) => void }) {
  const renderItem = useCallback(({ item: c }: { item: string }) => (
    <Pressable onPress={() => onPick(c)} accessibilityRole="button" accessibilityState={{ selected: value === c }} style={[s.chip, value === c && { backgroundColor: BLUE }]}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: value === c ? '#ffffff' : BLUE }}>{c}</Text>
    </Pressable>
  ), [value, onPick]);
  return <FlatList horizontal data={cats} keyExtractor={(c) => c} renderItem={renderItem} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, padding: 16 }} style={{ flexGrow: 0 }} />;
}

function Row({ n, isNew, onPress }: { n: Notif; isNew: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[s.row, isNew && { backgroundColor: C.ok[0] }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={s.tag}>{n.cat}</Text>
        <Text style={{ color: C.muted, fontSize: 13 }}>{ago(n.at)}</Text>
      </View>
      <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink, marginTop: 8 }}>{n.title}</Text>
      <Text style={{ fontSize: 14, color: C.muted, marginTop: 4, lineHeight: 20 }}>{n.body}</Text>
    </Pressable>
  );
}

/** Notifikasi bergaya Klik Indomaret: tab Informasi/Transaksi, filter kategori, daftar kartu dengan waktu relatif. */
export default function Notifications() {
  const router = useRouter();
  const bottom = useSafeAreaInsets().bottom;
  const shop = useShop();
  const nf = useNotifs(shop.data?.products ?? []);
  const [tab, setTab] = useState<NotifTab>('info');
  const [cat, setCat] = useState('Semua');
  // Penanda "baru" memakai waktu baca sebelum halaman dibuka; ditandai terbaca saat ditinggalkan.
  const [opened, setOpened] = useState<number | null>(null);
  useEffect(() => { if (opened === null && nf.seen !== null) setOpened(nf.seen); }, [opened, nf.seen]);
  const { refetch, markSeen } = nf;
  useFocusEffect(useCallback(() => { refetch(); return () => markSeen(); }, [refetch, markSeen]));
  const cats = tab === 'info' ? INFO_CATS : TRX_CATS;
  const list = nf.items.filter((n) => n.tab === tab && (cat === 'Semua' || n.cat === cat));
  const renderItem = useCallback(({ item }: { item: Notif }) => <Row n={item} isNew={!!item.at && Date.parse(item.at) > (opened ?? Infinity)} onPress={() => router.push(item.to as never)} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, nf.items, opened]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BackBar title="Notifikasi" />
      <Tabs tab={tab} onTab={(t) => { setTab(t); setCat('Semua'); }} info={nf.unread('info')} trx={nf.unread('trx')} />
      <Chips cats={cats} value={cat} onPick={setCat} />
      {nf.loading ? <ActivityIndicator color={C.green} style={{ marginTop: 40 }} /> : nf.error ? <Text style={{ color: C.bad[1], padding: 16 }}>Gagal memuat: {nf.error.message}</Text> : (
        <FlatList data={list} keyExtractor={(n) => n.key} renderItem={renderItem} ListFooterComponent={<View style={{ height: bottom + 24 }} />}
          refreshControl={<RefreshControl refreshing={nf.refreshing} onRefresh={nf.refetch} />}
          ListEmptyComponent={<Text style={{ color: C.muted, textAlign: 'center', marginTop: 48 }}>Belum ada notifikasi</Text>} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: C.panel, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  badge: { backgroundColor: BLUE, minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  chip: { backgroundColor: C.ok[0], borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9 },
  row: { backgroundColor: C.panel, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  tag: { color: BLUE, fontWeight: '700', fontSize: 14, backgroundColor: C.ok[0], borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
});
