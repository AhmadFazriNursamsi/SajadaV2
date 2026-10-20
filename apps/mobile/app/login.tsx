import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, api, apiBase, lastUser } from '../src/api';
import { useSession } from '../src/session';
import { C } from '../src/theme';

const lc = (u: string) => u.trim().toLowerCase();
const loginError = (e: unknown) => (e instanceof ApiError && e.status === 401 ? 'Username atau kata sandi salah. Periksa lalu coba lagi.' : e instanceof ApiError ? e.message : 'Gagal masuk. Coba lagi.');

/** Saat keyboard terbuka, kepala bermerek diperkecil agar kedua kolom dan tombol tetap terlihat di atas keyboard. */
function useKeyboardOpen() {
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const a = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setKb(true));
    const b = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return kb;
}

/** Isian, status, dan aksi masuk / lupa kata sandi. */
function useLoginForm() {
  const { login } = useSession();
  const [username, setUsernameRaw] = useState('');
  const [password, setPasswordRaw] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const passRef = useRef<TextInput>(null);
  const userRef = useRef<TextInput>(null);
  useEffect(() => { void lastUser.get().then((u) => u && setUsernameRaw((cur) => cur || u)); }, []);
  const setUsername = (v: string) => { setUsernameRaw(v); setErr(''); };
  const setPassword = (v: string) => { setPasswordRaw(v); setErr(''); };

  const submit = async () => {
    if (busy) return;
    if (!username.trim()) { setErr('Isi username Anda.'); userRef.current?.focus(); return; }
    if (!password) { setErr('Isi kata sandi Anda.'); passRef.current?.focus(); return; }
    setBusy(true); setErr(''); setInfo('');
    try { await login(lc(username), password); await lastUser.set(lc(username)); }
    catch (e) { setErr(loginError(e)); }
    finally { setBusy(false); }
  };

  /** Tanpa email/SMS: permintaan dikirim ke pengurus koperasi, yang akan memberi kata sandi sementara baru. */
  const forgot = async () => {
    if (!username.trim()) return setErr('Isi username Anda dulu, lalu ketuk "Lupa kata sandi?".');
    setBusy(true); setErr(''); setInfo('');
    try {
      await api('POST', '/auth/forgot', { username: lc(username) });
      setInfo('Permintaan terkirim ke pengurus koperasi. Mereka akan memberi Anda kata sandi sementara yang baru. Hubungi pengurus bila perlu segera.');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Gagal mengirim permintaan.'); }
    finally { setBusy(false); }
  };
  return { username, setUsername, password, setPassword, err, info, busy, passRef, userRef, submit, forgot };
}

type Form = ReturnType<typeof useLoginForm>;

function Hero({ kb }: { kb: boolean }) {
  return (
    <View style={[s.hero, kb && s.heroKb]}>
      {!kb && <View style={[s.blob, { width: 220, height: 220, top: -90, right: -70, backgroundColor: C.gold, opacity: 0.18 }]} />}
      {!kb && <View style={[s.blob, { width: 150, height: 150, bottom: -40, left: -50, backgroundColor: '#ffffff', opacity: 0.07 }]} />}
      <View style={[s.logoPlate, kb && s.logoPlateKb]}>
        <Image source={require('../assets/sajada-horizontal.png')} style={kb ? s.logoKb : s.logo} resizeMode="contain" accessibilityLabel="Sajadah" />
      </View>
      {!kb && <Text style={s.tagline}>Tumbuh bersama, berdaya bersama.</Text>}
    </View>
  );
}

/** TextInput memenuhi seluruh kotak (area sentuh penuh); ikon dan tombol diletakkan di atasnya. */
function UserField({ f, on, setFocus }: { f: Form; on: boolean; setFocus: (v: boolean) => void }) {
  return (
    <>
      <Text style={[s.label, on && s.labelOn]}>Username</Text>
      <View style={s.wrapBox}>
        <TextInput
          ref={f.userRef} value={f.username} onChangeText={f.setUsername}
          style={[s.field, noOutline, on && s.fieldOn, { paddingRight: f.username && on ? 48 : 16 }]}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          placeholder="mis. budi.santoso" placeholderTextColor="#93aaa3" selectionColor={C.green}
          autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="username" textContentType="username"
          importantForAutofill="yes" returnKeyType="next" onSubmitEditing={() => f.passRef.current?.focus()} blurOnSubmit={false}
        />
        <View pointerEvents="none" style={s.leadIcon}><Ionicons name="person-outline" size={22} color={on ? C.green : '#7f9a92'} /></View>
        {!!f.username && on && (
          <Pressable accessibilityRole="button" accessibilityLabel="Hapus username" onPress={() => { f.setUsername(''); f.userRef.current?.focus(); }} hitSlop={8} style={s.trailBtn}>
            <Ionicons name="close-circle" size={20} color="#9db3ac" />
          </Pressable>
        )}
      </View>
    </>
  );
}

function PasswordField({ f, on, setFocus }: { f: Form; on: boolean; setFocus: (v: boolean) => void }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <Text style={[s.label, { marginTop: 16 }, on && s.labelOn]}>Kata sandi</Text>
      <View style={s.wrapBox}>
        <TextInput
          ref={f.passRef} value={f.password} onChangeText={f.setPassword}
          style={[s.field, noOutline, on && s.fieldOn, { paddingRight: 52 }]}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          placeholder="Kata sandi Anda" placeholderTextColor="#93aaa3" selectionColor={C.green}
          secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="current-password" textContentType="password"
          importantForAutofill="yes" returnKeyType="go" onSubmitEditing={f.submit}
        />
        <View pointerEvents="none" style={s.leadIcon}><Ionicons name="lock-closed-outline" size={22} color={on ? C.green : '#7f9a92'} /></View>
        <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'} onPress={() => setShow((v) => !v)} hitSlop={8} style={s.trailBtn}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={24} color={C.green} />
        </Pressable>
      </View>
    </>
  );
}

function Notices({ err, info }: { err: string; info: string }) {
  return (
    <>
      {err ? <View style={s.alert} accessibilityRole="alert"><View style={s.alertBar} /><Text style={s.alertTxt}>{err}</Text></View> : null}
      {info ? <View style={[s.alert, { backgroundColor: C.ok[0] }]}><View style={[s.alertBar, { backgroundColor: C.green }]} /><Text style={[s.alertTxt, { color: C.green }]}>{info}</Text></View> : null}
    </>
  );
}

function Actions({ f }: { f: Form }) {
  return (
    <>
      <Pressable accessibilityRole="button" onPress={f.submit} disabled={f.busy} style={({ pressed }) => [s.cta, { opacity: f.busy ? 0.75 : pressed ? 0.88 : 1 }]}>
        {f.busy ? <ActivityIndicator color="#fff" /> : <Text style={s.ctaTxt}>Masuk</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" onPress={f.forgot} disabled={f.busy} hitSlop={10} style={s.forgot}>
        <Text style={s.forgotTxt}>Lupa kata sandi?</Text>
      </Pressable>
    </>
  );
}

function Footer({ kb }: { kb: boolean }) {
  if (kb) return null;
  return (
    <>
      <Text style={s.foot}>Koperasi · Sajadah</Text>
      {__DEV__ ? <Text style={[s.foot, { fontSize: 10 }]}>Server: {apiBase()}</Text> : null}
    </>
  );
}

export default function Login() {
  const { me } = useSession();
  const f = useLoginForm();
  const kb = useKeyboardOpen();
  const [focus, setFocus] = useState<'u' | 'p' | null>(null);
  if (me) return <Redirect href="/" />;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" bounces={false}>
        <Hero kb={kb} />
        <View style={s.sheet}>
          <View style={s.grab} />
          <Text style={[s.title, kb && { marginBottom: 14 }]}>Masuk</Text>
          {!kb && <Text style={s.sub}>Gunakan username dan kata sandi dari pengurus koperasi.</Text>}
          <UserField f={f} on={focus === 'u'} setFocus={(v) => setFocus(v ? 'u' : null)} />
          <PasswordField f={f} on={focus === 'p'} setFocus={(v) => setFocus(v ? 'p' : null)} />
          <Notices err={f.err} info={f.info} />
          <Actions f={f} />
          <View style={{ flex: 1, minHeight: 12 }} />
          <Footer kb={kb} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Di web, hilangkan garis fokus bawaan browser (kolom sudah punya tanda fokus sendiri).
const noOutline = (Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } : {}) as object;

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.green },
  scroll: { flexGrow: 1 },
  hero: { alignItems: 'center', justifyContent: 'center', paddingTop: 64, paddingBottom: 40, paddingHorizontal: 24, overflow: 'hidden' },
  heroKb: { paddingTop: 34, paddingBottom: 16 },
  logoPlateKb: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 },
  logoKb: { width: 140, height: 39 },
  blob: { position: 'absolute', borderRadius: 999 },
  logoPlate: { backgroundColor: '#ffffff', borderRadius: 22, paddingHorizontal: 22, paddingVertical: 16, boxShadow: '0 6px 14px rgba(0,0,0,0.18)' },
  logo: { width: 230, height: 64 },
  tagline: { marginTop: 18, color: C.gold, fontSize: 14, fontWeight: '600', letterSpacing: 0.3, textAlign: 'center' },
  sheet: { flex: 1, backgroundColor: '#ffffff', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 22 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 18 },
  title: { fontSize: 26, fontWeight: '700', color: C.green },
  sub: { marginTop: 4, marginBottom: 22, color: C.muted, fontSize: 14, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '700', color: C.muted, marginBottom: 8, letterSpacing: 0.2 },
  labelOn: { color: C.green },
  wrapBox: { position: 'relative', justifyContent: 'center' },
  // Kotak = TextInput itu sendiri (tinggi eksplisit); padding kiri memberi ruang untuk ikon yang ditumpuk di atasnya.
  field: { height: 58, borderWidth: 1.5, borderColor: '#cddfd9', backgroundColor: '#f6faf8', borderRadius: 16, paddingLeft: 48, paddingVertical: 0, fontSize: 17, color: C.ink, textAlignVertical: 'center', includeFontPadding: false },
  fieldOn: { borderColor: C.green, backgroundColor: '#ffffff' },
  leadIcon: { position: 'absolute', left: 14, top: 0, bottom: 0, justifyContent: 'center' },
  trailBtn: { position: 'absolute', right: 4, top: 0, bottom: 0, width: 46, alignItems: 'center', justifyContent: 'center' },
  alert: { flexDirection: 'row', backgroundColor: C.bad[0], borderRadius: 12, marginTop: 14, overflow: 'hidden' },
  alertBar: { width: 4, backgroundColor: C.bad[1] },
  alertTxt: { flex: 1, color: C.bad[1], padding: 12, fontSize: 13, lineHeight: 18 },
  cta: { height: 54, marginTop: 22, borderRadius: 14, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: C.gold },
  ctaTxt: { color: '#ffffff', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
  forgot: { alignSelf: 'center', paddingVertical: 14 },
  forgotTxt: { color: C.green, fontWeight: '600', fontSize: 14 },
  foot: { textAlign: 'center', color: '#8aa59d', fontSize: 12 },
});
