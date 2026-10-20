import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { C } from '../../src/theme';
import { Chips } from '../../src/ui';
import { BackBar, CartIcon, ProductCard } from '../../src/shop';
import { useShop, type ShopProduct } from '../../src/shopData';

const ALL = '__all', SALE = '__sale';

function matches(p: ShopProduct, q: string, cat: string) {
  if (cat === SALE && p.discountPct === 0) return false;
  if (cat !== ALL && cat !== SALE && p.category !== cat) return false;
  return !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase());
}

/** Daftar produk: cari nama, saring per kategori atau hanya yang diskon, tampil dua kolom. */
export default function Products() {
  const params = useLocalSearchParams<{ q?: string; category?: string; focus?: string }>();
  const router = useRouter();
  const shop = useShop();
  const [q, setQ] = useState(params.q ?? '');
  const [cat, setCat] = useState(params.category ?? ALL);
  const input = useRef<TextInput>(null);
  // Layar ini tetap terpasang saat berpindah: ikuti kategori/kata kunci baru dari tautan setiap kali berubah.
  useEffect(() => { setCat(params.category ?? ALL); setQ(params.q ?? ''); if (params.focus === '1') input.current?.focus(); }, [params.category, params.q, params.focus]);
  const renderItem = useCallback(({ item }: { item: ShopProduct | null }) => (item ? <ProductCard p={item} /> : <View style={{ flex: 1 }} />), []);
  const list = useMemo(() => {
    const found: (ShopProduct | null)[] = (shop.data?.products ?? []).filter((p) => matches(p, q.trim(), cat));
    return found.length % 2 ? [...found, null] : found; // sel kosong agar kartu terakhir tidak melebar penuh
  }, [shop.data, q, cat]);
  const options = useMemo(() => [{ v: ALL, l: 'Semua' }, { v: SALE, l: 'Diskon' }, ...(shop.data?.categories ?? []).map((c) => ({ v: c, l: c }))], [shop.data]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BackBar>
        <View style={s.search}>
          <Ionicons name="search" size={18} color={C.muted} />
          <TextInput ref={input} value={q} onChangeText={setQ} placeholder="Cari di Sajadah" placeholderTextColor={C.muted} returnKeyType="search" style={s.input} />
        </View>
        <CartIcon onPress={() => router.push('/(member)/cart')} />
      </BackBar>
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#ffffff' }}><Chips value={cat} onChange={setCat} options={options} /></View>
      {shop.isLoading ? <ActivityIndicator color={C.green} style={{ marginTop: 40 }} /> : (
        <FlatList data={list} numColumns={2} keyExtractor={(p, i) => p?.id ?? `pad${i}`} contentContainerStyle={{ padding: 16, gap: 10 }} columnWrapperStyle={{ gap: 10 }}
          onRefresh={() => void shop.refetch()} refreshing={shop.isRefetching}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={{ color: C.muted, textAlign: 'center', marginTop: 40 }}>{shop.error ? `Gagal memuat: ${(shop.error as Error).message}` : 'Tidak ada produk yang cocok.'}</Text>} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 10, height: 40, borderWidth: 1, borderColor: C.line },
  input: { flex: 1, fontSize: 15, color: C.ink, paddingVertical: 0 },
});
