import { useState } from 'react';
import { Image, Text, TextInput, View } from 'react-native';
import { useDialog } from './dialog';
import { rupiah, useAct, useData } from './hooks';
import { useSession } from './session';
import { C } from './theme';
import { Button } from './ui';

const field = { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 8, padding: 10, fontSize: 15 } as const;
const note = { color: C.muted, fontSize: 12 } as const;

/** Foto penerimaan dari anggota: petugas toko memeriksa, lalu menyatakan valid (pesanan selesai) atau tidak valid (anggota kirim ulang). */
function VerifyBlock({ o }: { o: any }) {
  const act = useAct();
  const dialog = useDialog();
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const photo = useData<{ photo: string | null }>(`/orders/${o.id}/receipt-photo`, open);
  if (o.report?.verifyStatus === 'invalid') return <Text style={note}>Foto ditolak{o.report.verifyNote ? `: ${o.report.verifyNote}` : ''}. Menunggu anggota mengirim ulang.</Text>;
  if (o.report?.verifyStatus !== 'pending') return null;
  if (me?.role !== 'staff') return <Text style={note}>Foto penerimaan dari anggota menunggu verifikasi petugas toko.</Text>;
  return (
    <View style={{ padding: 10, backgroundColor: C.warn[0], borderRadius: 8, gap: 8 }}>
      <Text style={{ color: C.warn[1], fontWeight: '700' }}>Foto penerimaan menunggu verifikasi</Text>
      {open ? (<>
        {photo.data?.photo ? <Image source={{ uri: photo.data.photo }} resizeMode="contain" accessibilityLabel="Foto barang yang diterima anggota" style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 8, backgroundColor: '#fff' }} /> : <Text style={note}>{photo.isLoading ? 'Memuat foto…' : 'Foto tidak ditemukan.'}</Text>}
        <Text style={{ color: C.ink, fontSize: 12 }}>Cocokkan foto dengan isi pesanan. Valid → pesanan selesai dan imbalan anggota cair.</Text>
        <Button label="Valid — selesaikan pesanan" disabled={act.busy} onPress={() => void dialog.confirm({ title: 'Foto valid?', message: `Pesanan ${o.no} akan diselesaikan dan imbalan anggota cair. Tindakan ini tidak bisa dibatalkan.`, confirmLabel: 'Ya, valid', cancelLabel: 'Periksa lagi' }).then((ok) => { if (ok) { act.post(`/orders/${o.id}/verify-receipt`, `${o.no} valid dan diselesaikan`, { valid: true }); setOpen(false); } })} />
        <TextInput value={reason} onChangeText={setReason} placeholder="Alasan bila foto tidak valid (mis. foto buram)" placeholderTextColor="#93aaa3" style={field} />
        <Button label="Foto tidak valid" kind="ghost" disabled={act.busy || reason.trim().length < 3} onPress={() => { act.post(`/orders/${o.id}/verify-receipt`, 'Foto ditolak; anggota diminta mengirim ulang', { valid: false, note: reason.trim() }); setOpen(false); setReason(''); }} />
        <Button label="Tutup" kind="ghost" onPress={() => setOpen(false)} />
      </>) : <Button label="Periksa foto & verifikasi" kind="gold" onPress={() => setOpen(true)} />}
    </View>
  );
}

/** Laporan anggota "barang tidak sesuai": lihat rincian lalu tanggapi dan selesaikan. */
function ReportBlock({ o }: { o: any }) {
  const act = useAct();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const rep = useData<any>(`/orders/${o.id}/report`, open);
  if (o.report?.status === 'resolved') return <Text style={note}>Laporan anggota sudah ditanggapi.</Text>;
  if (o.report?.status === 'ok') return <Text style={note}>Anggota: barang sesuai.</Text>;
  if (o.report?.status !== 'open') return null;
  return (
    <View style={{ padding: 10, backgroundColor: C.bad[0], borderRadius: 8, gap: 6 }}>
      <Text style={{ color: C.bad[1], fontWeight: '700' }}>Laporan anggota: barang tidak sesuai</Text>
      {open && rep.data ? (<>
        <Text style={{ color: C.bad[1], fontSize: 12 }}>Dari {rep.data.memberName}{rep.data.note ? ` · “${rep.data.note}”` : ''}</Text>
        {rep.data.lines.filter((l: any) => l.qtyReceived !== l.qtyOrdered).map((l: any) => (
          <Text key={l.productId} style={{ color: C.ink, fontSize: 13 }}>• {l.name}: dipesan {l.qtyOrdered}, diterima baik {l.qtyReceived}{l.issue ? ` (${l.issue === 'salah_kirim' ? 'salah produk' : l.issue})` : ''}{l.note ? ` — ${l.note}` : ''}</Text>
        ))}
        <TextInput value={text} onChangeText={setText} placeholder="Tanggapan untuk anggota (mis. pengganti dikirim besok)" placeholderTextColor="#93aaa3" style={field} />
        <Button label="Tanggapi & selesaikan" disabled={act.busy || text.trim().length < 3} onPress={() => { act.post(`/orders/${o.id}/report/resolve`, 'Laporan ditanggapi dan ditandai selesai', { note: text.trim() }); setOpen(false); setText(''); }} />
        <Button label="Tutup" kind="ghost" onPress={() => { setOpen(false); setText(''); }} />
      </>) : <Button label="Lihat & tanggapi laporan" kind="gold" onPress={() => setOpen(true)} />}
    </View>
  );
}

function ApproveBlock({ o, total }: { o: any; total: number }) {
  const act = useAct();
  const dialog = useDialog();
  const who = o.buyerId ? `anggota ${o.buyerName ?? ''}`.trim() : `${o.customerName ?? 'pelanggan umum'} (pelanggan umum)`;
  const approve = () => void dialog.confirm({
    title: 'Setujui pesanan?',
    message: `Pesanan ${o.no} dari ${who} senilai ${rupiah(total)} akan disetujui${o.buyerId ? ` dan saldo belanja anggota langsung terpotong ${rupiah(total)}` : ''}. Setelah itu toko menyiapkan barangnya.`,
    confirmLabel: 'Ya, setujui', cancelLabel: 'Periksa lagi',
  }).then((ok) => { if (ok) act.post(`/orders/${o.id}/approve`, `Pesanan ${o.no} disetujui.${o.buyerId ? ' Saldo belanja anggota sudah terpotong.' : ''}`); });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  if (rejecting) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={note}>Alasan penolakan (dilihat anggota)</Text>
        <TextInput value={reason} onChangeText={setReason} placeholder="mis. stok rusak / toko tutup" style={field} />
        <Button label="Kirim penolakan" disabled={act.busy || !reason.trim()} onPress={() => { act.post(`/orders/${o.id}/reject`, `${o.no} ditolak`, { reason: reason.trim() }); setRejecting(false); setReason(''); }} />
        <Button label="Batal" kind="ghost" onPress={() => { setRejecting(false); setReason(''); }} />
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Button label="Setujui" disabled={act.busy} onPress={approve} />
      <Button label="Tolak…" kind="ghost" onPress={() => setRejecting(true)} />
    </View>
  );
}

/** Tindakan petugas untuk satu pesanan sesuai statusnya: setujui/tolak, bayar, kirim, konfirmasi terima, dan laporan anggota. */
export function StaffOrderActions({ o, total }: { o: any; total: number }) {
  const act = useAct();
  const dialog = useDialog();
  const confirm = (title: string, message: string, label: string, run: () => void) => void dialog.confirm({ title, message, confirmLabel: label, cancelLabel: 'Batal' }).then((ok) => { if (ok) run(); });
  return (
    <View style={{ gap: 10 }}>
      <VerifyBlock o={o} />
      <ReportBlock o={o} />
      {o.status === 'awaiting_approval' && <ApproveBlock o={o} total={total} />}
      {o.status === 'awaiting_payment' && <Button label="Bayar dengan saldo" kind="gold" disabled={act.busy} onPress={() => act.post(`/orders/${o.id}/pay-balance`, `${o.no} dibayar dari saldo belanja`)} />}
      {o.status === 'paid' && <Button label="Kirim (SJ otomatis)" disabled={act.busy} onPress={() => confirm('Kirim pesanan?', `Pesanan ${o.no} ditandai sudah dikirim dan surat jalan SJ-${o.no} dibuat.`, 'Ya, kirim', () => act.post(`/orders/${o.id}/ship`, `${o.no} dikirim`, { deliveryRef: `SJ-${o.no}` }))} />}
      {o.status === 'shipped' && o.buyerId && !o.report && <Text style={note}>Menunggu anggota mengirim foto barang yang diterima. Setelah itu petugas memverifikasi fotonya dan menyelesaikan pesanan. Bila anggota tak kunjung memeriksa, pengurus dapat menyelesaikannya dari web setelah 3 hari.</Text>}
      {o.status === 'shipped' && !o.buyerId && (<>
        <Text style={note}>Menunggu konfirmasi penerimaan dari pelanggan.</Text>
        <Button label="Konfirmasi penerimaan" disabled={act.busy} onPress={() => confirm('Konfirmasi penerimaan?', `Pastikan pesanan ${o.no} benar-benar sudah diterima pelanggan. Tindakan ini tidak bisa dibatalkan.`, 'Ya, sudah diterima', () => act.post(`/orders/${o.id}/receive`, 'Penerimaan dikonfirmasi', { proofRef: `BKT-${o.no}`, receiverName: 'Penerima (mobile)' }))} />
      </>)}
    </View>
  );
}
