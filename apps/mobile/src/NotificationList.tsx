import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from './theme';
import type { ShopProduct } from './shopData';
import { BackBar } from './shop';
import { ago, catsFor, dayGroup, destination, iconOf, useNotifs, type Notif, type NotifTab } from './notifData';

function Tabs({ tab, onTab, info, trx }: { tab: NotifTab; onTab: (t: NotifTab) => void; info: number; trx: number }) {
  const items: [NotifTab, string, number][] = [['info', 'Informasi', info], ['trx', 'Transaksi', trx]];
  return (
    <View style={s.tabs}>
      {items.map(([k, label, n]) => (
        <Pressable key={k} onPress={() => onTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={[s.tab, tab === k && { borderBottomColor: C.green }]}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: tab === k ? C.green : C.muted }}>{label}</Text>
          {n > 0 && <View style={s.badge}><Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '700' }}>{n > 99 ? '99+' : n}</Text></View>}
        </Pressable>
      ))}
    </View>
  );
}

function Chips({ cats, value, onPick }: { cats: string[]; value: string; onPick: (c: string) => void }) {
  const renderItem = useCallback(({ item: c }: { item: string }) => (
    <Pressable onPress={() => onPick(c)} accessibilityRole="button" accessibilityState={{ selected: value === c }} style={[s.chip, value === c && { backgroundColor: C.green, borderColor: C.green }]}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: value === c ? '#ffffff' : C.ink }}>{c}</Text>
    </Pressable>
  ), [value, onPick]);
  return <FlatList horizontal data={cats} keyExtractor={(c) => c} renderItem={renderItem} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }} style={s.chips} />;
}

function Row({ n, onPress }: { n: Notif; onPress: (n: Notif) => void }) {
  const [icon, tone] = iconOf(n.cat);
  const unread = !n.read;
  return (
    <Pressable onPress={() => onPress(n)} accessibilityRole="button" accessibilityLabel={`${unread ? 'Belum dibaca. ' : ''}${n.title}`} style={[s.row, unread && { backgroundColor: '#f1f8f5' }]}>
      <View style={[s.icon, { backgroundColor: C[tone][0] }]}><Ionicons name={icon as never} size={22} color={C[tone][1]} /></View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={[s.title, unread && { fontWeight: '800' }]}>{n.title}</Text>
          {n.at ? <Text style={s.time}>{ago(n.at)}</Text> : null}
        </View>
        <Text numberOfLines={2} style={s.body}>{n.body}</Text>
      </View>
      {unread && <View style={s.dot} />}
    </Pressable>
  );
}

/** Kotak masuk notifikasi: tab Informasi/Transaksi, filter kategori, dikelompokkan per hari, status baca tersimpan di server. */
export function NotificationList({ products }: { products: ShopProduct[] }) {
  const router = useRouter();
  const bottom = useSafeAreaInsets().bottom;
  const nf = useNotifs(products);
  const [tab, setTab] = useState<NotifTab>('info');
  const [cat, setCat] = useState('Semua');
  const { refetch, markRead } = nf;
  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));
  const cats = useMemo(() => catsFor(nf.items, tab), [nf.items, tab]);
  const sections = useMemo(() => {
    const list = nf.items.filter((n) => n.tab === tab && (cat === 'Semua' || n.cat === cat));
    const g = new Map<string, Notif[]>();
    for (const n of list) g.set(dayGroup(n.at), [...(g.get(dayGroup(n.at)) ?? []), n]);
    return ['Hari ini', 'Kemarin', 'Sebelumnya', 'Promo berjalan'].filter((k) => g.has(k)).map((title) => ({ title, data: g.get(title)! }));
  }, [nf.items, tab, cat]);
  const open = useCallback((n: Notif) => {
    if (n.id && !n.read) void markRead([n.id]);
    router.push(destination(n) as never);
  }, [markRead, router]);
  const renderItem = useCallback(({ item }: { item: Notif }) => <Row n={item} onPress={open} />, [open]);
  const total = nf.unread();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BackBar title="Notifikasi">
        <Pressable onPress={() => void markRead()} disabled={total === 0} hitSlop={10} accessibilityRole="button" accessibilityLabel="Tandai semua dibaca" style={{ opacity: total === 0 ? 0.35 : 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="checkmark-done-outline" size={20} color={C.green} />
          <Text style={{ color: C.green, fontWeight: '700', fontSize: 13 }}>Tandai dibaca</Text>
        </Pressable>
      </BackBar>
      <Tabs tab={tab} onTab={(t) => { setTab(t); setCat('Semua'); }} info={nf.unread('info')} trx={nf.unread('trx')} />
      <Chips cats={cats} value={cat} onPick={setCat} />
      {nf.loading ? <ActivityIndicator color={C.green} style={{ marginTop: 40 }} /> : nf.error ? <Text style={{ color: C.bad[1], padding: 16 }}>Gagal memuat: {nf.error.message}</Text> : (
        <SectionList sections={sections} keyExtractor={(n) => n.key} renderItem={renderItem}
          renderSectionHeader={({ section }) => <Text style={s.section}>{section.title}</Text>}
          stickySectionHeadersEnabled={false}
          ListFooterComponent={<View style={{ height: bottom + 24 }} />}
          refreshControl={<RefreshControl refreshing={nf.refreshing} onRefresh={nf.refetch} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 64, gap: 8 }}>
              <Ionicons name="notifications-off-outline" size={44} color={C.line} />
              <Text style={{ color: C.muted }}>Belum ada notifikasi</Text>
            </View>} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: C.panel, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  badge: { backgroundColor: C.gold, minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  chips: { flexGrow: 0, backgroundColor: C.panel, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  chip: { backgroundColor: C.panel, borderRadius: 18, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 7 },
  section: { fontSize: 12, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: C.ink },
  time: { fontSize: 12, color: C.muted },
  body: { fontSize: 13, color: C.muted, marginTop: 3, lineHeight: 18 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.gold },
});
