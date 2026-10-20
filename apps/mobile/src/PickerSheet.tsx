import { useCallback } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './theme';

/** Lembar bawah berisi pilihan tunggal (untuk filter bergaya dropdown); daftar panjang bisa digulir. */
export function PickerSheet<T extends string>({ title, value, options, onPick, onClose }: { title: string; value: T; options: { v: T; l: string }[]; onPick: (v: T) => void; onClose: () => void }) {
  const renderItem = useCallback(({ item: o }: { item: { v: T; l: string } }) => (
    <Pressable onPress={() => onPick(o.v)} accessibilityRole="radio" accessibilityState={{ selected: o.v === value }} style={s.opt}>
      <Text style={{ flex: 1, color: o.v === value ? C.green : C.ink, fontWeight: o.v === value ? '700' : '400', fontSize: 16 }}>{o.l}</Text>
      {o.v === value && <Ionicons name="checkmark" size={22} color={C.green} />}
    </Pressable>
  ), [value, onPick]);
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Tutup" />
      <View style={s.sheet}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink, marginBottom: 6 }}>{title}</Text>
        <FlatList data={options} keyExtractor={(o) => o.v} renderItem={renderItem} extraData={value} style={{ maxHeight: 420 }} />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,39,29,0.45)' },
  sheet: { backgroundColor: '#ffffff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  opt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
});
