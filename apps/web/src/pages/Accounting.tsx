import { Badge, Block, Btn, Field, Fields, Gate, Kpi, Kpis, PageHead, Table } from '../ui';
import { R, useAct, useData, useForm } from '../hooks';
import type { PayableRow } from '../types';

interface Summary { cash: number; receivable: number; receivableCount: number; payable: number; payableOverdue: number; payableCurrent: number; memberBalanceLiability: number }

export default function AccountingPage() {
  const sum = useData<Summary>('/finance/summary');
  const ar = useData<{ id: string; no: string; seller: string; total: number }[]>('/finance/receivables');
  const ap = useData<PayableRow[]>('/finance/payables');
  const un = useData<{ id: string; no: string; product: string; supplier: string | null; accepted: number; amount: number }[]>('/finance/unbilled-receipts');
  const act = useAct();
  const f = useForm({ amount: '1000000', ref: 'PAY-0001' });
  const s = sum.data;
  return (
    <>
      <PageHead title="Akuntansi" desc="Piutang, utang, kas, aging dan pembayaran." />
      <div className="page">
        <Gate q={sum}>
          {s && (
            <Kpis>
              <Kpi l="Piutang (AR)" v={R(s.receivable)} n={`${s.receivableCount} pesanan`} />
              <Kpi l="Utang (AP)" v={R(s.payable)} n={s.payableOverdue ? `${R(s.payableOverdue)} lewat waktu` : 'tidak ada lewat waktu'} tone={s.payableOverdue ? 'bad' : 'ok'} />
              <Kpi l="Kas tercatat" v={R(s.cash)} />
              <Kpi l="Kewajiban saldo belanja 2210" v={R(s.memberBalanceLiability)} n="saldo anggota" />
            </Kpis>
          )}
          <Block title="Piutang (AR) · catat pembayaran pelanggan" note="Jangan catat kas lagi untuk pesanan yang sudah dibayar dari saldo belanja.">
            <Table empty="Tidak ada piutang." rows={ar.data ?? []} cols={[{ head: 'Pesanan', mono: true, cell: (r) => r.no }, { head: 'Penjual', cell: (r) => r.seller }, { head: 'Nilai', mono: true, cell: (r) => R(r.total) }]}
              actions={(r) => <Btn sm onClick={() => act.post(`/orders/${r.id}/pay-cash`, `Penerimaan kas untuk ${r.no}`)}>Catat pembayaran penuh</Btn>} />
          </Block>
          <Block title="Penerimaan PO belum ditagihkan" note="Invoice dibuat dari kuantitas layak setelah PO selesai diterima.">
            <Table empty="Semua penerimaan layak sudah ditagihkan." rows={un.data ?? []} cols={[
              { head: 'PO', mono: true, cell: (r) => r.no }, { head: 'Produk', cell: (r) => r.product }, { head: 'Pemasok', cell: (r) => r.supplier ?? '—' },
              { head: 'Layak', mono: true, cell: (r) => `${r.accepted}` }, { head: 'Nilai', mono: true, cell: (r) => R(r.amount) },
            ]} actions={(r) => <Btn sm onClick={() => act.post(`/finance/purchase-orders/${r.id}/invoice`, 'Invoice dicatat')}>Catat invoice PO</Btn>} />
          </Block>
          <Block title="Utang pemasok (AP)" note="Pembayaran tidak boleh melebihi sisa utang dan kas harus cukup. Referensi pembayaran tidak boleh ganda.">
            <Fields><Field {...f.bind('amount', 'Jumlah dibayar (Rp)')} type="number" /><Field {...f.bind('ref', 'Referensi pembayaran')} /></Fields>
            <Table rows={ap.data ?? []} cols={[
              { head: 'Invoice', mono: true, cell: (r) => r.no }, { head: 'Pemasok', cell: (r) => r.supplier ?? '—' }, { head: 'Jatuh tempo', mono: true, cell: (r) => r.dueDate },
              { head: 'Sisa', mono: true, cell: (r) => R(r.outstanding) },
              { head: 'Status', cell: (r) => <Badge tone={r.status === 'overdue' ? 'bad' : 'ok'}>{r.status === 'paid' ? 'Lunas' : r.status === 'overdue' ? 'Lewat waktu' : 'Belum jatuh tempo'}</Badge> },
            ]} actions={(r) => r.outstanding > 0 && <Btn sm onClick={() => act.post(`/finance/payables/${r.id}/payments`, 'Pembayaran dicatat', { amount: Number(f.v.amount), ref: f.v.ref })}>Bayar</Btn>} />
          </Block>
          {s && (
            <Block title="Aging AP & neraca ringkas">
              <Table rows={[
                { id: '1', k: 'Utang belum jatuh tempo', v: s.payableCurrent, bad: false }, { id: '2', k: 'Utang lewat waktu', v: s.payableOverdue, bad: s.payableOverdue > 0 },
                { id: '3', k: 'Kas tercatat', v: s.cash, bad: false }, { id: '4', k: '2210 Kewajiban saldo belanja', v: s.memberBalanceLiability, bad: false },
              ]} cols={[{ head: 'Akun / kelompok', cell: (r) => r.k }, { head: 'Saldo', mono: true, cell: (r) => <Badge tone={r.bad ? 'bad' : ''}>{R(r.v)}</Badge> }]} />
            </Block>
          )}
        </Gate>
      </div>
    </>
  );
}
