import { useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDialog } from '../../src/dialog';
import { api } from '../../src/api';
import { C } from '../../src/theme';
import { Button, Card, Chips, Note, Row, Screen } from '../../src/ui';
import { rupiah, useData } from '../../src/hooks';
import { pickReceiptPhoto, type ReceiptPhoto } from '../../src/receiptPhoto';

interface Line { id: string; productId: string; product: string; qty: number; groupId: string; groupNo: string; lineNo: number; total: number }
const ISSUES: { v: string; l: string }[] = [{ v: 'kurang', l: 'Kurang' }, { v: 'rusak', l: 'Rusak' }, { v: 'salah_kirim', l: 'Salah produk' }, { v: 'lainnya', l: 'Lainnya' }];
const input = { height: 50, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 0, fontSize: 18, color: C.ink, textAlignVertical: 'center' } as const;

type Patch = Partial<{ qty: string; issue: string; note: string }>;
interface CheckRow { l: Line; c: { qty: string; issue: string; note: string }; got: number; valid: boolean; diff: number; needIssue: boolean; needNote: boolean }

const blank = (l: Line) => ({ qty: String(l.qty), issue: '', note: '' });

function buildRows(lines: Line[], chk: Record<string, { qty: string; issue: string; note: string }>): CheckRow[] {
  return lines.map((l) => {
    const c = chk[l.productId] ?? blank(l);
    const got = c.qty.trim() === '' ? NaN : Math.floor(Number(c.qty));
    const valid = Number.isInteger(got) && got >= 0 && got <= l.qty;
    const diff = valid ? l.qty - got : 0;
    return { l, c, got, valid, diff, needIssue: diff > 0 && !c.issue, needNote: diff > 0 && c.issue === 'lainnya' && !c.note.trim() };
  });
}

/** State, turunan, dan pengiriman pemeriksaan barang. */
function useCheck(id: string) {
  const dialog = useDialog();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useData<{ orders: Line[] }>('/me/orders');
  const all = q.data?.orders ?? [];
  const head = all.find((o) => o.id === id);
  const lines = all.filter((o) => head && o.groupId === head.groupId).sort((a, b) => a.lineNo - b.lineNo);
  const [chk, setChk] = useState<Record<string, { qty: string; issue: string; note: string }>>({});
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ dataUrl: string; uri: string } | null>(null);
  const rows = buildRows(lines, chk);
  const problem = !photo || rows.some((r) => !r.valid || r.needIssue || r.needNote);
  const totalDiff = rows.reduce((n, r) => n + (r.valid ? r.diff : 0), 0);
  const patch = (l: Line, p: Patch) => setChk((m) => ({ ...m, [l.productId]: { ...(m[l.productId] ?? blank(l)), ...p } }));
  const send = useMutation({
    mutationFn: () => api('POST', `/me/orders/${id}/check`, { photo: photo?.dataUrl, note: note.trim() || undefined, items: rows.map((r) => ({ productId: r.l.productId, qty: r.got, issue: r.diff > 0 ? r.c.issue : undefined, note: r.diff > 0 ? r.c.note.trim() || undefined : undefined })) }),
    onSuccess: () => { void dialog.alert({ title: 'Foto terkirim', message: totalDiff ? 'Petugas toko akan memeriksa foto dan laporan Anda. Pesanan selesai setelah petugas menyatakan valid; statusnya terlihat di tab Transaksi.' : 'Petugas toko akan memeriksa foto Anda. Pesanan selesai setelah petugas menyatakan valid; statusnya terlihat di tab Transaksi.', kind: 'success' }); void qc.invalidateQueries(); router.back(); },
    onError: (e) => void dialog.fail(e, 'Pemeriksaan belum terkirim'),
  });
  const ask = () => void dialog.confirm({ title: 'Kirim foto dan pemeriksaan?', message: totalDiff ? `Laporkan selisih ${totalDiff} beserta foto ke toko? Pemeriksaan hanya bisa diulang bila foto ditolak petugas.` : 'Konfirmasi semua barang sesuai pesanan beserta foto? Pemeriksaan hanya bisa diulang bila foto ditolak petugas.', confirmLabel: 'Ya, kirim', cancelLabel: 'Periksa lagi' }).then((ok) => ok && send.mutate());
  return { q, head, lines, rows, problem, totalDiff, note, setNote, photo, setPhoto, patch, ask, sending: send.isPending };
}

const statusOf = (r: CheckRow) => (!r.valid ? 'Periksa' : r.diff > 0 ? `−${r.diff}` : 'Sesuai');

function IssueFields({ row, onPatch }: { row: CheckRow; onPatch: (p: Patch) => void }) {
  const { c, needIssue, needNote } = row;
  return (
    <>
      <Text style={{ color: needIssue ? C.bad[1] : C.muted, fontSize: 12, fontWeight: '600' }}>Alasan {needIssue ? '(wajib dipilih)' : ''}</Text>
      <Chips value={c.issue || '_'} onChange={(v) => onPatch({ issue: v === '_' ? '' : v })} options={ISSUES} />
      <TextInput value={c.note} onChangeText={(v) => onPatch({ note: v })} placeholder={c.issue === 'lainnya' ? 'Jelaskan (wajib)' : 'Catatan (opsional)'} placeholderTextColor="#93aaa3" style={[input, { fontSize: 15, height: 44 }, needNote && { borderColor: C.bad[1] }]} />
    </>
  );
}

function LineCard({ row, onPatch }: { row: CheckRow; onPatch: (p: Patch) => void }) {
  const { l, c, valid, diff } = row;
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: diff > 0 ? C.bad[1] : C.line, padding: 12, gap: 8 }}>
      <Row title={l.product} sub={`Dipesan ${l.qty}`} right={statusOf(row)} tone={!valid || diff > 0 ? 'bad' : 'ok'} />
      <TextInput value={c.qty} onChangeText={(v) => onPatch({ qty: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="Diterima berapa?" placeholderTextColor="#93aaa3" selectionColor={C.green} accessibilityLabel={`Diterima ${l.product}`} style={[input, !valid && { borderColor: C.bad[1] }]} />
      {!valid && <Text style={{ color: C.bad[1], fontSize: 12 }}>Isi angka 0 sampai {l.qty}.</Text>}
      {diff > 0 && <IssueFields row={row} onPatch={onPatch} />}
    </View>
  );
}

/** Foto barang yang diterima (wajib): kamera atau galeri. Petugas toko memeriksa foto ini sebelum pesanan selesai. */
function PhotoCard({ photo, onPick }: { photo: { uri: string } | null; onPick: (p: { dataUrl: string; uri: string }) => void }) {
  const dialog = useDialog();
  const take = async (source: 'camera' | 'library') => {
    try {
      const r: ReceiptPhoto = await pickReceiptPhoto(source);
      if (r === 'denied') void dialog.alert({ title: 'Izin diperlukan', message: source === 'camera' ? 'Izinkan akses kamera di pengaturan untuk memotret barang.' : 'Izinkan akses foto di pengaturan untuk memilih foto barang.', kind: 'error' });
      else if (r) onPick(r);
    } catch (e) { void dialog.fail(e, 'Foto belum bisa diambil'); }
  };
  const btn = { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: C.green, alignItems: 'center' as const };
  return (
    <Card>
      <Text style={{ color: C.ink, fontWeight: '700' }}>Foto barang yang diterima <Text style={{ color: C.bad[1] }}>(wajib)</Text></Text>
      {photo ? <Image source={{ uri: photo.uri }} resizeMode="cover" accessibilityLabel="Foto barang yang diterima" style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 10, backgroundColor: C.neutral[0] }} />
        : <Text style={{ color: C.muted, fontSize: 12 }}>Foto semua barang yang Anda terima agar petugas toko bisa memeriksa kesesuaiannya.</Text>}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable onPress={() => void take('camera')} accessibilityRole="button" style={btn}><Text style={{ color: C.green, fontWeight: '700' }}>{photo ? 'Foto ulang' : 'Ambil foto'}</Text></Pressable>
        <Pressable onPress={() => void take('library')} accessibilityRole="button" style={btn}><Text style={{ color: C.green, fontWeight: '700' }}>Pilih dari galeri</Text></Pressable>
      </View>
    </Card>
  );
}

function Summary({ totalDiff }: { totalDiff: number }) {
  return <Card><Row title={totalDiff ? `Ada selisih ${totalDiff}` : 'Semua sesuai pesanan'} sub={totalDiff ? 'Akan dilaporkan ke toko.' : 'Tercatat sebagai sesuai.'} tone={totalDiff ? 'bad' : 'ok'} /></Card>;
}

const submitLabel = (sending: boolean, totalDiff: number) => (sending ? 'Mengirim…' : totalDiff ? 'Kirim foto & laporkan ke toko' : 'Kirim foto: semua sesuai');

/** Periksa barang yang dikirim: cocokkan dengan pesanan; bila tidak sesuai, laporkan ke toko. */
export default function CheckOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const k = useCheck(id);
  return (
    <Screen queries={[k.q]}>
      {k.head ? (<>
        <Card><Row title={`Pesanan ${k.head.groupNo}`} sub={`${k.lines.length} produk · ${rupiah(k.lines.reduce((s, l) => s + l.total, 0))}`} /></Card>
        <Note>Hitung barang yang benar-benar Anda terima dalam kondisi baik. Isian sudah sama dengan yang dipesan; ubah hanya bila ada yang kurang, rusak, atau salah, lalu pilih alasannya. Lampirkan foto barangnya. Petugas toko akan memeriksa foto itu dan baru setelah dinyatakan valid pesanan selesai. Pemeriksaan hanya bisa diulang bila foto ditolak petugas.</Note>
        {k.rows.map((r) => <LineCard key={r.l.productId} row={r} onPatch={(p) => k.patch(r.l, p)} />)}
        <PhotoCard photo={k.photo} onPick={k.setPhoto} />
        <TextInput value={k.note} onChangeText={k.setNote} placeholder="Catatan untuk toko (opsional)" placeholderTextColor="#93aaa3" style={[input, { fontSize: 15, height: 44 }]} />
        <Summary totalDiff={k.totalDiff} />
        <Button label={submitLabel(k.sending, k.totalDiff)} kind={k.totalDiff ? 'gold' : 'primary'} disabled={k.sending || k.problem} onPress={k.ask} />
        {k.problem && <Note>{k.photo ? 'Lengkapi dulu jumlah (0 sampai jumlah dipesan) dan alasan untuk setiap selisih.' : 'Lampirkan foto barang yang diterima, dan lengkapi jumlah serta alasan bila ada selisih.'}</Note>}
      </>) : <Note>Pesanan tidak ditemukan.</Note>}
      <Button label="Kembali" kind="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
