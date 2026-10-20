import { Block, Gate, Kpi, Kpis, PageHead, Table } from '../ui';
import { R, useData } from '../hooks';

interface Summary {
  percent: number;
  kpis: { rewardBalance: number; rewardEarned: number; withdrawnPaid: number; coinBalance: number; coinsEarned: number; coinsRedeemed: number; withdrawalsPending: number; redemptionsPending: number };
  orders: { id: string; no: string; at: string; memberName: string; memberNo: string | null; total: number; reward: number; coins: number }[];
  members: { id: string; name: string; memberNo: string | null; balance: number; rewardBalance: number; coinBalance: number }[];
}

const stamp = (s: string) => new Date(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const sub = { fontSize: 12, color: 'var(--muted)' } as const;

/** Imbalan anggota (pengurus): saldo penarikan dan koin yang dibagikan dari belanja sendiri yang sudah diterima, per pesanan dan per anggota. */
export default function RewardsPage() {
  const q = useData<Summary>('/rewards/summary');
  const d = q.data;
  return (
    <>
      <PageHead title="Imbalan anggota" desc={`Tiap belanja sendiri yang sudah diterima memberi anggota ${d?.percent ?? 20}% dari nilainya ke saldo penarikan, ditambah koin sesuai koin per produk. Saldo penarikan ditarik lewat menu Penarikan saldo; koin ditukar lewat menu Voucher koin.`} />
      <div className="page">
        <Gate q={q}>
          {d && (<>
            <Kpis>
              <Kpi to="/penarikan" l="Saldo penarikan beredar" v={R(d.kpis.rewardBalance)} n={`${d.kpis.withdrawalsPending} penarikan menunggu`} tone={d.kpis.withdrawalsPending ? 'warn' : undefined} />
              <Kpi l="Imbalan dibagikan" v={R(d.kpis.rewardEarned)} n={`${R(d.kpis.withdrawnPaid)} sudah ditransfer`} />
              <Kpi to="/voucher" l="Koin beredar" v={d.kpis.coinBalance.toLocaleString('id-ID')} n={`${d.kpis.redemptionsPending} penukaran menunggu`} tone={d.kpis.redemptionsPending ? 'warn' : undefined} />
              <Kpi l="Koin dibagikan" v={d.kpis.coinsEarned.toLocaleString('id-ID')} n={`${d.kpis.coinsRedeemed.toLocaleString('id-ID')} sudah ditukar`} />
            </Kpis>
            <Block title="Imbalan per pesanan" note="Dikreditkan sekali per pesanan, saat barang diterima. Pesanan yang dibatalkan sebelum diterima tidak memberi imbalan.">
              <Table empty="Belum ada pesanan yang memberi imbalan." rows={d.orders} cols={[
                { head: 'Pesanan', cell: (o) => <><b>{o.no}</b><div style={sub}>{stamp(o.at)}</div></> },
                { head: 'Anggota', cell: (o) => <>{o.memberName}<div style={sub}>{o.memberNo ?? '—'}</div></> },
                { head: 'Nilai', mono: true, right: true, cell: (o) => R(o.total) },
                { head: `Saldo penarikan (${d.percent}%)`, mono: true, right: true, cell: (o) => R(o.reward) },
                { head: 'Koin', mono: true, right: true, cell: (o) => o.coins.toLocaleString('id-ID') },
              ]} />
            </Block>
            <Block title="Saldo per anggota" note="Anggota yang punya saldo penarikan atau koin.">
              <Table empty="Belum ada anggota dengan saldo penarikan atau koin." rows={d.members} cols={[
                { head: 'Anggota', cell: (m) => <>{m.name}<div style={sub}>{m.memberNo ?? '—'}</div></> },
                { head: 'Saldo belanja', mono: true, right: true, cell: (m) => R(m.balance) },
                { head: 'Saldo penarikan', mono: true, right: true, cell: (m) => R(m.rewardBalance) },
                { head: 'Koin', mono: true, right: true, cell: (m) => m.coinBalance.toLocaleString('id-ID') },
              ]} />
            </Block>
          </>)}
        </Gate>
      </div>
    </>
  );
}
