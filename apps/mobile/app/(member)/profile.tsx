import { useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useDialog } from '../../src/dialog';
import { useSession } from '../../src/session';
import { C } from '../../src/theme';
import { Button } from '../../src/ui';
import { AccountHeader, BalanceCard, MenuRow, ProfileProgress, SectionHead } from '../../src/AccountParts';
import { useData } from '../../src/hooks';
import { guardGroup } from '../../src/roleRoute';

interface Profile { name: string; phone: string | null; address: string | null; familyCode: string | null; memberNo: string | null; avatarUrl: string | null; balance: number; rewardBalance: number; coinBalance: number; active: boolean }

const PARTS: [keyof Pick<Profile, 'name' | 'phone' | 'address' | 'familyCode'>, string][] = [['name', 'Nama'], ['phone', 'Nomor HP'], ['address', 'Alamat'], ['familyCode', 'Status keluarga']];
const missing = (p: Profile) => PARTS.filter(([k]) => !(p[k] ?? '').trim()).map(([, l]) => l);


/** Akun anggota bergaya Klik Indomaret: kepala hijau, saldo, kelengkapan profil, lalu menu pengaturan. Mengubah profil ada di layar sendiri. */
function ProfileScreen() {
  const q = useData<Profile>('/me');
  const { logout } = useSession();
  const router = useRouter();
  const dialog = useDialog();
  const { refetch } = q;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const p = q.data;
  const todo = p ? missing(p) : [];
  const edit = () => router.push('/(member)/edit-profile');
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void refetch()} />}>
      {q.isLoading ? <ActivityIndicator color={C.green} style={{ marginTop: 80 }} /> : q.error ? <Text style={{ color: C.bad[1], padding: 16 }}>Gagal memuat: {(q.error as Error).message}</Text> : p && (<>
        <AccountHeader name={p.name} avatarUrl={p.avatarUrl} phone={p.phone} family={p.familyCode} memberNo={p.memberNo} complete={todo.length === 0} onComplete={edit} />
        <BalanceCard balance={p.balance} active={p.active} reward={p.rewardBalance} coins={p.coinBalance} onReward={() => router.push('/(member)/reward')} onCoins={() => router.push('/(member)/coins')} />
        <View style={{ padding: 16, gap: 12 }}>
          {todo.length > 0 && <ProfileProgress done={PARTS.length - todo.length} total={PARTS.length} hint={`Tambahkan ${todo.join(', ')} di pengaturan profil.`} onPress={edit} />}
          <SectionHead>Pengaturan Akun</SectionHead>
          <View>
            <MenuRow title="Ubah Profil" sub="Foto, nama, nomor HP, alamat, dan status keluarga" onPress={edit} />
            <MenuRow title="Ubah Kata Sandi" sub="Ubah kata sandi kamu" onPress={() => router.push('/ganti-sandi')} />
            <MenuRow title="Informasi" sub="Penyertaan dan saldo belanja anggota" onPress={() => router.push('/(member)/info')} />
          </View>
          <Button label="Keluar" kind="ghost" onPress={() => void dialog.confirm({ title: 'Keluar dari Sajadah?', message: 'Anda perlu masuk lagi untuk memakai aplikasi.', confirmLabel: 'Ya, keluar', cancelLabel: 'Batal', danger: true }).then((ok) => { if (ok) void logout(); })} />
        </View>
      </>)}
    </ScrollView>
  );
}

export default guardGroup('member', 'profile', ProfileScreen);
