import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useData } from '../../src/hooks';
import { useDialog } from '../../src/dialog';
import { useSession } from '../../src/session';
import { Avatar, MenuRow, SectionHead } from '../../src/AccountParts';
import { StaffHeader } from '../../src/StaffParts';
import { C } from '../../src/theme';
import { Button } from '../../src/ui';
import { guardGroup } from '../../src/roleRoute';


/** Akun petugas toko: nama, toko, ganti kata sandi, dan keluar. */
function StaffProfile() {
  const { me, logout } = useSession();
  const router = useRouter();
  const dialog = useDialog();
  const tasks = useData<{ tenant: { name: string; depotName: string } }>('/overview/depot-tasks');
  const name = me?.name ?? '';
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <StaffHeader title="Akun Saya">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 16 }}>
          <Avatar name={name} url={null} size={72} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '700' }} numberOfLines={1}>{name}</Text>
            <Text style={{ color: '#ffffff', fontSize: 14 }}>Petugas toko</Text>
            <Text style={{ color: C.gold, fontSize: 13, fontWeight: '600' }}>{tasks.data ? `${tasks.data.tenant.depotName} · ${tasks.data.tenant.name}` : ''}</Text>
          </View>
        </View>
      </StaffHeader>
      <View style={{ padding: 16, gap: 12, marginTop: -20 }}>
        <SectionHead>Pengaturan Akun</SectionHead>
        <View>
          <MenuRow title="Ubah Kata Sandi" sub="Ubah kata sandi kamu" onPress={() => router.push('/ganti-sandi')} />
        </View>
        <Text style={{ color: C.muted, fontSize: 12 }}>Fokus pekerjaan toko: pesanan, stok, kiriman dari pusat, dan opname. Anggota, keuangan, dan komisi dikelola pengurus di web.</Text>
        <Button label="Keluar" kind="ghost" onPress={() => void dialog.confirm({ title: 'Keluar dari Sajadah?', message: 'Anda perlu masuk lagi untuk memakai aplikasi.', confirmLabel: 'Ya, keluar', cancelLabel: 'Batal', danger: true }).then((ok) => { if (ok) void logout(); })} />
      </View>
    </ScrollView>
  );
}

export default guardGroup('staff', 'profile', StaffProfile);
