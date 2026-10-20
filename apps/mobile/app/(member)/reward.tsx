import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MIN_WITHDRAWAL } from '@sajadah/shared';
import { ApiError, api } from '../../src/api';
import { rupiah, useData } from '../../src/hooks';
import { BackBar } from '../../src/shop';
import { C } from '../../src/theme';
import { Button, Card, Row } from '../../src/ui';
import { ComboField } from '../../src/FormFields';

interface Entry { id: string; kind: string; amount: number; refNo: string | null; note: string | null; createdAt: string }
interface Withdrawal { id: string; no: string; amount: number; bank: string; accountNo: string; accountName: string; status: 'pending' | 'paid' | 'rejected'; reason: string | null; createdAt: string }
interface Rewards { percent: number; balance: number; entries: Entry[]; withdrawals: Withdrawal[] }
type Mode = 'withdraw' | 'transfer' | null;
type Msg = { ok: boolean; text: string } | null;

const BANKS = ['BCA', 'BRI', 'BNI', 'Mandiri', 'BSI (Bank Syariah Indonesia)', 'CIMB Niaga', 'Permata', 'Danamon', 'BTN', 'OCBC', 'Panin', 'Maybank', 'BJB', 'Bank DKI', 'BTPN / Jenius', 'Bank Jago', 'SeaBank', 'Muamalat'].map((b) => ({ v: b, l: b }));
const WSTATUS = { pending: ['Menunggu pengurus', 'warn'], paid: ['Sudah ditransfer', 'ok'], rejected: ['Ditolak', 'bad'] } as const;
const day = (s: string) => new Date(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const digits = (v: string) => Number(v.replace(/\D/g, '')) || 0;

function Input({ label, value, onChange, keyboard, placeholder }: { label: string; value: string; onChange: (v: string) => void; keyboard?: 'numeric'; placeholder?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: C.ink }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType={keyboard} placeholder={placeholder} placeholderTextColor={C.muted} autoCapitalize="none" style={s.input} />
    </View>
  );
}

/** Kirim ke API, tampilkan hasilnya di halaman (Alert tidak tampil di web), lalu segarkan semua data. */
function useSend(onDone: () => void, setMsg: (m: Msg) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { path: string; body: unknown; ok: string }) => api('POST', v.path, v.body),
    onSuccess: (_d, v) => { setMsg({ ok: true, text: v.ok }); onDone(); void qc.invalidateQueries(); },
    onError: (e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Terjadi kesalahan' }),
  });
}

function TransferForm({ balance, setMsg, onDone }: { balance: number; setMsg: (m: Msg) => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const send = useSend(onDone, setMsg);
  const n = digits(amount);
  return (
    <Card>
      <View style={s.form}>
        <Text style={s.h}>Pindahkan ke saldo belanja</Text>
        <Input label="Jumlah (Rp)" value={amount} onChange={setAmount} keyboard="numeric" placeholder="mis. 50000" />
        <Pressable onPress={() => setAmount(String(balance))} hitSlop={8}><Text style={{ color: C.green, fontWeight: '600' }}>Pindahkan semua ({rupiah(balance)})</Text></Pressable>
        <Button label={send.isPending ? 'Memproses…' : 'Pindahkan'} disabled={send.isPending || n < 1 || n > balance} onPress={() => send.mutate({ path: '/me/rewards/transfer', body: { amount: n }, ok: `${rupiah(n)} dipindahkan ke saldo belanja.` })} />
      </View>
    </Card>
  );
}

function WithdrawForm({ balance, setMsg, onDone }: { balance: number; setMsg: (m: Msg) => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: '', bank: '', accountNo: '', accountName: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const send = useSend(onDone, setMsg);
  const n = digits(f.amount);
  const tooSmall = n > 0 && n < MIN_WITHDRAWAL;
  const ok = n >= MIN_WITHDRAWAL && n <= balance && f.bank.trim().length >= 2 && /^\d{5,25}$/.test(f.accountNo.trim()) && f.accountName.trim().length >= 2;
  return (
    <Card>
      <View style={s.form}>
        <Text style={s.h}>Tarik ke rekening</Text>
        <Input label="Jumlah (Rp)" value={f.amount} onChange={set('amount')} keyboard="numeric" placeholder="mis. 50000" />
        {tooSmall ? <Text style={{ color: C.bad[1], fontSize: 13 }}>Penarikan minimal {rupiah(MIN_WITHDRAWAL)}.</Text> : n > balance ? <Text style={{ color: C.bad[1], fontSize: 13 }}>Melebihi saldo penarikan ({rupiah(balance)}).</Text> : <Text style={{ color: C.muted, fontSize: 12 }}>Minimal penarikan {rupiah(MIN_WITHDRAWAL)}.</Text>}
        {balance >= MIN_WITHDRAWAL ? <Pressable onPress={() => set('amount')(String(balance))} hitSlop={8}><Text style={{ color: C.green, fontWeight: '600' }}>Tarik semua ({rupiah(balance)})</Text></Pressable> : <Text style={{ color: C.warn[1], fontSize: 13 }}>Saldo penarikan belum mencapai minimal {rupiah(MIN_WITHDRAWAL)}. Anda tetap bisa memindahkannya ke saldo belanja.</Text>}
        <ComboField title="Bank" value={f.bank} options={BANKS} onChange={set('bank')} placeholder="Pilih bank" />
        <Input label="Nomor rekening" value={f.accountNo} onChange={set('accountNo')} keyboard="numeric" />
        <Input label="Nama pemilik rekening" value={f.accountName} onChange={set('accountName')} />
        <Text style={{ color: C.muted, fontSize: 12 }}>Saldo ditahan sampai pengurus mentransfer. Bila ditolak, saldo kembali.</Text>
        <Button label={send.isPending ? 'Mengajukan…' : 'Ajukan penarikan'} disabled={send.isPending || !ok}
          onPress={() => send.mutate({ path: '/me/withdrawals', body: { amount: n, bank: f.bank.trim(), accountNo: f.accountNo.trim(), accountName: f.accountName.trim() }, ok: `Penarikan ${rupiah(n)} diajukan. Menunggu pengurus mentransfer.` })} />
      </View>
    </Card>
  );
}

function History({ r }: { r: Rewards }) {
  return (
    <>
      <Text style={s.h}>Penarikan</Text>
      <Card>
        {r.withdrawals.length === 0 ? <Row title="Belum ada penarikan" /> : r.withdrawals.map((w) => (
          <Row key={w.id} title={`${w.no} · ${rupiah(w.amount)}`} sub={`${w.bank} ${w.accountNo} · ${day(w.createdAt)}${w.reason ? ` · ${w.reason}` : ''}`} right={WSTATUS[w.status][0]} tone={WSTATUS[w.status][1]} />
        ))}
      </Card>
      <Text style={s.h}>Riwayat saldo</Text>
      <Card>
        {r.entries.length === 0 ? <Row title="Belum ada riwayat" sub={`${r.percent}% dari belanja yang sudah diterima akan masuk di sini.`} /> : r.entries.map((e) => (
          <Row key={e.id} title={e.note ?? e.kind} sub={`${day(e.createdAt)}${e.refNo ? ` · ${e.refNo}` : ''}`} right={`${e.amount > 0 ? '+' : '−'}${rupiah(Math.abs(e.amount))}`} tone={e.amount > 0 ? 'ok' : 'neutral'} />
        ))}
      </Card>
    </>
  );
}

/** Saldo penarikan: dari 20% belanja yang sudah diterima. Bisa ditarik ke rekening (disetujui pengurus) atau dipindah ke saldo belanja. */
export default function RewardScreen() {
  const q = useData<Rewards>('/me/rewards');
  const { refetch } = q;
  // Layar tetap terpasang: muat ulang setiap dibuka (mis. penarikan ditolak/dibayar pengurus).
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const [mode, setMode] = useState<Mode>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const r = q.data;
  const pick = (m: Exclude<Mode, null>) => () => { setMsg(null); setMode(mode === m ? null : m); };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <BackBar title="Saldo Penarikan" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void refetch()} />}>
        {!r ? <Text style={{ color: q.error ? C.bad[1] : C.muted }}>{q.error ? `Gagal memuat: ${(q.error as Error).message}` : 'Memuat…'}</Text> : (<>
          <View style={s.hero}>
            <Text style={{ color: '#ffffff', opacity: 0.85, fontSize: 13 }}>Saldo penarikan</Text>
            <Text style={{ color: '#ffffff', fontSize: 30, fontWeight: '700' }}>{rupiah(r.balance)}</Text>
            <Text style={{ color: C.gold, fontSize: 12 }}>{r.percent}% dari setiap belanja yang sudah diterima</Text>
            <Text style={{ color: '#ffffff', opacity: 0.85, fontSize: 12, marginTop: 4 }}>Tiap hari aktif, Rp30.000 dipotong untuk tagihan harian.</Text>
          </View>
          {msg && <View style={{ backgroundColor: msg.ok ? C.ok[0] : C.bad[0], borderRadius: 8, padding: 12 }}><Text style={{ color: msg.ok ? C.green : C.bad[1] }}>{msg.text}</Text></View>}
          <Button label="Tarik ke rekening" onPress={pick('withdraw')} />
          <Button label="Pindahkan ke saldo belanja" kind="ghost" onPress={pick('transfer')} />
          {mode === 'withdraw' && <WithdrawForm balance={r.balance} setMsg={setMsg} onDone={() => setMode(null)} />}
          {mode === 'transfer' && <TransferForm balance={r.balance} setMsg={setMsg} onDone={() => setMode(null)} />}
          <History r={r} />
        </>)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: C.side, borderRadius: 14, padding: 18, gap: 2 },
  h: { fontSize: 16, fontWeight: '700', color: C.ink, marginTop: 4 },
  form: { padding: 14, gap: 12 },
  input: { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink },
});
