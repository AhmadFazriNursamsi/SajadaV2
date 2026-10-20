import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, apiBase } from '../../src/api';
import { CoinIcon } from '../../src/CoinIcon';
import { useData } from '../../src/hooks';
import { BackBar } from '../../src/shop';
import { C } from '../../src/theme';
import { Button, Card, Row } from '../../src/ui';

interface Voucher { id: string; name: string; description: string | null; coinCost: number; stock: number; imageUrl: string | null }
interface Entry { id: string; kind: string; amount: number; refNo: string | null; note: string | null; createdAt: string }
interface Redemption { id: string; no: string; voucherName: string; coins: number; status: 'pending' | 'fulfilled' | 'rejected'; code: string | null; reason: string | null; createdAt: string }
interface Coins { balance: number; vouchers: Voucher[]; entries: Entry[]; redemptions: Redemption[] }
type Msg = { ok: boolean; text: string } | null;

const RSTATUS = { pending: ['Menunggu pengurus', 'warn'], fulfilled: ['Diterbitkan', 'ok'], rejected: ['Ditolak', 'bad'] } as const;
const day = (s: string) => new Date(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

/** Tukar voucher; hasil ditampilkan di halaman (Alert tidak tampil di web). */
function useRedeem(setMsg: (m: Msg) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Voucher) => api('POST', `/me/vouchers/${v.id}/redeem`),
    onSuccess: (_d, v) => { setMsg({ ok: true, text: `Penukaran ${v.name} diajukan. Pengurus akan menerbitkan vouchernya.` }); void qc.invalidateQueries(); },
    onError: (e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Gagal menukar voucher. Coba lagi.' }),
  });
}

function VoucherCard({ v, balance, busy, onRedeem }: { v: Voucher; balance: number; busy: boolean; onRedeem: () => void }) {
  const enough = balance >= v.coinCost, out = v.stock < 1;
  return (
    <View style={s.voucher}>
      {v.imageUrl ? <Image source={{ uri: apiBase() + v.imageUrl }} resizeMode="cover" accessibilityLabel={v.name} style={s.photo} /> : null}
      <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink }}>{v.name}</Text>
      {v.description ? <Text style={{ color: C.muted, fontSize: 13, marginTop: 4, lineHeight: 19 }}>{v.description}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <CoinIcon size={18} />
        <Text style={{ flex: 1, color: C.goldInk, fontWeight: '700', fontSize: 16 }}>{v.coinCost.toLocaleString('id-ID')} koin</Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>{out ? 'Stok habis' : `Sisa ${v.stock}`}</Text>
      </View>
      <View style={{ marginTop: 10 }}>
        <Button label={busy ? 'Memproses…' : out ? 'Stok habis' : enough ? 'Tukar' : `Kurang ${(v.coinCost - balance).toLocaleString('id-ID')} koin`} disabled={busy || out || !enough} onPress={onRedeem} />
      </View>
    </View>
  );
}

function History({ c }: { c: Coins }) {
  return (
    <>
      <Text style={s.h}>Penukaran</Text>
      <Card>
        {c.redemptions.length === 0 ? <Row title="Belum ada penukaran" /> : c.redemptions.map((r) => (
          <Row key={r.id} title={`${r.no} · ${r.voucherName}`} sub={`${r.coins} koin · ${day(r.createdAt)}${r.code ? ` · Kode: ${r.code}` : ''}${r.reason ? ` · ${r.reason}` : ''}`} right={RSTATUS[r.status][0]} tone={RSTATUS[r.status][1]} />
        ))}
      </Card>
      <Text style={s.h}>Riwayat koin</Text>
      <Card>
        {c.entries.length === 0 ? <Row title="Belum ada koin" sub="Koin masuk saat belanja sendiri sudah diterima, sesuai koin tiap produk." /> : c.entries.map((e) => (
          <Row key={e.id} title={e.note ?? e.kind} sub={`${day(e.createdAt)}${e.refNo ? ` · ${e.refNo}` : ''}`} right={`${e.amount > 0 ? '+' : '−'}${Math.abs(e.amount).toLocaleString('id-ID')}`} tone={e.amount > 0 ? 'ok' : 'neutral'} />
        ))}
      </Card>
    </>
  );
}

/** Koin Sajadah: saldo koin, voucher yang bisa ditukar (umroh dll), dan riwayatnya. */
export default function CoinsScreen() {
  const q = useData<Coins>('/me/coins');
  const { refetch } = q;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const [msg, setMsg] = useState<Msg>(null);
  const redeem = useRedeem(setMsg);
  const c = q.data;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BackBar title="Koin Sajadah" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}>
        {!c ? (q.error ? <Text style={{ color: C.bad[1] }}>Gagal memuat: {(q.error as Error).message}</Text> : <ActivityIndicator color={C.green} style={{ marginTop: 40 }} />) : (<>
          <View style={s.hero}>
            <Text style={{ color: '#ffffff', opacity: 0.85, fontSize: 13 }}>Koin kamu</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <CoinIcon size={34} />
              <Text style={{ color: '#ffffff', fontSize: 32, fontWeight: '700' }}>{c.balance.toLocaleString('id-ID')}</Text>
            </View>
            <Text style={{ color: C.gold, fontSize: 12 }}>Tiap produk punya koin sendiri, masuk setelah belanja diterima</Text>
          </View>
          {msg && <View style={{ backgroundColor: msg.ok ? C.ok[0] : C.bad[0], borderRadius: 8, padding: 12 }}><Text style={{ color: msg.ok ? C.green : C.bad[1] }}>{msg.text}</Text></View>}
          <Text style={s.h}>Tukar Voucher</Text>
          {c.vouchers.length === 0 ? <Text style={{ color: C.muted }}>Belum ada voucher yang bisa ditukar.</Text> : c.vouchers.map((v) => (
            <VoucherCard key={v.id} v={v} balance={c.balance} busy={redeem.isPending} onRedeem={() => { setMsg(null); redeem.mutate(v); }} />
          ))}
          <History c={c} />
        </>)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: C.side, borderRadius: 14, padding: 18, gap: 4 },
  h: { fontSize: 17, fontWeight: '700', color: C.ink, marginTop: 6 },
  photo: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8, marginBottom: 10, backgroundColor: C.ok[0] },
  voucher: { backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14 },
});
