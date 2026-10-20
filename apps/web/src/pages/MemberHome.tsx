import { MLM_ENABLED } from '../features';
import { Badge, Block, Gate, Kpi, Kpis, PageHead, Table } from '../ui';
import { R, useData } from '../hooks';
import { orderLabel } from '../types';

export default function MemberHome() {
  const me = useData<any>('/me');
  const ord = useData<any>('/me/orders');
  const ent = useData<any>('/me/entitlements');
  const m = me.data;
  return (
    <>
      <PageHead title={m ? `Halo, ${m.name}` : 'Hak saya'} desc="Tampilan hanya lihat. Transaksi dicatat oleh petugas koperasi." />
      <div className="page">
        <Gate q={me}>
          {m && (
            <Kpis>
              <Kpi l="Saldo belanja" v={R(m.balance)} n="hanya untuk pesanan koperasi" tone="ok" />
              <Kpi l="Nomor anggota" v={m.memberNo ?? '—'} />
              <Kpi l="Sisa penyertaan" v={R(ent.data?.remaining ?? 0)} n="bagian anggota 20% sampai penyertaan kembali" tone="warn" />
            </Kpis>
          )}
          <Block title="Pesanan saya" note={ord.data && MLM_ENABLED ? `Penjualan ${R(ord.data.salesValue)} · komisi menunggu ${R(ord.data.pendingCommission)}` : ''}>
            <Table empty="Belum ada pesanan." rows={ord.data?.orders ?? []} cols={[
              { head: 'No.', mono: true, cell: (o: any) => o.no }, { head: 'Sebagai', cell: (o: any) => (o.role === 'seller' ? 'Penjual' : 'Pembeli') },
              { head: 'Item', cell: (o: any) => `${o.product} ×${o.qty}` }, { head: 'Nilai', mono: true, cell: (o: any) => R(o.total) },
              { head: 'Status', cell: (o: any) => <Badge tone={orderLabel[o.status as keyof typeof orderLabel][1]}>{orderLabel[o.status as keyof typeof orderLabel][0]}</Badge> },
            ]} />
          </Block>
          <Block title="Laporan bagi hasil saya">
            <Table empty="Belum ada laporan." rows={(ent.data?.reports ?? []).map((r: any) => ({ id: r.no, ...r }))} cols={[
              { head: 'ID', mono: true, cell: (r: any) => r.no }, { head: 'Periode', mono: true, cell: (r: any) => r.period }, { head: 'Laba', mono: true, cell: (r: any) => R(r.profit) },
              { head: 'Bagian saya', mono: true, cell: (r: any) => (r.status === 'settled' ? R(r.memberShare) : '—') },
              { head: 'Status', cell: (r: any) => <Badge tone={r.status === 'settled' ? 'ok' : 'warn'}>{r.status === 'settled' ? 'Settled' : 'Draf'}</Badge> },
            ]} />
          </Block>
        </Gate>
      </div>
    </>
  );
}
