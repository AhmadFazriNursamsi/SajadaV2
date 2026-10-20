import { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCart } from '../../src/cart';
import { rupiah } from '../../src/hooks';
import { C } from '../../src/theme';
import { PriceBlock, ProductImage, Stepper } from '../../src/shop';
import { maxOrderable, useShop, type ShopProduct } from '../../src/shopData';

function CartLine({ p, qty }: { p: ShopProduct; qty: number }) {
  const cart = useCart();
  const router = useRouter();
  return (
    <View style={s.line}>
      <Pressable onPress={() => router.push({ pathname: '/(member)/product', params: { id: p.id } })}><ProductImage p={p} size={72} /></Pressable>
      <View style={{ flex: 1, gap: 6 }}>
        <Text numberOfLines={2} style={{ color: C.ink, fontSize: 14 }}>{p.name}</Text>
        <PriceBlock p={p} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={() => cart.remove(p.id)} hitSlop={8} accessibilityLabel={`Hapus ${p.name}`}><Ionicons name="trash-outline" size={20} color={C.bad[1]} /></Pressable>
          <Stepper qty={qty} max={maxOrderable(p)} onChange={(q) => cart.setQty(p.id, q)} />
        </View>
      </View>
    </View>
  );
}

function Empty() {
  const router = useRouter();
  return (
    <View style={{ alignItems: 'center', gap: 12, marginTop: 80, paddingHorizontal: 32 }}>
      <Ionicons name="cart-outline" size={64} color={C.line} />
      <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink }}>Keranjang masih kosong</Text>
      <Text style={{ color: C.muted, textAlign: 'center' }}>Yuk, pilih barang kebutuhan Anda dulu.</Text>
      <Pressable onPress={() => router.push('/(member)/products')} style={s.cta}><Text style={{ color: '#ffffff', fontWeight: '700' }}>Mulai Belanja</Text></Pressable>
    </View>
  );
}

/** Keranjang: ubah jumlah, hapus, lihat total, lalu lanjut ke checkout (toko dipilih di sana). */
export default function Cart() {
  const router = useRouter();
  const cart = useCart();
  const shop = useShop();
  const rows = useMemo(() => (shop.data?.products ?? []).filter((p) => cart.qtyOf(p.id) > 0).map((p) => ({ p, qty: cart.qtyOf(p.id) })), [shop.data, cart]);
  const renderItem = useCallback(({ item }: { item: { p: ShopProduct; qty: number } }) => <CartLine p={item.p} qty={item.qty} />, []);
  const total = rows.reduce((n, r) => n + r.p.price * r.qty, 0);
  if (shop.isLoading) return <ActivityIndicator color={C.green} style={{ marginTop: 80 }} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList data={rows} keyExtractor={(r) => r.p.id} contentContainerStyle={{ padding: 16, gap: 10 }} ListEmptyComponent={<Empty />}
        onRefresh={() => void shop.refetch()} refreshing={shop.isRefetching}
        renderItem={renderItem} />
      {rows.length > 0 && (
        <View style={s.footer}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.muted, fontSize: 12 }}>Total belanja</Text>
            <Text style={{ color: C.ink, fontWeight: '700', fontSize: 20 }}>{rupiah(total)}</Text>
          </View>
          <Pressable onPress={() => router.push('/(member)/checkout')} accessibilityRole="button" style={s.cta}>
            <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 16 }}>Checkout ({rows.reduce((n, r) => n + r.qty, 0)})</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  line: { flexDirection: 'row', gap: 12, backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 12 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: C.line },
  cta: { backgroundColor: C.green, borderRadius: 8, paddingHorizontal: 22, paddingVertical: 14 },
});
