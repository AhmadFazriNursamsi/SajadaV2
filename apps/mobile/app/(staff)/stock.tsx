import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useData } from '../../src/hooks';
import { ProductImage } from '../../src/shop';
import { StaffHeader, StatusChip } from '../../src/StaffParts';
import { SectionTitle } from '../../src/HomeParts';
import { C } from '../../src/theme';
import { Button, Chips } from '../../src/ui';

interface Prod { id: string; name: string; sku: string; image: string | null; physical: number; reserved: number; available: number; safety: number; target: number; active: boolean; location: string }
interface Ship { id: string; no: string; totalQty: number; lines: { qty: number; name: string }[] }

function StockRow({ p }: { p: Prod }) {
  const pct = Math.max(0, Math.min(1, p.target > 0 ? p.available / p.target : 0));
  const tone = p.available <= 0 ? 'bad' : p.available <= p.safety ? 'warn' : 'ok';
  return (
    <View style={s.row}>
      <ProductImage p={{ name: p.name, imageUrl: p.image ? `/api/products/image/${p.image}` : null }} size={56} radius={6} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text numberOfLines={2} style={{ color: C.ink, fontWeight: '600', fontSize: 15 }}>{p.name}</Text>
        <View style={s.track}><View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: tone === 'ok' ? C.green : tone === 'warn' ? C.gold : C.bad[1] }]} /></View>
        <Text style={{ color: C.muted, fontSize: 12 }}>Fisik {p.physical} · reservasi {p.reserved} · aman ≥ {p.safety} · target {p.target}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={{ color: C.ink, fontSize: 20, fontWeight: '700' }}>{p.available}</Text>
        <StatusChip label={tone === 'bad' ? 'Habis' : tone === 'warn' ? 'Menipis' : 'Aman'} tone={tone} />
      </View>
    </View>
  );
}

function Shipment({ sh, onReceive }: { sh: Ship; onReceive: () => void }) {
  return (
    <View style={s.ship}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: C.ink, fontWeight: '700', fontSize: 16 }}>Kiriman {sh.no}</Text>
        <StatusChip label={`${sh.totalQty}`} tone="warn" />
      </View>
      <Text style={{ color: C.muted, fontSize: 13 }}>{sh.lines.map((l) => `${l.qty} ${l.name}`).join(', ')}</Text>
      <Button label="Periksa & terima kiriman" onPress={onReceive} />
    </View>
  );
}

/** Stok toko: kepala hijau berisi total tersedia, daftar produk bergambar dengan batang stok, kiriman dari pusat, dan jalan pintas. */
export default function Stock() {
  const depots = useData<{ id: string; name: string; active: boolean }[]>('/depots');
  const [sel, setSel] = useState('');
  const ds = (depots.data ?? []).filter((d) => d.active);
  const depotId = ds.find((d) => d.id === sel)?.id ?? ds[0]?.id ?? '';
  const q = useData<Prod[]>(`/products?depotId=${depotId}`, !!depotId);
  const ships = useData<Ship[]>(`/central/shipments?status=in_transit&depotId=${depotId}`, !!depotId);
  const router = useRouter();
  const { refetch } = q;
  const { refetch: refetchShips } = ships;
  useFocusEffect(useCallback(() => { void refetch(); void refetchShips(); }, [refetch, refetchShips]));
  const ps = (q.data ?? []).filter((p) => p.active);
  const err = [depots, q, ships].find((x) => x.error)?.error as Error | undefined;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void refetch(); void refetchShips(); }} />}>
      <StaffHeader title="Stok Toko" subtitle={ps[0]?.location}>
        <Text style={{ color: '#ffffff', opacity: 0.85, fontSize: 13, marginTop: 14 }}>Tersedia (fisik − reservasi)</Text>
        <Text style={{ color: '#ffffff', fontSize: 30, fontWeight: '700' }}>{ps.reduce((n, p) => n + p.available, 0)}</Text>
      </StaffHeader>
      <View style={{ padding: 16, gap: 14, marginTop: -30 }}>
        {err ? <Text style={{ color: C.bad[1] }}>Gagal memuat: {err.message}</Text> : q.isLoading ? <ActivityIndicator color={C.green} /> : (<>
          {ds.length > 1 && <View style={s.card}><Chips value={depotId} onChange={setSel} options={ds.map((d) => ({ v: d.id, l: d.name }))} /></View>}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="Minta stok ke pusat" onPress={() => router.push('/(staff)/request')} /></View>
            <View style={{ flex: 1 }}><Button label="Stok opname" kind="gold" onPress={() => router.push('/(staff)/opname')} /></View>
          </View>
          {(ships.data ?? []).length > 0 && <><SectionTitle>Kiriman dari Pusat</SectionTitle>{(ships.data ?? []).map((sh) => <Shipment key={sh.id} sh={sh} onReceive={() => router.push({ pathname: '/(staff)/receive', params: { id: sh.id } })} />)}</>}
          <SectionTitle>Daftar Produk</SectionTitle>
          <View style={s.card}>{ps.length === 0 ? <Text style={{ color: C.muted, padding: 12 }}>Belum ada produk.</Text> : ps.map((p) => <StockRow key={p.id} p={p} />)}</View>
          <Text style={{ color: C.muted, fontSize: 12 }}>Setiap toko punya stok sendiri. Ubah stok lewat dokumen penerimaan/opname, bukan total katalog.</Text>
        </>)}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  track: { height: 6, borderRadius: 3, backgroundColor: C.neutral[0], overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  ship: { backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14, gap: 8 },
});
