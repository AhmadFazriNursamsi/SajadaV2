import { Badge, Block, Gate, Kpi, Kpis, PageHead, Table } from '../ui';
import { R, useData } from '../hooks';

interface Summary {
  amount: number; totalDays: number;
  kpis: { collected: number; arrears: number; running: number; settled: number; notStarted: number };
  members: { id: string; name: string; memberNo: string | null; paidDays: number; remainingDays: number; arrears: number; rewardBalance: number; status: 'belum_mulai' | 'berjalan' | 'lunas' }[];
}

const STATUS = { belum_mulai: ['warn', 'Belum mulai'], berjalan: ['ok', 'Berjalan'], lunas: ['ok', 'Lunas'] } as const;
const sub = { fontSize: 12, color: 'var(--muted)' } as const;

/** Tagihan harian anggota (pengurus): Rp30.000 per hari aktif dari saldo penarikan, 730 hari aktif; kemajuan dan tunggakan tiap anggota. */
export default function InstallmentsPage() {
  const q = useData<Summary>('/installments/summary');
  const d = q.data;
  return (
    <>
      <PageHead title="Tagihan harian" desc={d ? `Otomatis dipotong ${R(d.amount)} dari saldo penarikan (sekali per hari) pada hari ketika total imbalan anggota dari belanja sendiri yang diterima sudah mencapai ${R(d.amount)}, sampai ${d.totalDays} hari aktif. Hari dengan imbalan di bawah batas itu dilewati, jadi pelunasan makin panjang bila imbalannya kecil atau jarang belanja.` : ''} />
      <div className="page">
        <Gate q={q}>
          {d && (<>
            <Kpis>
              <Kpi l="Total terkumpul" v={R(d.kpis.collected)} n="dari saldo penarikan anggota" tone="ok" />
              <Kpi l="Tunggakan" v={R(d.kpis.arrears)} n="belum terpotong" tone={d.kpis.arrears ? 'warn' : undefined} />
              <Kpi l="Berjalan" v={d.kpis.running} n={`${d.kpis.notStarted} belum mulai`} />
              <Kpi l="Lunas" v={d.kpis.settled} n={`dari ${d.kpis.running + d.kpis.settled + d.kpis.notStarted} anggota`} />
            </Kpis>
            <Block title="Kemajuan per anggota" note={`Lunas setelah ${d.totalDays} hari aktif dan tanpa tunggakan.`}>
              <Table empty="Belum ada anggota." rows={d.members} cols={[
                { head: 'Anggota', cell: (m) => <>{m.name}<div style={sub}>{m.memberNo ?? '—'}</div></> },
                { head: 'Hari aktif', mono: true, right: true, cell: (m) => `${m.paidDays} / ${d.totalDays}` },
                { head: 'Sisa hari', mono: true, right: true, cell: (m) => m.remainingDays },
                { head: 'Tunggakan', mono: true, right: true, cell: (m) => (m.arrears ? <Badge tone="bad">{R(m.arrears)}</Badge> : '—') },
                { head: 'Saldo penarikan', mono: true, right: true, cell: (m) => R(m.rewardBalance) },
                { head: 'Status', cell: (m) => <Badge tone={STATUS[m.status][0]}>{STATUS[m.status][1]}</Badge> },
              ]} />
            </Block>
          </>)}
        </Gate>
      </div>
    </>
  );
}
