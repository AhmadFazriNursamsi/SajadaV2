import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './theme';
import { PickerSheet } from './PickerSheet';
import { cleanPhone } from './phone';

const label = { color: C.muted, fontSize: 13, fontWeight: '600' } as const;

/** Nomor HP Indonesia: bendera 🇮🇩 dan +62 tetap di kiri, isian angka diawali 8. */
export function PhoneField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={label}>Nomor HP</Text>
      <View style={s.box}>
        <Text style={{ fontSize: 22 }} accessibilityLabel="Indonesia">🇮🇩</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: C.ink }}>+62</Text>
        <View style={s.sep} />
        <TextInput value={value} onChangeText={(v) => onChange(cleanPhone(v))} keyboardType="number-pad" maxLength={13} selectionColor={C.green} accessibilityLabel="Nomor HP" placeholder="8123456789" placeholderTextColor="#93aaa3" style={s.input} />
      </View>
      <Text style={{ color: C.muted, fontSize: 12 }}>Wajib diisi, diawali 8 (9–13 angka).</Text>
    </View>
  );
}

/** Combo box: kolom bergaya dropdown yang membuka lembar pilihan. */
export function ComboField({ title, value, options, onChange, placeholder }: { title: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.v === value)?.l;
  return (
    <View style={{ gap: 4 }}>
      <Text style={label}>{title}</Text>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="combobox" accessibilityLabel={title} style={s.box}>
        <Text style={{ flex: 1, fontSize: 16, color: cur ? C.ink : '#93aaa3' }}>{cur ?? placeholder}</Text>
        <Ionicons name="chevron-down" size={20} color={C.muted} />
      </Pressable>
      {open && <PickerSheet title={title} value={value} options={options} onPick={(v) => { onChange(v); setOpen(false); }} onClose={() => setOpen(false)} />}
    </View>
  );
}

const s = StyleSheet.create({
  box: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#ffffff', borderRadius: 12, paddingHorizontal: 12 },
  sep: { width: 1, alignSelf: 'stretch', marginVertical: 10, backgroundColor: C.line },
  input: { flex: 1, fontSize: 16, color: C.ink, paddingVertical: 0 },
});
