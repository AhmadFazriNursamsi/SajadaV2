import { useQuery } from '@tanstack/react-query';
import { Badge, Block, Btn, Field, Fields, Gate, Kpi, Kpis, PageHead, Table } from '../ui';
import { R, useAct, useData, useForm } from '../hooks';
import { get } from '../api';
import type { Funding, MemberRow, ReportRow } from '../types';
import { useSession } from '../session';

interface Scenario { rows: { name: string; amount: number; member: number; investor: number }[]; member: number; investor: number }

export default function InvestorPage() {
  const rep = useData<ReportRow[]>('/profit-reports');
  const mem = useData<MemberRow[]>('/members');
  const fund = useData<Funding>('/investors/funding');
  const act = useAct();
  const { me } = useSession();
  const finance = me?.role === 'tenant_admin';
  const admin = me?.role === 'tenant_admin';
  const f = useForm({ invCode: '', invName: '', invShare: '50', member: '', period: new Date().toISOString().slice(0, 7), ref: 'LAP-001', revenue: '25000000', cost: '5000000', sLaba: '20000000', sRem: '12500000', sCum: '0' });
  const rs = rep.data ?? [], ms = (mem.data ?? []).filter((m) => m.active);
  const settled = rs.filter((r) => r.status === 'settled');
  const sc = useQuery({
    queryKey: ['scenario', f.v.sLaba, f.v.sRem, f.v.sCum],
    queryFn: () => get<Scenario>(`/investors/scenario?profit=${Number(f.v.sLaba) || 0}&remaining=${Number(f.v.sRem) || 0}&cumulative=${Number(f.v.sCum) || 0}`),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHead title="Dashboard investor" desc="Laporan bagi hasil, posisi anggota dan skenario bertingkat. Draf tidak masuk hasil; skenario tidak menyimpan laporan." />
      <div className="page">
        <Gate q={rep}>
          <Kpis>
            <Kpi l="Laporan settled" v={settled.length} n={`${rs.length - settled.length} draf`} />
            <Kpi l="Bagian anggota" v={R(settled.reduce((a, r) => a + r.memberShare, 0))} tone="ok" />
            <Kpi l="Bagian investor" v={R(settled.reduce((a, r) => a + r.investorShare, 0))} />
            <Kpi l="Sisa penyertaan" v={R((mem.data ?? []).reduce((a, m) => a + m.remaining, 0))} n="semua anggota aktif" tone="warn" />
          </Kpis>
          {finance && (
            <Block title="Buat draf laporan bagi hasil" note="Anggota aktif, periode YYYY-MM. Biaya tidak boleh melebihi pendapatan; laporan rugi belum diproses. Satu draf per anggota."
              tools={<Btn onClick={() => act.post('/profit-reports', 'Draf laporan disimpan', { memberId: f.v.member, period: f.v.period, ref: f.v.ref, revenue: Number(f.v.revenue), cost: Number(f.v.cost) })}>Simpan draf</Btn>}>
              <Fields>
                <Field {...f.bind('member', 'Anggota')} options={[{ value: '', label: 'Pilih…' }, ...ms.map((m) => ({ value: m.id, label: m.name }))]} />
                <Field {...f.bind('period', 'Periode', 'YYYY-MM')} /><Field {...f.bind('ref', 'Referensi laporan')} />
                <Field {...f.bind('revenue', 'Pendapatan (Rp)')} type="number" /><Field {...f.bind('cost', 'Biaya (Rp)')} type="number" />
              </Fields>
            </Block>
          )}
          <Block title="Laporan bagi hasil" note="Sisa penyertaan dan laba pasca pemulihan berubah hanya setelah status settled.">
            <Table empty="Belum ada laporan." rows={rs} cols={[
              { head: 'ID', mono: true, cell: (r) => r.no }, { head: 'Anggota', cell: (r) => r.member }, { head: 'Periode', mono: true, cell: (r) => r.period },
              { head: 'Laba bersih', mono: true, cell: (r) => R(r.profit) },
              { head: 'Anggota', mono: true, cell: (r) => (r.status === 'settled' ? R(r.memberShare) : '—') },
              { head: 'Investor', mono: true, cell: (r) => (r.status === 'settled' ? R(r.investorShare) : '—') },
              { head: 'Status', cell: (r) => <Badge tone={r.status === 'draft' ? 'warn' : 'ok'}>{r.status === 'draft' ? 'Draf' : 'Settled'}</Badge> },
            ]} actions={(r) => (<>
              {finance && r.status === 'draft' && <Btn sm onClick={() => act.post(`/profit-reports/${r.id}/settle`, `${r.no} diselesaikan`)}>Catat penyelesaian</Btn>}
            </>)} />
          </Block>
          <Block title="Posisi per anggota">
            <Table rows={ms} cols={[
              { head: 'Anggota', cell: (m) => m.name }, { head: 'Sisa penyertaan', mono: true, cell: (m) => R(m.remaining) },
              { head: 'Laba pasca pemulihan', mono: true, cell: (m) => R(m.cumulative) },
              { head: 'Fase', cell: (m) => <Badge tone={m.remaining > 0 ? 'warn' : 'ok'}>{m.remaining > 0 ? 'Pemulihan 20/80' : 'Marginal'}</Badge> },
            ]} />
          </Block>
          <Block title="Master investor" note="Porsi adalah acuan pembagian awal alokasi penyertaan; angka alokasi per anggota tetap bisa diubah saat dicatat. Investor yang sudah punya alokasi tidak dapat dihapus."
            tools={admin && <Btn onClick={() => act.post('/investors', 'Investor ditambahkan', { code: f.v.invCode, name: f.v.invName, sharePercent: Number(f.v.invShare) })}>Tambah investor</Btn>}>
            {admin && <Fields><Field {...f.bind('invCode', 'Kode', 'INV-03')} /><Field {...f.bind('invName', 'Nama investor')} /><Field {...f.bind('invShare', 'Porsi acuan (%)')} type="number" /></Fields>}
            <Table empty="Belum ada investor." rows={fund.data?.investors ?? []} cols={[
              { head: 'Kode', mono: true, cell: (i) => i.code }, { head: 'Investor', cell: (i) => i.name }, { head: 'Porsi acuan', mono: true, cell: (i) => `${i.sharePercent}%` },
              { head: 'Anggota terdanai', mono: true, cell: (i) => i.members }, { head: 'Total alokasi', mono: true, cell: (i) => R(i.allocated) },
            ]} actions={(i) => admin && i.members === 0 && <Btn sm kind="d" onClick={() => act.run('DELETE', `/investors/${i.id}`, 'Investor dihapus')}>Hapus</Btn>} />
          </Block>
          <Block title="Investor & alokasi penyertaan" note="Total alokasi per anggota harus Rp12.500.000 dan mempunyai referensi pendanaan (dicatat di halaman Anggota).">
            <Gate q={fund}>
              <Table rows={fund.data?.members ?? []} cols={[
                { head: 'Anggota', cell: (m) => m.name }, { head: 'Alokasi', mono: true, cell: (m) => (m.funded ? R(m.total) : '—') },
                ...(fund.data?.investors ?? []).map((i) => ({ head: `${i.name} (${i.sharePercent}%)`, mono: true, cell: (m: Funding['members'][number]) => (m.funded ? R(m.perInvestor.find((p) => p.code === i.code)?.amount ?? 0) : '—') })),
                { head: 'Referensi', mono: true, cell: (m) => (m.fundingRef ? `${m.fundingRef} · ${m.fundedAt ?? ''}` : '—') },
                { head: 'Status', cell: (m) => <Badge tone={m.funded ? 'ok' : 'warn'}>{m.funded ? 'Tercatat' : 'Belum'}</Badge> },
              ]} />
            </Gate>
          </Block>
          <Block title="Kalkulator skenario bertingkat" note="Hasil skenario tidak mengubah saldo atau laporan sumber.">
            <Fields><Field {...f.bind('sLaba', 'Laba bersih (Rp)')} type="number" /><Field {...f.bind('sRem', 'Sisa penyertaan (Rp)')} type="number" /><Field {...f.bind('sCum', 'Laba pasca pemulihan sebelumnya (Rp)')} type="number" /></Fields>
            <Table empty="Isi laba bersih." rows={[...(sc.data?.rows ?? []).map((r, i) => ({ id: String(i), ...r })), ...(sc.data ? [{ id: 'total', name: 'Total', amount: Number(f.v.sLaba) || 0, member: sc.data.member, investor: sc.data.investor }] : [])]} cols={[
              { head: 'Segmen', cell: (r) => r.name }, { head: 'Laba', mono: true, cell: (r) => R(r.amount) }, { head: 'Anggota', mono: true, cell: (r) => R(r.member) }, { head: 'Investor', mono: true, cell: (r) => R(r.investor) },
            ]} />
          </Block>
        </Gate>
      </div>
    </>
  );
}
