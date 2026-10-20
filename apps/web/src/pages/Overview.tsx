import { useNavigate } from 'react-router-dom';
import { Badge, Block, Btn, Gate, Kpi, Kpis, PageHead, Table } from '../ui';
import { R, useData } from '../hooks';
import type { Overview } from '../types';

export default function OverviewPage() {
  const q = useData<Overview>('/overview');
  const nav = useNavigate();
  const d = q.data;
  const max = Math.max(1, ...(d?.sales7.map((s) => s.packs) ?? [1]));
  return (
    <>
      <PageHead title="Ringkasan" desc={`Indikator tenant ${d?.tenant.name ?? ''}. Periksa tindakan tertunda sebelum menutup hari.`} />
      <div className="page">
        <Gate q={q}>
          {d && (
            <>
              <Kpis>
                <Kpi to="/anggota" l="Saldo belanja anggota" v={R(d.kpis.memberBalance)} n={`${d.kpis.activeMembers} anggota aktif`} />
                <Kpi to="/persediaan" l="Stok tersedia" v={`${d.kpis.availableStock}`} n={`${d.kpis.lowStockProducts} produk ≤ safety stock`} tone={d.kpis.lowStockProducts ? 'bad' : 'ok'} />
                <Kpi to="/pesanan" l="Nilai pesanan" v={R(d.kpis.salesValue)} n={`${d.kpis.orderCount} pesanan`} />
                <Kpi to="/pendapatan" l="Saldo penarikan anggota" v={R(d.kpis.rewardBalance)} n={`${d.kpis.coinBalance.toLocaleString('id-ID')} koin beredar`} />
              </Kpis>
              <Block title="Penjualan 7 hari">
                <div className="bars" role="img" aria-label="Grafik penjualan 7 hari">
                  {d.sales7.map((s) => (
                    <div className="bar" key={s.date}><em>{s.packs}</em><i style={{ height: `${(s.packs / max) * 100}%` }} /><span>{new Date(s.date).toLocaleDateString('id-ID', { weekday: 'short' })}</span></div>
                  ))}
                </div>
              </Block>
              <Block title="Perlu tindakan">
                <Table
                  cols={[{ head: 'Pekerjaan', cell: (r) => r.t }, { head: 'Jumlah', mono: true, cell: (r) => <Badge tone={r.n ? 'warn' : 'ok'}>{r.n}</Badge> }]}
                  rows={[
                    { t: 'Permintaan stok dari toko menunggu dikirim', n: d.actions.stockRequests, to: '/persediaan' },
                    { t: 'Pesanan menunggu persetujuan toko', n: d.actions.awaitingApproval, to: '/pesanan' },
                    { t: 'Pesanan lunas belum dikirim', n: d.actions.paidNotShipped, to: '/pesanan' },
                    { t: 'Penarikan saldo menunggu ditransfer', n: d.actions.withdrawalsPending, to: '/penarikan' },
                    { t: 'Penukaran voucher menunggu diterbitkan', n: d.actions.redemptionsPending, to: '/voucher' },
                  ]}
                  onRow={(r) => r.to && nav(r.to)}
                  actions={(r) => r.to ? <Btn sm kind="g" onClick={() => nav(r.to)}>Buka</Btn> : null}
                />
              </Block>
              <Block title="Aktivitas terakhir">
                <Table empty="Belum ada aktivitas." cols={[{ head: 'Waktu', mono: true, cell: (r) => new Date(r.at).toLocaleString('id-ID') }, { head: 'Oleh', cell: (r) => r.actor ?? '—' }, { head: 'Catatan', cell: (r) => r.message }]} rows={d.activity} />
              </Block>
            </>
          )}
        </Gate>
      </div>
    </>
  );
}
