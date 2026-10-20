import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { apiBase } from './api';
import { CoinIcon } from './CoinIcon';
import { useCart } from './cart';
import { rupiah } from './hooks';
import { maxOrderable, type ShopProduct } from './shopData';
import { C } from './theme';

/** Foto produk dari server; bila belum ada, tampilkan kotak berinisial produk. */
export function ProductImage({ p, size, radius = 10 }: { p: Pick<ShopProduct, 'name' | 'imageUrl'>; size?: number; radius?: number }) {
  const [failed, setFailed] = useState(false);
  const box = size ? { width: size, height: size } : { width: '100%' as const, aspectRatio: 1 };
  if (p.imageUrl && !failed) return <Image source={{ uri: apiBase() + p.imageUrl }} onError={() => setFailed(true)} resizeMode="contain" style={[box, { borderRadius: radius, backgroundColor: '#ffffff' }]} accessibilityLabel={p.name} />;
  return (
    <View style={[box, { borderRadius: radius, backgroundColor: C.ok[0], alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: C.green, fontSize: size ? size / 3 : 40, fontWeight: '700' }}>{p.name.trim().slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

/** Harga tebal, harga normal dicoret, dan lencana persen diskon (seperti Klik Indomaret). */
export function PriceBlock({ p, big }: { p: ShopProduct; big?: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: C.ink, fontWeight: '700', fontSize: big ? 24 : 15 }}>{rupiah(p.price)}</Text>
      {p.coins > 0 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><CoinIcon size={14} /><Text style={s.coin}>+{p.coins} koin</Text></View>}
      {p.discountPct > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={s.badge}>{p.discountPct}%</Text>
          <Text style={{ color: C.muted, textDecorationLine: 'line-through', fontSize: big ? 15 : 12 }}>{rupiah(p.listPrice)}</Text>
        </View>
      )}
    </View>
  );
}

/** Kartu produk pada grid: foto, nama, harga, dan tombol tambah ke keranjang. */
export function ProductCard({ p }: { p: ShopProduct }) {
  const router = useRouter();
  const cart = useCart();
  const open = () => router.push({ pathname: '/(member)/product', params: { id: p.id } });
  const left = maxOrderable(p);
  const inCart = cart.qtyOf(p.id);
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={p.name} style={s.card}>
      <ProductImage p={p} />
      <Text numberOfLines={2} style={{ color: C.ink, fontSize: 13, minHeight: 34 }}>{p.name}</Text>
      <PriceBlock p={p} />
      {left === 0 ? <Text style={s.soldOut}>Stok habis</Text> : (
        <Pressable onPress={() => cart.add(p.id)} disabled={inCart >= left} accessibilityLabel={`Tambah ${p.name} ke keranjang`} style={[s.add, inCart >= left && { opacity: 0.5 }]}>
          <Ionicons name="add" size={16} color="#ffffff" />
          <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 13 }}>{inCart ? `Keranjang (${inCart})` : 'Keranjang'}</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

/** Tombol − 1 + untuk jumlah barang. */
export function Stepper({ qty, max, onChange }: { qty: number; max: number; onChange: (q: number) => void }) {
  return (
    <View style={s.stepper}>
      <Pressable onPress={() => onChange(qty - 1)} hitSlop={8} accessibilityLabel="Kurangi"><Ionicons name="remove" size={20} color={C.green} /></Pressable>
      <Text style={{ minWidth: 24, textAlign: 'center', fontWeight: '700', color: C.ink }}>{qty}</Text>
      <Pressable onPress={() => qty < max && onChange(qty + 1)} hitSlop={8} accessibilityLabel="Tambah" style={qty >= max && { opacity: 0.35 }}><Ionicons name="add" size={20} color={C.green} /></Pressable>
    </View>
  );
}

/** Kepala halaman putih dengan tombol kembali dan ikon keranjang berlencana. */
export function BackBar({ title, children }: { title?: string; children?: React.ReactNode }) {
  const router = useRouter();
  return (
    <View style={s.bar}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(member)'))} hitSlop={10} accessibilityLabel="Kembali"><Ionicons name="arrow-back" size={24} color={C.ink} /></Pressable>
      {title ? <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: '700', color: C.ink }}>{title}</Text> : children ? null : <View style={{ flex: 1 }} />}
      {children}
    </View>
  );
}

export function CartIcon({ onPress }: { onPress: () => void }) {
  const { count } = useCart();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={`Keranjang, ${count} barang`}>
      <Ionicons name="cart-outline" size={26} color={C.green} />
      {count > 0 && <View style={s.dot}><Text style={{ color: C.ink, fontSize: 10, fontWeight: '700' }}>{count > 99 ? '99+' : count}</Text></View>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { flex: 1, backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 10, gap: 6 },
  coin: { color: C.goldInk, fontSize: 12, fontWeight: '600' },
  badge: { backgroundColor: C.bad[0], color: C.bad[1], fontWeight: '700', fontSize: 12, borderRadius: 4, overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 1 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: C.green, borderRadius: 8, paddingVertical: 8, marginTop: 2 },
  soldOut: { textAlign: 'center', color: C.muted, backgroundColor: C.neutral[0], borderRadius: 8, paddingVertical: 8, fontSize: 13, overflow: 'hidden' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#ffffff' },
  dot: { position: 'absolute', top: -6, right: -8, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
});
