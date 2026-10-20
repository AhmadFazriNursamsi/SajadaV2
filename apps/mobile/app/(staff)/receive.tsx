import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SHIPMENT_ISSUES, SHIPMENT_ISSUE_LIST } from '@sajadah/shared';
import { useDialog } from '../../src/dialog';
import { api } from '../../src/api';
import { C } from '../../src/theme';
import { Button, Card, Chips, Note, Row, Screen } from '../../src/ui';
import { useData } from '../../src/hooks';

interface Ship { id: string; no: string; note: string | null; createdByName: string; createdAt: string; depotName: string; request: { no: string; lines: { productId: string; qty: number; qtySent: number }[] } | null; totalQty: number; lines: { productId: string; name: string; sku: string; qty: number }[] }
const input = { height: 50, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 0, fontSize: 18, color: C.ink, textAlignVertical: 'center' } as const;

type Patch = Partial<{ qty: string; issue: string; note: string }>;
type Entry = { qty: string; issue: string; note: string };
type ShipLine = Ship['lines'][number];
interface RecvRow { l: ShipLine; c: Entry; got: number; valid: boolean; diff: number; over: boolean; needIssue: boolean; needNote: boolean }

const blank = (l: ShipLine): Entry => ({ qty: String(l.qty), issue: '', note: '' });
const redBorder = { borderColor: C.bad[1] } as const;
const noteInput = { fontSize: 15, height: 44 } as const;
const ISSUE_OPTIONS = SHIPMENT_ISSUE_LIST.map((k) => ({ v: k, l: SHIPMENT_ISSUES[k].split(' (')[0]!.replace('Jumlah kurang dari yang dikirim', 'Kurang') }));

function buildRows(lines: ShipLine[], chk: Record<string, Entry>): RecvRow[] {
  return lines.map((l) => {
    const c = chk[l.productId] ?? blank(l);
    const got = c.qty.trim() === '' ? NaN : Math.floor(Number(c.qty));
    const valid = Number.isInteger(got) && got >= 0 && got <= 1_000_000;
    const diff = valid ? l.qty - got : 0;
    const over = valid && got > l.qty;
    const noteMissing = !c.note.trim();
    return { l, c, got, valid, diff, over, needIssue: diff > 0 && !c.issue, needNote: (diff > 0 && c.issue === 'lainnya' && noteMissing) || (over && noteMissing) };
  });
}

const rowStatus = (r: RecvRow) => (!r.valid ? 'Periksa' : r.diff > 0 ? `−${r.diff}` : r.over ? `+${r.got - r.l.qty}` : 'Sesuai');
const rowTone = (r: RecvRow) => (!r.valid || r.diff > 0 ? 'bad' : r.over ? 'warn' : 'ok');
const rowBorder = (r: RecvRow) => (r.diff > 0 ? C.bad[1] : r.over ? C.gold : C.line);

/** State, turunan, dan penerimaan kiriman. */
function useReceive(id: string) {
  const dialog = useDialog();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useData<Ship[]>('/central/shipments?status=in_transit');
  const ship = (q.data ?? []).find((x) => x.id === id);
  const [chk, setChk] = useState<Record<string, Entry>>({});
  const [sure, setSure] = useState(false);
  const rows = buildRows(ship?.lines ?? [], chk);
  const problem = rows.some((r) => !r.valid || r.needIssue || r.needNote);
  const totalDiff = rows.reduce((n, r) => n + (r.valid && r.diff > 0 ? r.diff : 0), 0);
  const totalOver = rows.reduce((n, r) => n + (r.over ? r.got - r.l.qty : 0), 0);
  const patch = (l: ShipLine, p: Patch) => setChk((m) => ({ ...m, [l.productId]: { ...(m[l.productId] ?? blank(l)), ...p } }));
  const send = useMutation({
    mutationFn: () => api('POST', `/central/shipments/${ship!.id}/receive`, { items: rows.map((r) => ({ productId: r.l.productId, qty: r.got, issue: r.diff > 0 ? r.c.issue : undefined, note: r.diff !== 0 ? r.c.note.trim() || undefined : undefined })) }),
    onSuccess: () => { void dialog.alert({ title: 'Kiriman diterima', message: totalDiff || totalOver ? 'Kiriman dicatat dengan selisih. Pengurus akan melihat dan menindaklanjutinya.' : 'Semua barang sesuai kiriman dan sudah masuk ke stok toko.', kind: 'success' }); void qc.invalidateQueries(); router.back(); },
    onError: (e) => void dialog.fail(e, 'Kiriman belum bisa dicatat'),
  });
  return { q, ship, rows, problem, totalDiff, totalOver, patch, sure, toggleSure: () => setSure((v) => !v), sending: send.isPending, send: () => send.mutate() };
}

const requestedQty = (ship: Ship, productId: string) => ship.request?.lines.find((x) => x.productId === productId)?.qty ?? '—';
const shortOfRequest = (ship: Ship) => !!ship.request?.lines.some((x) => x.qtySent < x.qty);

function ShipmentHeader({ ship }: { ship: Ship }) {
  const short = shortOfRequest(ship);
  return (
    <Card>
      <Row title={`Dikirim oleh ${ship.createdByName}`} sub={`${new Date(ship.createdAt).toLocaleString('id-ID')} · ke ${ship.depotName} · total ${ship.totalQty} (${ship.lines.length} produk)${ship.note ? ` · catatan: ${ship.note}` : ''}`} />
      {ship.request && <Row title={`Menjawab permintaan ${ship.request.no}`} sub={short ? 'Dikirim kurang dari yang diminta (lihat Diminta di tiap produk).' : 'Sesuai yang diminta.'} tone={short ? 'warn' : 'ok'} />}
    </Card>
  );
}

function ShortageFields({ row, onPatch }: { row: RecvRow; onPatch: (p: Patch) => void }) {
  const { c, needIssue, needNote } = row;
  return (
    <>
      <Text style={{ color: needIssue ? C.bad[1] : C.muted, fontSize: 12, fontWeight: '600' }}>Alasan selisih {needIssue ? '(wajib dipilih)' : ''}</Text>
      <Chips value={c.issue || '_'} onChange={(v) => onPatch({ issue: v === '_' ? '' : v })} options={ISSUE_OPTIONS} />
      <TextInput value={c.note} onChangeText={(v) => onPatch({ note: v })} placeholder={c.issue === 'lainnya' ? 'Jelaskan (wajib)' : 'Catatan (opsional)'} placeholderTextColor="#93aaa3" style={[input, noteInput, needNote && redBorder]} />
    </>
  );
}

function OverField({ row, onPatch }: { row: RecvRow; onPatch: (p: Patch) => void }) {
  return <TextInput value={row.c.note} onChangeText={(v) => onPatch({ note: v })} placeholder="Jelaskan kelebihannya (wajib)" placeholderTextColor="#93aaa3" style={[input, noteInput, row.needNote && redBorder]} />;
}

function LineCard({ ship, row, onPatch }: { ship: Ship; row: RecvRow; onPatch: (p: Patch) => void }) {
  const { l, c, valid, diff, over } = row;
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: rowBorder(row), padding: 12, gap: 8 }}>
      <Row title={l.name} sub={`Dikirim pusat ${l.qty}${ship.request ? ` · diminta ${requestedQty(ship, l.productId)}` : ''}`} right={rowStatus(row)} tone={rowTone(row)} />
      <TextInput value={c.qty} onChangeText={(v) => onPatch({ qty: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="Diterima berapa?" placeholderTextColor="#93aaa3" selectionColor={C.green} accessibilityLabel={`Diterima ${l.name}`} style={[input, !valid && redBorder]} />
      {!valid && <Text style={{ color: C.bad[1], fontSize: 12 }}>Isi angka 0 atau lebih.</Text>}
      {over && <OverField row={row} onPatch={onPatch} />}
      {diff > 0 && <ShortageFields row={row} onPatch={onPatch} />}
    </View>
  );
}

function totalsTitle(totalDiff: number, totalOver: number) {
  if (!totalDiff && !totalOver) return 'Semua sesuai kiriman';
  return [totalDiff ? `Kurang ${totalDiff}` : '', totalOver ? `Lebih ${totalOver}` : ''].filter(Boolean).join(' · ');
}

function Totals({ totalDiff, totalOver }: { totalDiff: number; totalOver: number }) {
  const off = !!(totalDiff || totalOver);
  return <Card><Row title={totalsTitle(totalDiff, totalOver)} sub={off ? 'Stok toko bertambah sebesar yang diterima; pengurus melihat selisihnya.' : 'Stok toko bertambah sesuai kiriman.'} tone={totalDiff ? 'bad' : totalOver ? 'warn' : 'ok'} /></Card>;
}

function submitLabel(sending: boolean, off: boolean) {
  if (sending) return 'Menyimpan…';
  return off ? 'Terima dengan selisih' : 'Terima kiriman';
}

/** Periksa kiriman dari pusat: cocokkan jumlah yang benar-benar diterima dengan yang dikirim, beri alasan bila beda. */
export default function ReceiveShipment() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const k = useReceive(id);
  const { ship } = k;
  const off = !!(k.totalDiff || k.totalOver);
  return (
    <Screen queries={[k.q]}>
      {ship ? (<>
        <Note>Buka kiriman <Text style={{ fontWeight: '700' }}>{ship.no}</Text> dan hitung barang yang benar-benar ada. Kolom sudah terisi sama dengan yang dikirim; ubah bila ada yang kurang, rusak, atau lebih. Kurang: pilih alasan. Lebih: jelaskan di catatan.</Note>
        <ShipmentHeader ship={ship} />
        {k.rows.map((r) => <LineCard key={r.l.productId} ship={ship} row={r} onPatch={(p) => k.patch(r.l, p)} />)}
        <Totals totalDiff={k.totalDiff} totalOver={k.totalOver} />
        <Button label={k.sure ? '✓ Saya sudah memeriksa barang fisik' : 'Saya sudah memeriksa barang fisik'} kind={k.sure ? 'gold' : 'ghost'} onPress={k.toggleSure} />
        <Button label={submitLabel(k.sending, off)} disabled={k.sending || !k.sure || k.problem} onPress={k.send} />
        {k.problem && <Note>Lengkapi dulu jumlah diterima, alasan untuk setiap kekurangan, dan catatan untuk setiap kelebihan.</Note>}
      </>) : <Note>Kiriman tidak ditemukan atau sudah diterima.</Note>}
      <Button label="Kembali" kind="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
