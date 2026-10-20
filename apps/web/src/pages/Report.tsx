import { useState } from 'react';
import { Badge, Block, Gate, Kpi, Kpis, PageHead, Segmented, Table } from '../ui';
import { R, useData } from '../hooks';
import { dayLabel, type SalesReport } from '../report';
import { ratesText, useRates } from '../rates';

/** Laporan penjualan harian anggota + saldo komisi otomatis (dari penjualan yang sudah diterima pembeli). */
export default function ReportPage() {
  const rates = useRates();
  const [days, setDays] = useState('14');
  const q = useData<SalesReport>(`/me/sales-report?days=${days}`);
  const r = q.data;
  return (
    <>
      <PageHead title="Laporan penjualan" desc="Penjualan Anda per hari dan saldo komisi yang dihitung otomatis. Penjualan dihitung pada hari pembeli menerima barang, setelah pesanan lunas." />
      <div className="page">
        <Gate q={q}>
          {r && (<>
            <Kpis>
              <Kpi l="Saldo komisi" v={R(r.balance.available)} n="sudah dihitung, belum dibayar" tone="ok" />
              <Kpi l="Menunggu persetujuan" v={R(r.balance.pending)} n="oleh pengurus" tone={r.balance.pending ? 'warn' : ''} />
              <Kpi l="Siap dibayar" v={R(r.balance.approved)} n="sudah disetujui" />
              <Kpi l="Sudah dibayar" v={R(r.balance.paid)} n="sampai sekarang" />
            </Kpis>
            {(r.balance.clawback > 0 || r.inProgress.orders > 0) && (
              <p className="note">
                {r.inProgress.orders > 0 && <>Dalam proses: <b>{r.inProgress.orders} pesanan</b> belum lunas/diterima (potensi komisi {R(r.inProgress.potentialCommission)}, belum dihitung). </>}
              </p>
            )}
            <div style={{ maxWidth: 380 }}><Segmented label="Periode" value={days} onChange={setDays} options={[{ value: '7', label: '7 hari' }, { value: '14', label: '14 hari' }, { value: '30', label: '30 hari' }]} /></div>
            <Block title={`Penjualan per hari · ${r.period.days} hari terakhir`} note={`Total ${r.period.ownOrders} pesanan, ${r.period.ownPacks}, omzet ${R(r.period.ownTurnover)} · komisi ${R(r.period.total)} · aktif ${r.period.activeDays} hari (${r.timezone}).`}>
              <Table rows={r.days.map((d) => ({ ...d, id: d.date }))} fixed cols={[
                { head: 'Hari', cell: (d) => <>{dayLabel(d.date)}{d.date === r.days[0]?.date && <> <Badge tone="ok">hari ini</Badge></>}</> },
                { head: 'Pesanan', mono: true, right: true, w: '90px', cell: (d) => d.ownOrders || '—' },
                { head: 'Jumlah', mono: true, right: true, w: '70px', cell: (d) => d.ownPacks || '—' },
                { head: 'Omzet', mono: true, right: true, cell: (d) => (d.ownTurnover ? R(d.ownTurnover) : '—') },
                { head: 'Komisi penjualan', mono: true, right: true, cell: (d) => (d.ownCommission ? R(d.ownCommission) : '—') },
                { head: 'Komisi jaringan', mono: true, right: true, cell: (d) => (d.networkCommission ? R(d.networkCommission) : '—') },
                { head: 'Total komisi', mono: true, right: true, cell: (d) => <b>{d.total ? R(d.total) : '—'}</b> },
              ]} />
            </Block>
            <p className="note">Komisi: {rates[0]}% dari penjualan Anda, ditambah {rates.slice(1).join('/')}% dari penjualan downline tingkat 1–3 (tarif saat pesanan dibuat; sekarang berlaku {ratesText(rates)}%). Hanya penjualan ke pelanggan umum yang dihitung; belanja untuk diri sendiri, pesanan batal, dan pesanan yang diretur tidak. Komisi baru bisa dibayar setelah disetujui keuangan.</p>
          </>)}
        </Gate>
      </div>
    </>
  );
}
