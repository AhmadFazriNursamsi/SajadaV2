import { useCallback } from 'react';
import { Share, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatReferral } from '@sajadah/shared';
import { C } from '../../src/theme';
import { Button, Card, Hero, Note, Row, Screen } from '../../src/ui';
import { rupiah, useData } from '../../src/hooks';

interface Net {
  referralCode: string; sponsor: string | null; personal: number; downlineVolume: number; group: number;
  bonus: { pending: number; approved: number; paid: number; thisMonth: number; total: number };
  perLevel: { level: number; percent: number; members: number; volume: number; bonus: number }[];
  downline: { id: string; name: string; level: number; active: boolean; referrals: number; volume: number; bonus: number }[];
}
const H = ({ children }: { children: string }) => <Text style={{ fontSize: 16, fontWeight: '600', color: C.green, marginTop: 6 }}>{children}</Text>;

/** Jaringan: kode referal untuk mengajak, orang yang diajak (tingkat 1–3), dan bonus dari penjualan mereka. */
export default function Network() {
  const q = useData<Net>('/me/network');
  const router = useRouter();
  useFocusEffect(useCallback(() => { void q.refetch(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));
  const d = q.data;
  const share = () => {
    if (!d) return;
    void Share.share({ message: `Ayo bergabung jadi anggota Koperasi Sajadah! Saat mendaftar lewat petugas koperasi, sebutkan kode referal saya: ${formatReferral(d.referralCode)}` }).catch(() => undefined);
  };
  return (
    <Screen queries={[q]}>
      {d && (<>
        <Hero label="Bonus jaringan Anda" value={rupiah(d.bonus.total)} note={`Bulan ini ${rupiah(d.bonus.thisMonth)} · dibayar ${rupiah(d.bonus.paid)}`} />
        <Card>
          <Row title="Menunggu persetujuan pengurus" right={rupiah(d.bonus.pending)} tone={d.bonus.pending ? 'warn' : 'neutral'} />
          <Row title="Disetujui, siap dibayar" right={rupiah(d.bonus.approved)} tone={d.bonus.approved ? 'ok' : 'neutral'} />
          <Row title="Sudah dibayar" right={rupiah(d.bonus.paid)} />
        </Card>

        <H>Ajak pelanggan jadi anggota</H>
        <View style={{ backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 14, gap: 8, alignItems: 'center' }}>
          <Text style={{ color: C.muted, fontSize: 12 }}>Kode referal saya</Text>
          <Text selectable style={{ fontSize: 30, fontWeight: '700', color: C.green, letterSpacing: 3, fontFamily: 'Menlo' }}>{formatReferral(d.referralCode)}</Text>
          <Button label="Bagikan ajakan" kind="gold" onPress={share} />
        </View>
        <Note>Beri kode ini ke pelanggan yang mau jadi anggota; petugas memasukkannya saat mendaftarkan mereka. Setelah itu Anda otomatis menjadi sponsornya dan mendapat bonus {d.perLevel[0]?.percent}% dari setiap penjualan mereka ke pelanggan (tingkat 2: {d.perLevel[1]?.percent}%, tingkat 3: {d.perLevel[2]?.percent}%), setelah pesanan lunas dan diterima.</Note>

        <H>Orang yang saya ajak</H>
        <Card>
          {d.perLevel.map((l) => (
            <Row key={l.level} title={`Tingkat ${l.level} · bonus ${l.percent}%`} sub={`${l.members} anggota · penjualan ${rupiah(l.volume)}`} right={rupiah(l.bonus)} tone={l.bonus ? 'ok' : 'neutral'} />
          ))}
        </Card>
        <Card>
          {d.downline.length === 0 ? <Row title="Belum ada yang diajak" sub="Bagikan kode referal Anda ke pelanggan." /> : d.downline.map((x) => (
            <Row key={x.id} title={`${x.name} · T${x.level}`} sub={`penjualan ${rupiah(x.volume)} · bonus Anda ${rupiah(x.bonus)}${x.referrals ? ` · mengajak ${x.referrals}` : ''}`} right={x.active ? 'aktif' : 'belum aktif'} tone={x.active ? 'ok' : 'warn'} />
          ))}
        </Card>
        <Card>
          <Row title="Sponsor saya" right={d.sponsor ?? 'Tanpa sponsor'} />
          <Row title="Volume penjualan Anda" sub="ke pelanggan umum, sudah lunas" right={rupiah(d.personal)} />
          <Row title="Volume penjualan jaringan" right={rupiah(d.downlineVolume)} />
        </Card>
        <Button label="Bagaimana komisi dihitung?" kind="ghost" onPress={() => router.push('/(member)/scheme')} />
        <Note>Bonus hanya dari penjualan ke pelanggan umum. Perubahan sponsor dikelola pengurus dan tidak mengubah bonus pesanan lama.</Note>
      </>)}
    </Screen>
  );
}
