import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { rupiah } from './hooks';
import { C, type Tone } from './theme';
import { STATUS, stamp, type OrderGroup, type OrderLine } from './orderMeta';
import { ProductImage } from './shop';
type Thumb = { name: string; imageUrl: string | null };

function StatusPill({ status }: { status: string }) {
  const [label, tone] = STATUS[status] ?? [status, 'neutral' as Tone];
  const [bg, fg] = ({ ok: ['#d9f5dd', '#1b6b2a'], warn: [C.warn[0], C.warn[1]], bad: [C.bad[0], C.bad[1]], neutral: [C.neutral[0], C.neutral[1]] } as Record<Tone, [string, string]>)[tone];
  return <Text style={[s.pill, { backgroundColor: bg, color: fg }]}>{label}</Text>;
}

const SHOWN = 3;

function ItemRow({ line, products }: { line: OrderLine; products: Map<string, Thumb> }) {
  const p = products.get(line.productId);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {p ? <ProductImage p={p} size={56} radius={6} /> : <View style={s.noImg}><Ionicons name="cube-outline" size={24} color={C.muted} /></View>}
      <Text numberOfLines={2} style={{ flex: 1, color: C.ink, fontSize: 15, fontWeight: '500' }}>{line.qty} × {line.product}</Text>
    </View>
  );
}

/** Produk dalam pesanan (foto + nama): tiga pertama saat tertutup (sisanya "dan N produk lainnya"), semuanya saat dibuka. */
function Items({ o, products, all }: { o: OrderGroup; products: Map<string, Thumb>; all: boolean }) {
  const more = all ? 0 : o.lines.length - SHOWN;
  return (
    <View style={{ gap: 10, marginTop: 10 }}>
      {o.lines.slice(0, all ? undefined : SHOWN).map((l) => <ItemRow key={l.productId} line={l} products={products} />)}
      {more > 0 && <Text style={{ color: C.muted, fontSize: 12 }}>dan {more} produk lainnya</Text>}
    </View>
  );
}

/** Kartu transaksi: jenis + tanggal + status, kotak toko/nomor/produk (ketuk untuk detail), lalu Beli Lagi dan total. */
export function OrderCard({ o, products, open, onToggle, onBuyAgain, title, party, children }: { o: OrderGroup; products: Map<string, Thumb>; open: boolean; onToggle: () => void; onBuyAgain?: () => void; title?: string; party?: string; children?: ReactNode }) {
  const sale = o.role === 'seller' && !o.selfOrder;
  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={s.iconWrap}><Ionicons name={sale ? 'people' : 'basket'} size={18} color={C.green} /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink }}>{title ?? (sale ? 'Penjualan' : 'Belanja')}</Text>
          <Text style={{ color: C.muted, fontSize: 13 }}>{stamp(o.createdAt)}</Text>
        </View>
        <StatusPill status={o.status} />
      </View>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={`Detail ${o.no}`} accessibilityState={{ expanded: open }} style={s.box}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: C.ink }}>{o.depot}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={18} color={C.muted} />
        </View>
        <Text style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>No. Transaksi - {o.no}{party ? ` · ${party}` : sale && o.buyerName ? ` · ${o.buyerName}` : ''}</Text>
        <Items o={o} products={products} all={open} />
      </Pressable>
      {open && <View style={{ gap: 10, marginTop: 10 }}>{children}</View>}
      <View style={s.foot}>
        {onBuyAgain && !sale && o.status === 'received' ? <Pressable onPress={onBuyAgain} accessibilityRole="button" style={s.again}><Text style={{ color: C.green, fontWeight: '700' }}>Beli Lagi</Text></Pressable> : <View />}
        <Text style={{ color: C.muted, fontSize: 16 }}>Total <Text style={{ color: C.ink, fontWeight: '700', fontSize: 18 }}>{rupiah(o.total)}</Text></Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.ok[0], alignItems: 'center', justifyContent: 'center' },
  pill: { fontSize: 12, fontWeight: '600', borderRadius: 4, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  box: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, backgroundColor: C.bg },
  noImg: { width: 56, height: 56, borderRadius: 6, backgroundColor: C.ok[0], alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  again: { borderWidth: 1.5, borderColor: C.green, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 9 },
});
