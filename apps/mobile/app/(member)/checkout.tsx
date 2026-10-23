import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/api';
import { useDialog } from '../../src/dialog';
import { useCart } from '../../src/cart';
import { gpsBlocked, kmText, useDepotKm } from '../../src/depotKm';
import { GpsGate } from '../../src/GpsGate';
import { rupiah, useData } from '../../src/hooks';
import { C } from '../../src/theme';
import { BackBar } from '../../src/shop';
import { useShop, type Shop, type ShopDepot, type ShopProduct } from '../../src/shopData';

type Line = { p: ShopProduct; qty: number };

/** Barang yang stoknya kurang di toko itu (kosong = toko bisa memenuhi seluruh keranjang). */
const shortOf = (lines: Line[], d: ShopDepot) => lines.filter((l) => (l.p.stock[d.id] ?? 0) < l.qty).map((l) => l.p.name);

function DepotChoice({ d, short, km, on, nearest, onPick }: { d: ShopDepot; short: string[]; km: number | null | undefined; on: boolean; nearest: boolean; onPick: () => void }) {
  const ok = short.length === 0;
  return (
    <Pressable onPress={onPick} disabled={!ok} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: !ok }} style={[s.depot, on && s.depotOn, !ok && { opacity: 0.55 }]}>
      <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={ok ? C.green : C.muted} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.ink, fontWeight: '600' }}>{d.name}{nearest ? '  ·  Terdekat' : ''}</Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>{[kmText(km), d.address].filter(Boolean).join(' · ') || 'Alamat belum diisi'}</Text>
        <Text style={{ color: ok ? C.green : C.bad[1], fontSize: 12, marginTop: 2 }}>{ok ? 'Stok mencukupi' : `Stok kurang: ${short.join(', ')}`}</Text>
      </View>
    </Pressable>
  );
}

/** Status lokasi: toko terdekat dipilih otomatis dari GPS; bila tidak ada GPS, anggota memilih sendiri. */
function LocationHint({ perm, hasGps, allow, retry }: { perm: string; hasGps: boolean; allow: () => void; retry: () => void }) {
  if (hasGps) return <Text style={{ color: C.muted, fontSize: 12 }}>Toko terdekat dari lokasi Anda dipilih otomatis. Ketuk toko lain untuk mengganti.</Text>;
  if (perm === 'granted' || perm === 'checking') return <Text style={{ color: C.muted, fontSize: 12 }}>Mencari lokasi Anda…</Text>;
  if (perm === 'unavailable') return <Pressable onPress={retry}><Text style={{ color: C.muted, fontSize: 12 }}>Lokasi tidak tersedia (GPS mati?). Nyalakan GPS dan ini otomatis diperbarui, atau ketuk untuk coba lagi. Atau pilih toko sendiri.</Text></Pressable>;
  return (
    <Pressable onPress={allow}>
      <Text style={{ color: C.green, fontWeight: '600' }}>{perm === 'denied' ? 'Izin lokasi ditolak. Aktifkan di Pengaturan HP, atau pilih toko sendiri.' : 'Izinkan lokasi agar toko terdekat dipilih otomatis'}</Text>
    </Pressable>
  );
}

function useSubmit(depotId: string | null, lines: Line[]) {
  const router = useRouter();
  const cart = useCart();
  const qc = useQueryClient();
  const dialog = useDialog();
  return useMutation({
    mutationFn: () => api('POST', '/me/orders', { depotId, items: lines.map((l) => ({ productId: l.p.id, qty: l.qty })) }),
    onSuccess: () => {
      cart.clear();
      void qc.invalidateQueries();
      router.replace('/(member)/orders');
      void dialog.alert({ title: 'Pesanan terkirim', message: 'Toko akan menyetujui pesanan Anda. Saldo belanja terpotong otomatis setelah disetujui.', kind: 'success' });
    },
    onError: (e) => void dialog.fail(e, 'Pesanan belum bisa dikirim'),
  });
}

function sortedDepots(shop: Shop, lines: Line[], km: Map<string, number | null>) {
  return shop.depots.map((d) => ({ d, short: shortOf(lines, d) }))
    .sort((a, b) => Number(a.short.length > 0) - Number(b.short.length > 0) || (km.get(a.d.id) ?? Infinity) - (km.get(b.d.id) ?? Infinity));
}

/** Pilihan toko: terdekat (GPS) yang stoknya cukup dipilih otomatis; anggota bisa menggantinya. */
function useDepotPick(shop: Shop | undefined, lines: Line[], km: Map<string, number | null>, hasGps: boolean) {
  const [picked, setPicked] = useState<string | null>(null);
  const depots = useMemo(() => (shop ? sortedDepots(shop, lines, km) : []), [shop, lines, km]);
  const nearest = hasGps ? depots.find((x) => x.short.length === 0)?.d.id ?? null : null;
  const depotId = depots.find((x) => x.d.id === (picked ?? nearest) && x.short.length === 0)?.d.id ?? null;
  return { depots, nearest, depotId, setPicked };
}

function PaymentCard({ total, me }: { total: number; me?: { balance: number; active: boolean } }) {
  const balance = me?.balance ?? 0;
  const note = me && !me.active ? 'Saldo belanja belum aktif; hubungi pengurus koperasi.' : total > balance ? 'Saldo belum cukup untuk pesanan ini. Pesanan baru bisa disetujui bila saldo mencukupi.' : 'Saldo terpotong otomatis setelah toko menyetujui pesanan.';
  return (
    <View style={s.card}>
      <Text style={s.h}>Pembayaran</Text>
      <View style={s.sum}><Text style={{ flex: 1, color: C.ink }}>Saldo belanja</Text><Text style={{ fontWeight: '700', color: total > balance ? C.bad[1] : C.green }}>{rupiah(balance)}</Text></View>
      <Text style={{ color: C.muted, fontSize: 12 }}>{note}</Text>
    </View>
  );
}

/** Checkout: ringkasan keranjang, pilih toko yang bisa memenuhi semua barang, lalu kirim pesanan (saldo terpotong setelah disetujui toko). */
export default function Checkout() {
  const cart = useCart();
  const shop = useShop();
  const me = useData<{ balance: number; active: boolean }>('/me');
  const { km, perm, allow, refresh, hasGps } = useDepotKm();
  const lines = useMemo<Line[]>(() => (shop.data?.products ?? []).filter((p) => cart.qtyOf(p.id) > 0).map((p) => ({ p, qty: cart.qtyOf(p.id) })), [shop.data, cart]);
  const total = lines.reduce((n, l) => n + l.p.price * l.qty, 0);
  const coins = lines.reduce((n, l) => n + l.p.coins * l.qty, 0);
  const reward = lines.reduce((n, l) => n + Math.floor((l.p.price * l.qty * l.p.rewardPercent) / 100), 0);
  const { depots, nearest, depotId, setPicked } = useDepotPick(shop.data, lines, km, hasGps);
  const submit = useSubmit(depotId, lines);
  const router = useRouter();
  const blocked = gpsBlocked(perm); // GPS mati/izin ditolak: checkout ditahan sampai GPS menyala
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BackBar title="Checkout" />
      <GpsGate perm={perm} allow={allow} refresh={refresh} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={s.card}>
          <Text style={s.h}>Ringkasan pesanan</Text>
          {lines.map((l) => (
            <View key={l.p.id} style={s.sum}>
              <Text style={{ flex: 1, color: C.ink }} numberOfLines={1}>{l.qty} × {l.p.name}</Text>
              <Text style={{ color: C.ink, fontWeight: '600' }}>{rupiah(l.p.price * l.qty)}</Text>
            </View>
          ))}
          <Text style={{ color: C.green, fontSize: 12 }}>Anda akan mendapat {rupiah(reward)} ke saldo penarikan setelah barang diterima (sesuai imbalan tiap produk). Bila imbalan Anda hari ini mencapai Rp30.000, tagihan harian Rp30.000 dipotong otomatis dari saldo penarikan.{coins > 0 ? ` Plus ${coins} koin.` : ''}</Text>
          <View style={[s.sum, { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 }]}>
            <Text style={{ flex: 1, fontWeight: '700', color: C.ink }}>Total</Text>
            <Text style={{ fontWeight: '700', fontSize: 18, color: C.ink }}>{rupiah(total)}</Text>
          </View>
        </View>

        <PaymentCard total={total} me={me.data} />

        <View style={s.card}>
          <Text style={s.h}>Pilih toko</Text>
          <LocationHint perm={perm} hasGps={hasGps} allow={allow} retry={refresh} />
          {depots.map(({ d, short }) => <DepotChoice key={d.id} d={d} short={short} km={km.get(d.id)} on={depotId === d.id} nearest={nearest === d.id} onPick={() => setPicked(d.id)} />)}
        </View>
      </ScrollView>
      <View style={s.footer}>
        <Pressable onPress={() => { if (!blocked) submit.mutate(); }} disabled={blocked || !depotId || lines.length === 0 || submit.isPending} accessibilityRole="button" style={[s.cta, (blocked || !depotId || submit.isPending) && { backgroundColor: C.line }]}>
          <Text style={{ color: depotId && !blocked ? '#ffffff' : C.muted, fontWeight: '700', fontSize: 16 }}>{submit.isPending ? 'Mengirim…' : blocked ? 'Nyalakan GPS dulu' : depotId ? `Kirim pesanan · ${rupiah(total)}` : 'Pilih toko dulu'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14, gap: 10 },
  h: { fontSize: 16, fontWeight: '700', color: C.ink },
  sum: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  depot: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12 },
  depotOn: { borderColor: C.green, backgroundColor: C.ok[0] },
  footer: { padding: 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: C.line },
  cta: { backgroundColor: C.green, borderRadius: 8, paddingVertical: 15, alignItems: 'center' },
});
