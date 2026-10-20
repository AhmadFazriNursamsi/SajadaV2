import { useCallback, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, type Tone } from './theme';
import { mono } from './hooks';

export function Screen({ queries, children }: { queries: { isLoading: boolean; isRefetching: boolean; error: unknown; refetch: () => unknown }[]; children: ReactNode }) {
  const err = queries.find((q) => q.error)?.error as Error | undefined;
  const loading = queries.some((q) => q.isLoading);
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={queries.some((q) => q.isRefetching)} onRefresh={() => queries.forEach((q) => q.refetch())} />}>
      {loading ? <ActivityIndicator color={C.green} style={{ marginTop: 40 }} /> : err ? <Text style={{ color: C.bad[1] }}>Gagal memuat: {err.message}</Text> : children}
    </ScrollView>
  );
}

export function Hero({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={s.hero}>
      <Text style={{ color: '#ffffff', opacity: 0.8, fontSize: 12 }}>{label}</Text>
      <Text style={[{ color: '#ffffff', fontSize: 26, fontWeight: '600', marginVertical: 2 }, mono]}>{value}</Text>
      {note ? <Text style={{ color: C.gold, fontSize: 12 }}>{note}</Text> : null}
    </View>
  );
}

export function Row({ title, sub, right, tone = 'neutral' }: { title: string; sub?: string; right?: string; tone?: Tone }) {
  const [bg, fg] = C[tone];
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.ink, fontWeight: '500' }}>{title}</Text>
        {sub ? <Text style={{ color: C.muted, fontSize: 12 }}>{sub}</Text> : null}
      </View>
      {right ? <Text style={{ backgroundColor: bg, color: fg, borderRadius: 10, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 2, fontSize: 12 }}>{right}</Text> : null}
    </View>
  );
}

export const Card = ({ children }: { children: ReactNode }) => <View style={s.card}>{children}</View>;
export const Note = ({ children }: { children: ReactNode }) => <Text style={{ color: C.muted, fontSize: 12 }}>{children}</Text>;

export function Button({ label, onPress, kind = 'primary', disabled }: { label: string; onPress: () => void; kind?: 'primary' | 'gold' | 'ghost'; disabled?: boolean }) {
  const bg = kind === 'primary' ? C.green : kind === 'gold' ? C.gold : 'transparent';
  const fg = kind === 'primary' ? '#ffffff' : kind === 'gold' ? C.ink : C.green;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: kind === 'gold' ? C.gold : C.green, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}>
      <Text style={{ color: fg, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/** Pilihan satu-dari-banyak berbentuk chip (mis. memilih toko). */
const chip = StyleSheet.create({
  base: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  on: { borderColor: C.green, backgroundColor: C.green },
  off: { borderColor: C.line, backgroundColor: C.panel },
  gap: { gap: 8 },
});

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[chip.base, on ? chip.on : chip.off]}>
      <Text style={{ color: on ? '#ffffff' : C.green, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  const renderItem = useCallback(({ item }: { item: { v: T; l: string } }) => <Chip label={item.l} on={item.v === value} onPress={() => onChange(item.v)} />, [value, onChange]);
  return <FlatList horizontal data={options} extraData={value} keyExtractor={keyOf} renderItem={renderItem} showsHorizontalScrollIndicator={false} contentContainerStyle={chip.gap} />;
}
const keyOf = (o: { v: string }) => o.v;

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  hero: { backgroundColor: C.side, borderRadius: 14, padding: 16 },
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  btn: { borderWidth: 1, borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
});
