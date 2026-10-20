import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { OPNAME_REASONS, OPNAME_REASON_LIST } from '@sajadah/shared';
import { api, ApiError } from '../../src/api';
import { useSession } from '../../src/session';
import { C } from '../../src/theme';
import { Button, Card, Chips, Hero, Note, Row, Screen } from '../../src/ui';
import { rupiah, useData } from '../../src/hooks';

interface CountRow { id: string; no: string; depotId: string; depotName: string; status: 'draft' | 'submitted' | 'approved' | 'cancelled'; needsAdmin: boolean; createdByName: string; countedCount: number; lineCount: number; varianceQty: number; varianceValue: number }
interface Line { id: string; sku: string; name: string; systemQty: number; countedQty: number | null; reason: string | null; note: string | null; unitCost: number; reserved: number; moved: number }
interface Detail extends CountRow { lines: Line[]; returnNote: string | null; cancelReason: string | null; exceedReason: string | null; canApprove: boolean; submittedByName: string | null; approvedByName: string | null; policy: { tolerancePct: number; toleranceValue: number } }
interface Edit { counted: string; reason: string; note: string }

const STATUS: Record<string, string> = { draft: 'Sedang dihitung', submitted: 'Menunggu pengurus', approved: 'Selesai · stok disesuaikan', cancelled: 'Dibatalkan' };
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const money = (n: number) => (n < 0 ? `−${rupiah(-n)}` : n > 0 ? `+${rupiah(n)}` : rupiah(0));
const input = { height: 50, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 0, fontSize: 18, color: C.ink, textAlignVertical: 'center' } as const;

type Msg = { ok: boolean; text: string } | null;
const noteInput = { fontSize: 15, height: 44 } as const;
const redBorder = { borderColor: C.bad[1] } as const;
const statusOf = (s: CountRow['status']) => STATUS[s] ?? s;
const isOpen = (s: CountRow['status']) => s === 'draft' || s === 'submitted';
const rowRight = (s: CountRow['status']) => (s === 'approved' ? 'selesai' : s === 'cancelled' ? 'batal' : 'buka');
const rowTone = (s: CountRow['status']) => (s === 'approved' ? 'ok' : s === 'cancelled' ? 'bad' : 'warn');

function MsgBox({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <View style={{ backgroundColor: msg.ok ? C.ok[0] : C.bad[0], borderRadius: 8, padding: 12 }}><Text style={{ color: msg.ok ? C.green : C.bad[1] }}>{msg.text}</Text></View>;
}

function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}><Text style={{ color: C.green, fontWeight: '600' }}>{label}</Text></Pressable>;
}

/** Daftar dokumen, toko terpilih, dan memulai opname baru. */
function useOpnameList(ops: boolean, setOpenId: (id: string) => void) {
  const qc = useQueryClient();
  const depots = useData<{ id: string; name: string; active: boolean }[]>('/depots');
  const [sel, setSel] = useState('');
  const ds = (depots.data ?? []).filter((d) => d.active);
  const depotId = ds.find((d) => d.id === sel)?.id ?? ds[0]?.id ?? '';
  const list = useData<CountRow[]>(`/stock-counts?depotId=${depotId}`, !!depotId);
  const [msg, setMsg] = useState<Msg>(null);
  useFocusEffect(useCallback(() => { void list.refetch(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]));
  const rows = list.data ?? [];
  const running = rows.find((r) => isOpen(r.status));
  const start = useMutation({
    mutationFn: () => api<{ id: string; no: string }>('POST', '/stock-counts', { depotId }),
    onSuccess: (r) => { setMsg(null); void qc.invalidateQueries(); setOpenId(r.id); },
    onError: (e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Gagal memulai opname.' }),
  });
  return { depots, list, ds, depotId, setSel, rows, running, msg, ops, starting: start.isPending, start: () => start.mutate() };
}
type ListState = ReturnType<typeof useOpnameList>;

function HowTo({ running }: { running?: CountRow }) {
  const st = running?.status;
  return (
    <Card>
      <Row title="Cara kerja opname" sub="Opname = mencocokkan barang yang benar-benar ada di rak dengan catatan sistem." />
      <Row title={`${running ? '✓' : '1'}  Mulai opname`} sub="Tekan tombol di atas." tone={running ? 'ok' : 'warn'} />
      <Row title={`${st === 'submitted' ? '✓' : '2'}  Hitung barang di rak`} sub="Isi jumlah yang ada di setiap produk." tone={st === 'draft' ? 'warn' : running ? 'ok' : 'neutral'} />
      <Row title={`${st === 'submitted' ? '✓' : '3'}  Kirim ke pengurus`} sub="Kalau ada yang beda, pilih alasannya dulu." tone={st === 'submitted' ? 'ok' : 'neutral'} />
      <Row title="4  Pengurus menyetujui" sub="Setelah disetujui, stok di sistem dikoreksi." tone="neutral" />
    </Card>
  );
}

function countSub(r: CountRow) {
  const diff = r.countedCount ? ` · beda ${signed(r.varianceQty)} (${money(r.varianceValue)})` : '';
  const over = r.needsAdmin && isOpen(r.status) ? ' · di atas toleransi' : '';
  return `${r.createdByName} · dihitung ${r.countedCount}/${r.lineCount}${diff}${over}`;
}

function CountList({ rows, onOpen }: { rows: CountRow[]; onOpen: (id: string) => void }) {
  return (
    <Card>
      {rows.length === 0 ? <Row title="Belum ada opname di toko ini" /> : rows.map((r) => (
        <Pressable key={r.id} accessibilityRole="button" onPress={() => onOpen(r.id)}>
          <Row title={`${r.no} · ${statusOf(r.status)}`} sub={countSub(r)} right={rowRight(r.status)} tone={rowTone(r.status)} />
        </Pressable>
      ))}
    </Card>
  );
}

function StartAction({ k, onOpen }: { k: ListState; onOpen: (id: string) => void }) {
  if (k.running) return <Button label={k.running.status === 'draft' && k.ops ? 'Lanjutkan menghitung' : 'Lihat opname'} kind="gold" onPress={() => onOpen(k.running!.id)} />;
  if (!k.ops) return null;
  return <Button label={k.starting ? 'Memulai…' : '+ Mulai opname baru'} disabled={k.starting || !k.depotId} onPress={k.start} />;
}

/** Stok opname di mobile: daftar dokumen → layar hitung (petugas) → persetujuan (pengurus). Aturan sama dengan web; server yang menegakkan. */
export default function Opname() {
  const { me } = useSession();
  const router = useRouter();
  const ops = me?.role === 'staff'; // hanya petugas menghitung; pengurus menyetujui
  const [openId, setOpenId] = useState<string | null>(null);
  const k = useOpnameList(ops, setOpenId);
  const qc = useQueryClient();
  if (openId) return <CountScreen id={openId} ops={ops} onBack={() => { setOpenId(null); void qc.invalidateQueries(); }} />;
  const { running } = k;
  return (
    <Screen queries={[k.depots, k.list]}>
      <BackLink label="← Kembali ke Stok" onPress={() => router.push('/(staff)/stock')} />
      {k.ds.length > 1 && <Chips value={k.depotId} onChange={k.setSel} options={k.ds.map((d) => ({ v: d.id, l: d.name }))} />}
      <Hero label="Stok opname" value={running ? running.no : 'Tidak ada yang berjalan'} note={running ? `${statusOf(running.status)} · ${running.depotName}` : 'Mulai opname untuk mencocokkan barang di rak dengan catatan sistem'} />
      <MsgBox msg={k.msg} />
      <StartAction k={k} onOpen={setOpenId} />
      <HowTo running={running} />
      <CountList rows={k.rows} onOpen={setOpenId} />
    </Screen>
  );
}

interface ViewLine { l: Line; e: Edit; valid: boolean; variance: number | null; needReason: boolean; needNote: boolean; below: boolean }
type Kind = 'save' | 'submit' | 'approve' | 'reject' | 'cancel';
const DONE_TEXT: Record<Kind, string> = { save: 'Hitungan disimpan sementara.', submit: 'Terkirim ke pengurus untuk disetujui.', approve: 'Disetujui; stok sudah disesuaikan.', reject: 'Dikembalikan untuk dihitung ulang.', cancel: 'Opname dibatalkan.' };
const toEdits = (d: Detail) => Object.fromEntries(d.lines.map((l) => [l.id, { counted: l.countedQty == null ? '' : String(l.countedQty), reason: l.reason ?? '', note: l.note ?? '' }]));
const varianceTone = (v: number | null) => (v == null ? 'neutral' : v === 0 ? 'ok' : v < 0 ? 'bad' : 'warn');
const toneBg = (t: string) => ({ neutral: C.neutral[0], ok: C.ok[0], bad: C.bad[0], warn: C.warn[0] })[t];
const toneFg = (t: string) => ({ neutral: C.muted, ok: C.green, bad: C.bad[1], warn: C.warn[1] })[t];

function buildView(d: Detail | undefined, edits: Record<string, Edit>, editable: boolean): ViewLine[] {
  return (d?.lines ?? []).map((l) => {
    const e = edits[l.id] ?? { counted: '', reason: '', note: '' };
    const empty = e.counted.trim() === '';
    const n = empty ? null : Number(e.counted);
    const valid = empty || (n != null && Number.isInteger(n) && n >= 0);
    const variance = n != null && valid ? n - l.systemQty : null;
    return { l, e, valid, variance, needReason: editable && variance != null && variance !== 0 && !e.reason, needNote: editable && e.reason === 'lainnya' && !e.note.trim(), below: editable && n != null && valid && n < l.reserved };
  });
}

/** Hitungan, validasi, dan aksi (simpan, kirim, setujui, kembalikan, batalkan) untuk satu dokumen opname. */
function useCount(id: string, ops: boolean, onBack: () => void) {
  const q = useData<Detail>(`/stock-counts/${id}`);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [dirty, setDirty] = useState(false);
  const [ask, setAsk] = useState<null | 'approve' | 'reject' | 'cancel'>(null);
  const [askText, setAskText] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const d = q.data;
  useEffect(() => { if (d && !dirty) setEdits(toEdits(d)); }, [d, dirty]);
  const editable = !!d && d.status === 'draft' && ops;
  const set = (lineId: string, patch: Partial<Edit>) => { setDirty(true); setMsg(null); setEdits((e) => ({ ...e, [lineId]: { ...e[lineId]!, ...patch } })); };
  const view = useMemo(() => buildView(d, edits, editable), [d, edits, editable]);
  const counted = view.filter((v) => v.variance != null);
  const totQty = counted.reduce((s, v) => s + v.variance!, 0);
  const totVal = counted.reduce((s, v) => s + v.variance! * v.l.unitCost, 0);
  const problems = view.filter((v) => !v.valid || v.needReason || v.needNote || v.below);
  const body = () => ({ lines: view.map(({ l, e }) => ({ lineId: l.id, countedQty: e.counted.trim() === '' ? null : Number(e.counted), reason: e.reason || null, note: e.note.trim() || null })) });
  const run = useMutation({
    mutationFn: async (kind: Kind) => {
      if (kind === 'save' || kind === 'submit') await api('PUT', `/stock-counts/${id}/lines`, body());
      if (kind === 'submit') await api('POST', `/stock-counts/${id}/submit`);
      if (kind === 'approve') await api('POST', `/stock-counts/${id}/approve`);
      if (kind === 'reject') await api('POST', `/stock-counts/${id}/reject`, { reason: askText.trim() });
      if (kind === 'cancel') await api('POST', `/stock-counts/${id}/cancel`, { reason: askText.trim() });
      return kind;
    },
    onSuccess: async (kind) => {
      setDirty(false); setAsk(null); setAskText('');
      setMsg({ ok: true, text: DONE_TEXT[kind] });
      await q.refetch();
      if (kind === 'approve' || kind === 'cancel') setTimeout(onBack, 900);
    },
    onError: (e) => { setAsk(null); setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Terjadi kesalahan. Coba lagi.' }); },
  });
  return { q, d, editable, view, counted, totQty, totVal, problems, dirty, set, msg, ask, setAsk, askText, setAskText, busy: run.isPending, run: (k: Kind) => run.mutate(k) };
}
type CountState = ReturnType<typeof useCount>;

function Banner({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return <View style={{ backgroundColor: bg, borderRadius: 8, padding: 12 }}><Text style={{ color: fg }}>{children}</Text></View>;
}

function Notices({ d }: { d: Detail }) {
  return (
    <>
      {d.returnNote && d.status === 'draft' && <Banner bg={C.bad[0]} fg={C.bad[1]}>Dikembalikan untuk hitung ulang: {d.returnNote}</Banner>}
      {d.needsAdmin && d.status !== 'cancelled' && <Banner bg={C.warn[0]} fg={C.warn[1]}>Di atas toleransi ({d.policy.tolerancePct}% per produk / {rupiah(d.policy.toleranceValue)} per dokumen): {d.exceedReason}. Persetujuan harus oleh pengurus.</Banner>}
    </>
  );
}

function LineHead({ l, d }: { l: Line; d: Detail }) {
  const moved = l.moved !== 0 && d.status !== 'approved' ? ` · stok berubah ${signed(l.moved)} sejak mulai` : '';
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>{l.name}</Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>{l.sku} · harga beli {rupiah(l.unitCost)}{l.reserved ? ` · dipesan ${l.reserved}` : ''}{moved}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: C.muted, fontSize: 11 }}>CATATAN SISTEM</Text>
        <Text style={{ color: C.ink, fontWeight: '700', fontSize: 20 }}>{l.systemQty}</Text>
      </View>
    </View>
  );
}

function CountInput({ v, onChange }: { v: ViewLine; onChange: (p: Partial<Edit>) => void }) {
  const { l, e, valid, variance, below } = v;
  const t = varianceTone(variance);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <TextInput value={e.counted} onChangeText={(x) => onChange({ counted: x.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="Hasil hitung di rak" placeholderTextColor="#93aaa3" selectionColor={C.green}
        accessibilityLabel={`Hasil hitung di rak ${l.name}`} style={[input, { flex: 1 }, (!valid || below) && redBorder]} />
      <View style={{ minWidth: 86, alignItems: 'center', backgroundColor: toneBg(t), borderRadius: 10, paddingVertical: 10, paddingHorizontal: 10 }}>
        <Text style={{ fontWeight: '700', fontSize: 16, color: toneFg(t) }}>{variance == null ? '—' : signed(variance)}</Text>
      </View>
    </View>
  );
}

function CountedText({ l }: { l: Line }) {
  const reason = l.reason ? ` · ${OPNAME_REASONS[l.reason as keyof typeof OPNAME_REASONS] ?? l.reason}` : '';
  return (
    <Text style={{ color: C.ink }}>Hasil hitung: <Text style={{ fontWeight: '700' }}>{l.countedQty ?? '—'}</Text>{l.countedQty != null ? ` · selisih ${signed(l.countedQty - l.systemQty)}` : ''}{reason}{l.note ? ` — ${l.note}` : ''}</Text>
  );
}

function ReasonFields({ v, onChange }: { v: ViewLine; onChange: (p: Partial<Edit>) => void }) {
  const { e, needReason, needNote } = v;
  const showNote = e.reason === 'lainnya' || !!e.note;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: needReason ? C.bad[1] : C.muted, fontSize: 12, fontWeight: '600' }}>Alasan selisih {needReason ? '(wajib dipilih)' : ''}</Text>
      <Chips value={e.reason || '_'} onChange={(x) => onChange({ reason: x === '_' ? '' : x })} options={REASON_OPTIONS} />
      {showNote && <TextInput value={e.note} onChangeText={(x) => onChange({ note: x })} placeholder={e.reason === 'lainnya' ? 'Jelaskan alasan (wajib)' : 'Catatan (opsional)'} placeholderTextColor="#93aaa3" style={[input, noteInput, needNote && redBorder]} />}
    </View>
  );
}
const REASON_OPTIONS = OPNAME_REASON_LIST.map((k) => ({ v: k, l: OPNAME_REASONS[k].split(' /')[0]! }));

function LineCard({ v, d, editable, onChange }: { v: ViewLine; d: Detail; editable: boolean; onChange: (p: Partial<Edit>) => void }) {
  const { l, variance, below } = v;
  const border = variance ? (variance < 0 ? C.bad[1] : C.gold) : C.line;
  return (
    <View style={{ backgroundColor: C.panel, borderColor: border, borderWidth: variance ? 1.5 : 1, borderRadius: 12, padding: 12, gap: 8 }}>
      <LineHead l={l} d={d} />
      {editable ? <CountInput v={v} onChange={onChange} /> : <CountedText l={l} />}
      {below && <Text style={{ color: C.bad[1], fontSize: 12 }}>Tidak boleh kurang dari jumlah dipesan ({l.reserved}).</Text>}
      {editable && variance != null && variance !== 0 && <ReasonFields v={v} onChange={onChange} />}
    </View>
  );
}

const problemLabel = (p: ViewLine) => (!p.valid ? 'angka tidak valid' : p.below ? 'kurang dari dipesan' : p.needReason ? 'alasan' : 'catatan');

function AskBox({ placeholder, confirmLabel, disabled, onConfirm, onBack, value, onChange }: { placeholder: string; confirmLabel: string; disabled: boolean; onConfirm: () => void; onBack: () => void; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#93aaa3" style={[input, { fontSize: 15 }]} />
      <Button label={confirmLabel} kind="ghost" disabled={disabled} onPress={onConfirm} />
      <Button label="Kembali" kind="ghost" onPress={onBack} />
    </View>
  );
}

function EditActions({ k }: { k: CountState }) {
  return (
    <View style={{ gap: 8 }}>
      <Button label={k.busy ? 'Menyimpan…' : 'Simpan hitungan'} kind="ghost" disabled={k.busy || !k.dirty || k.problems.some((p) => !p.valid)} onPress={() => k.run('save')} />
      <Button label="Kirim ke pengurus" disabled={k.busy || !k.counted.length || k.problems.length > 0} onPress={() => k.run('submit')} />
      {k.ask === 'cancel'
        ? <AskBox value={k.askText} onChange={k.setAskText} placeholder="Alasan pembatalan" confirmLabel="Ya, batalkan opname" disabled={k.busy || k.askText.trim().length < 3} onConfirm={() => k.run('cancel')} onBack={() => k.setAsk(null)} />
        : <Button label="Batalkan opname…" kind="ghost" onPress={() => { k.setAsk('cancel'); k.setAskText(''); }} />}
    </View>
  );
}

function ApproveActions({ k }: { k: CountState }) {
  if (k.ask === 'approve') {
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: C.ink }}>Stok akan disesuaikan sekarang: {signed(k.totQty)} (nilai {money(k.totVal)}). Tidak dapat dibatalkan; koreksi berikutnya lewat opname baru.</Text>
        <Button label={k.busy ? 'Memposting…' : 'Ya, setujui & posting'} disabled={k.busy} onPress={() => k.run('approve')} />
        <Button label="Kembali" kind="ghost" onPress={() => k.setAsk(null)} />
      </View>
    );
  }
  if (k.ask === 'reject') {
    return <AskBox value={k.askText} onChange={k.setAskText} placeholder="Alasan (dilihat petugas)" confirmLabel="Kembalikan untuk hitung ulang" disabled={k.busy || k.askText.trim().length < 3} onConfirm={() => k.run('reject')} onBack={() => k.setAsk(null)} />;
  }
  return (
    <View style={{ gap: 8 }}>
      <Button label="Setujui & posting…" kind="gold" onPress={() => k.setAsk('approve')} />
      <Button label="Kembalikan untuk hitung ulang…" kind="ghost" onPress={() => { k.setAsk('reject'); k.setAskText(''); }} />
    </View>
  );
}

function CountBody({ k, d }: { k: CountState; d: Detail }) {
  const { editable, problems } = k;
  return (
    <>
      <Hero label={`${d.no} · ${d.depotName}`} value={statusOf(d.status)} note={`Dibuat ${d.createdByName}${d.submittedByName ? ` · diajukan ${d.submittedByName}` : ''}${d.approvedByName ? ` · disetujui ${d.approvedByName}` : ''}`} />
      <MsgBox msg={k.msg} />
      <Notices d={d} />
      <Card><Row title="Beda total" sub={`${k.counted.length} dari ${d.lines.length} produk sudah dihitung`} right={`${signed(k.totQty)} · ${money(k.totVal)}`} tone={k.totQty < 0 ? 'bad' : k.totQty > 0 ? 'warn' : 'ok'} /></Card>
      {k.view.map((v) => <LineCard key={v.l.id} v={v} d={d} editable={editable} onChange={(p) => k.set(v.l.id, p)} />)}
      {editable && problems.length > 0 && <Note>Lengkapi dulu: {problems.map((p) => `${p.l.name} (${problemLabel(p)})`).join(', ')}.</Note>}
      {editable && <Note>Cara mengisi: hitung barang di rak lalu isi jumlahnya. Sama dengan catatan sistem? Tidak perlu alasan. Beda? Pilih alasannya. Produk yang belum dihitung boleh dikosongkan.</Note>}
      {editable && <EditActions k={k} />}
      {d.status === 'submitted' && !d.canApprove && <Note>Menunggu persetujuan pengurus.</Note>}
      {d.canApprove && <ApproveActions k={k} />}
    </>
  );
}

function CountScreen({ id, ops, onBack }: { id: string; ops: boolean; onBack: () => void }) {
  const k = useCount(id, ops, onBack);
  return (
    <Screen queries={[k.q]}>
      <BackLink label="← Daftar opname" onPress={onBack} />
      {k.d && <CountBody k={k} d={k.d} />}
    </Screen>
  );
}
