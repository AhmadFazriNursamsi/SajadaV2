import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { ApiError, api } from '../src/api';
import { useDialog } from '../src/dialog';
import { useSession } from '../src/session';
import { C } from '../src/theme';
import { Button } from '../src/ui';

/** Ganti kata sandi sendiri. Bila `mustChangePassword`, layar ini tidak bisa dilewati (hanya Keluar). */
export default function ChangePassword() {
  const { me, logout, refresh } = useSession();
  const router = useRouter();
  const dialog = useDialog();
  const [cur, setCur] = useState(''), [next, setNext] = useState(''), [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const nextRef = useRef<TextInput>(null), againRef = useRef<TextInput>(null);
  if (!me) return <Redirect href="/login" />;
  const forced = me.mustChangePassword;

  const rules = [
    { ok: next.length >= 8, t: 'Minimal 8 karakter' },
    { ok: /[A-Za-z]/.test(next) && /\d/.test(next), t: 'Memuat huruf dan angka' },
    { ok: next.length > 0 && next !== cur, t: 'Berbeda dari kata sandi sekarang' },
    { ok: next.length > 0 && next === again, t: 'Konfirmasi sama dengan kata sandi baru' },
  ];
  const valid = !!cur && rules.every((r) => r.ok);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr('');
    try {
      await api('POST', '/auth/change-password', { current: cur, next });
      await refresh();
      if (forced) router.replace('/');
      else { router.back(); void dialog.alert({ title: 'Kata sandi diganti', message: 'Kata sandi Anda sudah diganti. Pakai kata sandi baru saat masuk berikutnya.', kind: 'success' }); }
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Gagal mengganti kata sandi'); }
    finally { setBusy(false); }
  };

  const input = (label: string, value: string, set: (v: string) => void, type: 'password' | 'newPassword', ref?: React.RefObject<TextInput | null>, nextRef?: React.RefObject<TextInput | null>, toggle?: boolean) => (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <View style={s.field}>
        <TextInput ref={ref} value={value} onChangeText={set} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} textContentType={type}
          returnKeyType={nextRef ? 'next' : 'done'} onSubmitEditing={() => (nextRef ? nextRef.current?.focus() : void submit())} style={s.input} />
        {toggle && <Pressable onPress={() => setShow((v) => !v)} hitSlop={10} accessibilityLabel={show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}><Text style={s.eye}>{show ? 'Sembunyikan' : 'Tampilkan'}</Text></Pressable>}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <View>
            <Text style={s.title}>Ganti kata sandi</Text>
            <Text style={{ color: C.muted, marginTop: 4 }}>{forced ? `Halo, ${me.name}. Demi keamanan, ganti kata sandi sementara Anda sebelum melanjutkan.` : `Masuk sebagai ${me.username}`}</Text>
          </View>
          {input('Kata sandi sekarang', cur, setCur, 'password', undefined, nextRef, true)}
          {input('Kata sandi baru', next, setNext, 'newPassword', nextRef, againRef)}
          {input('Ulangi kata sandi baru', again, setAgain, 'newPassword', againRef)}
          <View style={s.rules}>
            {rules.map((r) => (
              <View key={r.t} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <View style={[s.dot, r.ok && { backgroundColor: C.green, borderColor: C.green }]}>{r.ok && <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>✓</Text>}</View>
                <Text style={{ fontSize: 13, color: r.ok ? C.green : C.muted }}>{r.t}</Text>
              </View>
            ))}
          </View>
          {err ? <View style={s.err}><Text style={{ color: C.bad[1] }}>{err}</Text></View> : null}
          <Button label={busy ? 'Menyimpan…' : 'Simpan kata sandi'} onPress={submit} disabled={busy || !valid} />
          {forced ? <Button label="Keluar" kind="ghost" onPress={logout} /> : <Button label="Batal" kind="ghost" onPress={() => router.back()} />}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, padding: 16 },
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 14, padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: C.green },
  label: { fontSize: 13, fontWeight: '600', color: C.ink },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12 },
  input: { flex: 1, paddingVertical: 12, fontSize: 16, color: C.ink },
  eye: { color: C.green, fontSize: 13, fontWeight: '600', paddingLeft: 8 },
  rules: { backgroundColor: C.bg, borderRadius: 10, padding: 12, gap: 8 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  err: { backgroundColor: C.bad[0], borderRadius: 8, padding: 10 },
});
