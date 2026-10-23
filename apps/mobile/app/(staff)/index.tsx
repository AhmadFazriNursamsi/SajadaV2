import { useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useData } from '../../src/hooks';
import { useSession } from '../../src/session';
import { ProductImage } from '../../src/shop';
import { ActionRow, OpnameNotice, StaffHeader, StatusChip, TaskTiles, type Action, type Tile } from '../../src/StaffParts';
import { SectionTitle } from '../../src/HomeParts';
import { C } from '../../src/theme';

interface Tasks { tenant: { name: string; depotName: string }; actions: { paidNotShipped: number; memberReports: number; pendingVerification: number; stockRequestsPending: number; awaitingApproval: number } }
interface Prod { id: string; name: string; image: string | null; available: number; safety: number; active: boolean }

function LowStock({ items }: { items: Prod[] }) {
  if (items.length === 0) return <Text style={{ color: C.muted, fontSize: 13 }}>Semua stok aman.</Text>;
  return (
    <View style={{ backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden' }}>
      {items.map((p, i) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
          <ProductImage p={{ name: p.name, imageUrl: p.image ? `/api/products/image/${p.image}` : null }} size={48} radius={6} />
          <Text style={{ flex: 1, color: C.ink, fontWeight: '600' }} numberOfLines={2}>{p.name}</Text>
          <StatusChip label={p.available <= 0 ? 'Habis' : `Sisa ${p.available}`} tone={p.available <= 0 ? 'bad' : 'warn'} />
        </View>
      ))}
    </View>
  );
}

/** Beranda petugas toko bergaya Klik Indomaret: kepala hijau, kartu tugas, menu pintas, dan stok menipis. */
export default function Tasks() {
  const q = useData<Tasks>('/overview/depot-tasks');
  const prods = useData<Prod[]>('/products');
  const { me } = useSession();
  const router = useRouter();
  const { refetch } = q;
  const { refetch: refetchProds } = prods;
  useFocusEffect(useCallback(() => { void refetch(); void refetchProds(); }, [refetch, refetchProds]));
  const d = q.data, a = d?.actions;
  const go = (path: string, params?: Record<string, string>) => () => router.push({ pathname: path as never, params });
  const tiles: Tile[] = a ? [
    { key: 'ap', label: 'Perlu disetujui', n: a.awaitingApproval, icon: 'checkmark-circle-outline', hot: true, onPress: go('/(staff)/orders', { status: 'awaiting_approval' }) },
    { key: 'pd', label: 'Siap dikirim', n: a.paidNotShipped, icon: 'cube-outline', hot: true, onPress: go('/(staff)/orders', { status: 'paid' }) },
    { key: 'vf', label: 'Perlu diverifikasi', n: a.pendingVerification, icon: 'camera-outline', hot: true, onPress: go('/(staff)/orders', { status: 'verify' }) },
    { key: 'rp', label: 'Laporan anggota', n: a.memberReports, icon: 'alert-circle-outline', hot: true, onPress: go('/(staff)/orders', { status: 'report' }) },
    { key: 'st', label: 'Minta stok menunggu', n: a.stockRequestsPending, icon: 'time-outline', onPress: go('/(staff)/request') },
  ] : [];
  const actions: Action[] = [
    { key: 'o', label: 'Pesanan', icon: 'receipt-outline', onPress: go('/(staff)/orders') },
    { key: 's', label: 'Stok & Kiriman', icon: 'cube-outline', onPress: go('/(staff)/stock') },
    { key: 'r', label: 'Minta Stok', icon: 'cart-outline', onPress: go('/(staff)/request') },
    { key: 'n', label: 'Opname', icon: 'clipboard-outline', onPress: go('/(staff)/opname') },
  ];
  const low = (prods.data ?? []).filter((p) => p.active && p.available <= p.safety).slice(0, 5);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void refetch(); void refetchProds(); }} />}>
      {q.isLoading ? <ActivityIndicator color={C.green} style={{ marginTop: 80 }} /> : q.error ? <Text style={{ color: C.bad[1], padding: 16 }}>Gagal memuat: {(q.error as Error).message}</Text> : d && (<>
        <StaffHeader bell title={d.tenant.depotName} subtitle={`${me?.name ?? ''} · ${d.tenant.name}`} />
        <OpnameNotice onPress={go('/(staff)/opname')} />
        <View style={{ padding: 16, gap: 14, marginTop: -36 }}>
          <TaskTiles items={tiles} />
          <SectionTitle>Menu Toko</SectionTitle>
          <ActionRow items={actions} />
          <SectionTitle action="Lihat stok" onAction={go('/(staff)/stock')}>Stok Menipis</SectionTitle>
          <LowStock items={low} />
        </View>
      </>)}
    </ScrollView>
  );
}
