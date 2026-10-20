import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCart } from '../../src/cart';
import { kmText, useDepotKm } from '../../src/depotKm';
import { C } from '../../src/theme';
import { BackBar, CartIcon, PriceBlock, ProductImage } from '../../src/shop';
import { maxOrderable, useShop, type Shop, type ShopProduct } from '../../src/shopData';

/** Lembar bawah "Cari Toko yang Menjual": toko yang punya stok produk ini, terdekat dulu bila lokasi diizinkan. */
function DepotSheet({ p, depots, onClose }: { p: ShopProduct; depots: Shop['depots']; onClose: () => void }) {
  const { km, perm, allow } = useDepotKm();
  const rows = [...depots].sort((a, b) => (km.get(a.id) ?? Infinity) - (km.get(b.id) ?? Infinity));
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Tutup" />
      <View style={s.sheet}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink }}>Toko yang menjual</Text>
        <Text style={{ color: C.muted, fontSize: 13 }} numberOfLines={1}>{p.name}</Text>
        {perm === 'ask' && <Pressable onPress={allow}><Text style={{ color: C.green, fontWeight: '600' }}>Izinkan lokasi untuk melihat toko terdekat</Text></Pressable>}
        {rows.map((d) => {
          const left = p.stock[d.id] ?? 0;
          return (
            <View key={d.id} style={s.depot}>
              <Ionicons name="location" size={20} color={C.green} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontWeight: '600' }}>{d.name}</Text>
                <Text style={{ color: C.muted, fontSize: 12 }}>{[kmText(km.get(d.id)), d.address].filter(Boolean).join(' · ') || 'Alamat belum diisi'}</Text>
              </View>
              <Text style={{ color: left ? C.green : C.bad[1], fontWeight: '600', fontSize: 13 }}>{left ? `${left}` : 'Habis'}</Text>
            </View>
          );
        })}
      </View>
    </Modal>
  );
}

function Description({ text }: { text: string | null }) {
  const [more, setMore] = useState(false);
  if (!text) return null;
  return (
    <View style={s.section}>
      <Text style={{ fontWeight: '700', fontSize: 16, color: C.ink, marginBottom: 6 }}>Deskripsi Produk</Text>
      <Text numberOfLines={more ? undefined : 3} style={{ color: C.muted, fontSize: 15, lineHeight: 22 }}>{text}</Text>
      {text.length > 120 && <Pressable onPress={() => setMore((v) => !v)} hitSlop={8}><Text style={{ color: C.green, fontWeight: '700', marginTop: 8 }}>{more ? 'Lebih sedikit' : 'Selengkapnya'}</Text></Pressable>}
    </View>
  );
}

function BottomBar({ p }: { p: ShopProduct }) {
  const router = useRouter();
  const cart = useCart();
  const [added, setAdded] = useState(false);
  const left = maxOrderable(p);
  const full = cart.qtyOf(p.id) >= left;
  const add = () => { cart.add(p.id); setAdded(true); setTimeout(() => setAdded(false), 1400); };
  return (
    <View style={s.bottom}>
      <View style={s.cartBtn}><CartIcon onPress={() => router.push('/(member)/cart')} /></View>
      <Pressable onPress={add} disabled={left === 0 || full} accessibilityRole="button" style={[s.primary, (left === 0 || full) && { backgroundColor: C.line }]}>
        <Text style={{ color: left === 0 || full ? C.muted : '#ffffff', fontWeight: '700', fontSize: 16 }}>{left === 0 ? 'Stok habis' : full ? 'Sudah maksimal di keranjang' : added ? 'Ditambahkan ✓' : '+ Keranjang'}</Text>
      </Pressable>
    </View>
  );
}

/** Detail produk bergaya Klik Indomaret: foto besar, nama, harga + coret/diskon, cari toko, deskripsi, dan tombol keranjang. */
export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shop = useShop();
  const [sheet, setSheet] = useState(false);
  const p = shop.data?.products.find((x) => x.id === id);
  if (shop.isLoading) return <ActivityIndicator color={C.green} style={{ marginTop: 80 }} />;
  if (!p || !shop.data) return <View style={{ flex: 1, backgroundColor: '#ffffff' }}><BackBar /><Text style={{ padding: 16, color: C.muted }}>Produk tidak ditemukan atau sudah tidak dijual.</Text></View>;
  const sellers = shop.data.depots.filter((d) => (p.stock[d.id] ?? 0) > 0);
  return (
    <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
      <BackBar />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ paddingHorizontal: 40, paddingVertical: 8 }}><ProductImage p={p} radius={0} /></View>
        <View style={s.section}>
          <Text style={{ fontSize: 18, color: C.ink, fontWeight: '500', lineHeight: 25 }}>{p.name}</Text>
          <View style={{ marginTop: 10 }}><PriceBlock p={p} big /></View>
          <Text style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>Harga{p.category ? ` · ${p.category}` : ''} · {p.available > 0 ? `${sellers.length} toko menjual` : 'Stok habis di semua toko'}</Text>
          <Pressable onPress={() => setSheet(true)} accessibilityRole="button" style={s.find}>
            <Ionicons name="location" size={20} color={C.green} />
            <Text style={{ color: C.green, fontWeight: '700', fontSize: 16 }}>Cari Toko yang Menjual</Text>
          </Pressable>
        </View>
        <Description text={p.description} />
      </ScrollView>
      <BottomBar p={p} />
      {sheet && <DepotSheet p={p} depots={shop.data.depots} onClose={() => setSheet(false)} />}
    </View>
  );
}

const s = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  find: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: C.green, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, marginTop: 16, alignSelf: 'flex-start' },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: '#ffffff' },
  cartBtn: { width: 52, height: 52, borderRadius: 8, borderWidth: 1.5, borderColor: C.green, alignItems: 'center', justifyContent: 'center' },
  primary: { flex: 1, height: 52, borderRadius: 8, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,39,29,0.45)' },
  sheet: { backgroundColor: '#ffffff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  depot: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
});
