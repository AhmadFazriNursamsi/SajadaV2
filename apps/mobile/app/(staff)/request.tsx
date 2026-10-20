import { useMemo, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiBase } from '../../src/api';
import { useDialog } from '../../src/dialog';
import { C } from '../../src/theme';
import { Button, Card, Chips, Note, Row, Screen } from '../../src/ui';
import { useData } from '../../src/hooks';

interface Prod { id: string; name: string; sku: string; physical: number; reserved: number; available: number; safety: number; target: number; inTransit: number; active: boolean }
interface Req { id: string; no: string; status: 'pending' | 'sent' | 'rejected' | 'cancelled'; createdAt: string; note: string | null; decisionNote: string | null; shipmentNo: string | null; totalQty: number; totalSent: number; lines: { productId: string; name: string; qty: number; qtySent: number }[] }
const input = { height: 50, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 0, fontSize: 18, color: C.ink, textAlignVertical: 'center' } as const;
const LABEL: Record<Req['status'], [string, 'ok' | 'warn' | 'bad']> = { pending: ['Menunggu pusat', 'warn'], sent: ['Dikirim', 'ok'], rejected: ['Ditolak', 'bad'], cancelled: ['Dibatalkan', 'bad'] };

/** Minta stok ke pusat (petugas): produk habis/menipis sudah disarankan; pengurus memproses (penuh/sebagian/tolak). */
export default function RequestStock() {
  const router = useRouter();
  const qc = useQueryClient();
  const dialog = useDialog();
  const depots = useData<{ id: string; name: string; active: boolean }[]>('/depots');
  const [sel, setSel] = useState('');
  const ds = (depots.data ?? []).filter((d) => d.active);
  const depotId = ds.find((d) => d.id === sel)?.id ?? ds[0]?.id ?? '';
  const prods = useData<Prod[]>(`/products?depotId=${depotId}`, !!depotId);
  const reqs = useData<Req[]>(`/central/requests?depotId=${depotId}`, !!depotId);
  const [qty, setQty] = useState<Record<string, string> | null>(null);
  const ps = (prods.data ?? []).filter((p) => p.active);
  const q = useMemo(() => {
    if (qty) return qty;
    const s: Record<string, string> = {};
    for (const p of ps) if (p.available <= p.safety) s[p.id] = String(Math.max(1, p.target - p.physical - p.inTransit));
    return s;
  }, [qty, ps]);
  const items = ps.map((p) => ({ p, n: Math.floor(Number(q[p.id] ?? '')) || 0 })).filter((x) => x.n > 0);
  const send = useMutation({
    mutationFn: () => api('POST', '/central/requests', { depotId, items: items.map((x) => ({ productId: x.p.id, qty: x.n })) }),
    onSuccess: () => { void dialog.alert({ title: 'Permintaan terkirim', message: 'Permintaan stok sudah dikirim ke pusat. Pantau statusnya di daftar Permintaan saya.', kind: 'success' }); setQty({}); void qc.invalidateQueries(); },
    onError: (e) => void dialog.fail(e, 'Permintaan belum terkirim'),
  });
  // Invoice PDF dibuka di peramban lewat tautan sementara (aplikasi tidak bisa menaruh header login pada tautan).
  const invoice = useMutation({
    mutationFn: async (id: string) => { const r = await api<{ url: string }>('POST', `/central/requests/${id}/invoice-link`); await Linking.openURL(apiBase() + r.url); },
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => void dialog.fail(e, 'Invoice belum bisa dibuka'),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api('POST', `/central/requests/${id}/cancel`),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => void dialog.fail(e, 'Permintaan belum bisa dibatalkan'),
  });
  return (
    <Screen queries={[depots, prods, reqs]}>
      {ds.length > 1 && <Chips value={depotId} onChange={(v) => { setSel(v); setQty(null); }} options={ds.map((d) => ({ v: d.id, l: d.name }))} />}
      <Note>Isi jumlah yang dibutuhkan. Produk yang habis atau menipis sudah diisi saran sampai target stok; ubah bila perlu.</Note>
      {ps.map((p) => (
        <View key={p.id} style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, gap: 8 }}>
          <Row title={p.name} sub={`Ada ${p.physical} · aman ≥ ${p.safety} · target ${p.target}`} right={p.available <= 0 ? 'Habis' : p.available <= p.safety ? 'Menipis' : 'Aman'} tone={p.available <= 0 ? 'bad' : p.available <= p.safety ? 'warn' : 'ok'} />
          <TextInput
            value={q[p.id] ?? ''} onChangeText={(v) => setQty({ ...q, [p.id]: v.replace(/[^0-9]/g, '') })}
            keyboardType="number-pad" placeholder="Minta berapa?" placeholderTextColor="#93aaa3" selectionColor={C.green}
            accessibilityLabel={`Jumlah minta ${p.name}`} style={input}
          />
        </View>
      ))}
      <Button label={send.isPending ? 'Mengirim…' : `Kirim permintaan${items.length ? ` (${items.reduce((s, x) => s + x.n, 0)})` : ''}`} disabled={send.isPending || items.length === 0} onPress={() => send.mutate()} />

      <Text style={{ fontWeight: '700', fontSize: 16, color: C.ink, marginTop: 8 }}>Permintaan saya</Text>
      <Card>
        {(reqs.data ?? []).length === 0 ? <Row title="Belum ada permintaan" /> : (reqs.data ?? []).map((r) => (
          <View key={r.id} style={{ paddingBottom: 6 }}>
            <Row title={`${r.no} · ${LABEL[r.status][0]}`} sub={`${r.lines.map((l) => `${l.qty} ${l.name}${r.status === 'sent' ? ` (dikirim ${l.qtySent})` : ''}`).join(', ')}${r.status === 'sent' ? ` · ${r.shipmentNo}${r.totalSent < r.totalQty ? ' · sebagian' : ''}` : ''}${r.decisionNote ? ` · ${r.decisionNote}` : ''}`} right={`${r.totalQty}`} tone={LABEL[r.status][1]} />
            <View style={{ paddingHorizontal: 10 }}><Button label={invoice.isPending && invoice.variables === r.id ? 'Membuka…' : 'Invoice PDF'} kind="ghost" disabled={invoice.isPending} onPress={() => invoice.mutate(r.id)} /></View>
            {r.status === 'pending' && <View style={{ paddingHorizontal: 10, paddingTop: 6 }}><Button label="Batalkan permintaan" kind="ghost" disabled={cancel.isPending} onPress={() => void dialog.confirm({ title: 'Batalkan permintaan?', message: `Permintaan ${r.no} tidak akan diproses pusat.`, confirmLabel: 'Ya, batalkan', cancelLabel: 'Tidak', danger: true }).then((ok) => ok && cancel.mutate(r.id))} /></View>}
          </View>
        ))}
      </Card>
      <Button label="Kembali ke Stok" kind="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
