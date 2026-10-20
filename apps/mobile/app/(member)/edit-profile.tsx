import { useCallback, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../src/api';
import { pickAvatar } from '../../src/avatar';
import { useSession } from '../../src/session';
import { C } from '../../src/theme';
import { FAMILY_CODES } from '@sajadah/shared';
import { Button } from '../../src/ui';
import { ComboField, PhoneField } from '../../src/FormFields';
import { PHONE_RE, toLocalPhone, toStoredPhone } from '../../src/phone';
import { BackBar } from '../../src/shop';
import { Avatar } from '../../src/AccountParts';
import { useData } from '../../src/hooks';

interface Profile { name: string; phone: string | null; address: string | null; familyCode: string | null; avatarUrl: string | null }
type Form = { name: string; phone: string; address: string; familyCode: string };
const FAMILY = Object.entries(FAMILY_CODES).map(([v, l]) => ({ v, l }));
type Msg = { ok: boolean; text: string } | null;
const input = { height: 50, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 0, fontSize: 16, color: C.ink, textAlignVertical: 'center' } as const;

const formOf = (p: Profile): Form => ({ name: p.name, phone: toLocalPhone(p.phone), address: p.address ?? '', familyCode: p.familyCode ?? '' });
const isDirty = (p: Profile, f: Form) => f.name.trim() !== p.name || f.phone !== toLocalPhone(p.phone) || f.address.trim() !== (p.address ?? '') || f.familyCode !== (p.familyCode ?? '');
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function TextField({ label, value, onChange, ph, keyboard, hint }: { label: string; value: string; onChange: (v: string) => void; ph: string; keyboard?: 'phone-pad' | 'default'; hint?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: C.muted, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={ph} placeholderTextColor="#93aaa3" keyboardType={keyboard ?? 'default'} selectionColor={C.green} accessibilityLabel={label} style={input} />
      {hint ? <Text style={{ color: C.muted, fontSize: 12 }}>{hint}</Text> : null}
    </View>
  );
}

/** Ganti foto: pilih dari galeri, unggah, lalu segarkan profil. */
function usePhoto(setMsg: (m: Msg) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const pick = await pickAvatar();
      if (pick === 'denied') throw new ApiError(0, 'Izin galeri ditolak. Aktifkan di pengaturan HP untuk mengganti foto.');
      if (!pick) return false;
      await api('POST', '/me/avatar', pick);
      return true;
    },
    onSuccess: (changed) => { if (changed) { setMsg({ ok: true, text: 'Foto profil diganti.' }); void qc.invalidateQueries(); } },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Gagal mengganti foto. Coba lagi.') }),
  });
}

/** Isian profil dan penyimpanannya; kembali ke layar sebelumnya setelah tersimpan. */
function useProfileForm(p: Profile, setMsg: (m: Msg) => void) {
  const { refresh } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [f, setF] = useState<Form>(() => formOf(p));
  const save = useMutation({
    mutationFn: (v: Form) => api('PATCH', '/me', { name: v.name.trim(), phone: toStoredPhone(v.phone), address: v.address.trim(), ...(v.familyCode ? { familyCode: v.familyCode } : {}) }),
    onSuccess: async () => { await refresh(); void qc.invalidateQueries(); router.back(); },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Gagal menyimpan profil. Coba lagi.') }),
  });
  const set = (k: keyof Form) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return { f, set, save };
}

function PhotoBlock({ name, url, busy, onPress }: { name: string; url: string | null; busy: boolean; onPress: () => void }) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
      <Avatar name={name} url={url} size={110} />
      <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel="Ganti foto">
        <Text style={{ color: C.green, fontWeight: '700', fontSize: 15 }}>{busy ? 'Mengunggah…' : 'Ganti foto'}</Text>
      </Pressable>
    </View>
  );
}

function EditBody({ p }: { p: Profile }) {
  const [msg, setMsg] = useState<Msg>(null);
  const photo = usePhoto(setMsg);
  const { f, set, save } = useProfileForm(p, setMsg);
  return (
    <>
      <PhotoBlock name={f.name || p.name} url={p.avatarUrl} busy={photo.isPending} onPress={() => { setMsg(null); photo.mutate(); }} />
      {msg && <View style={{ backgroundColor: msg.ok ? C.ok[0] : C.bad[0], borderRadius: 8, padding: 12 }}><Text style={{ color: msg.ok ? C.green : C.bad[1] }}>{msg.text}</Text></View>}
      <TextField label="Nama lengkap" value={f.name} onChange={set('name')} ph="Nama Anda" />
      <PhoneField value={f.phone} onChange={set('phone')} />
      <TextField label="Alamat" value={f.address} onChange={set('address')} ph="Jalan, RT/RW, kelurahan" hint="Boleh dikosongkan." />
      <ComboField title="Status keluarga" value={f.familyCode} options={FAMILY} onChange={set('familyCode')} placeholder="Pilih status keluarga" />
      <Button label={save.isPending ? 'Menyimpan…' : 'Simpan'} disabled={save.isPending || !isDirty(p, f) || f.name.trim().length < 2 || !PHONE_RE.test(f.phone)} onPress={() => { setMsg(null); save.mutate(f); }} />
    </>
  );
}

/** Ubah profil: foto, nama, nomor HP, dan alamat di layar sendiri. */
export default function EditProfile() {
  const q = useData<Profile>('/me');
  const p = q.data;
  const { refetch } = q;
  // Form selalu dibangun dari data terbaru setiap layar dibuka (layar tab tetap terpasang di antara kunjungan).
  const [gen, setGen] = useState(0);
  useFocusEffect(useCallback(() => { void refetch().then(() => setGen((g) => g + 1)); }, [refetch]));
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BackBar title="Ubah Profil" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {p && gen > 0 ? <EditBody key={gen} p={p} /> : q.error ? <Text style={{ color: C.bad[1] }}>Gagal memuat: {(q.error as Error).message}</Text> : <ActivityIndicator color={C.green} style={{ marginTop: 40 }} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
