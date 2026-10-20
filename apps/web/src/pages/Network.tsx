import { MAX_UPLINE_DEPTH, formatReferral } from '@sajadah/shared';
import { Block, Gate, Kpi, Kpis, PageHead, Table } from '../ui';
import { R, useData } from '../hooks';
import type { MemberRow } from '../types';

interface NetRow { id: string; name: string; sponsorId: string | null; downlineCount: number; personal: number; downline: number; group: number }

export default function NetworkPage() {
  const q = useData<NetRow[]>('/members/network');
  const mem = useData<MemberRow[]>('/members');
  const rows = q.data ?? [], ms = mem.data ?? [];
  const code = (id: string) => { const c = ms.find((m) => m.id === id)?.referralCode; return c ? formatReferral(c) : '—'; };
  const nm = (id: string | null) => (id ? rows.find((r) => r.id === id)?.name ?? '—' : 'Tanpa sponsor');
  return (
    <>
      <PageHead title="Jaringan MLM" desc="Sponsor, kode referal, downline dan volume. Jaringan hanya memuat anggota tenant yang sama dan tidak boleh membentuk siklus." />
      <div className="page">
        <Gate q={q}>
          <Kpis>
            <Kpi l="Anggota di jaringan" v={rows.length} />
            <Kpi l="Dengan sponsor" v={rows.filter((r) => r.sponsorId).length} />
            <Kpi l="Volume pribadi" v={R(rows.reduce((a, r) => a + r.personal, 0))} n="penjualan berbayar" />
            <Kpi l="Kedalaman maks." v={MAX_UPLINE_DEPTH + 1} n="penjual + 3 upline" />
          </Kpis>
          <Block title="Sponsor & volume" note="Volume grup = pribadi + downline, dengan transaksi unik.">
            <Table rows={rows} cols={[
              { head: 'Anggota', cell: (r) => r.name }, { head: 'Kode referal', mono: true, cell: (r) => code(r.id) }, { head: 'Sponsor', cell: (r) => nm(r.sponsorId) }, { head: 'Downline', mono: true, cell: (r) => r.downlineCount },
              { head: 'Pribadi', mono: true, cell: (r) => R(r.personal) }, { head: 'Downline (Rp)', mono: true, cell: (r) => R(r.downline) }, { head: 'Grup', mono: true, cell: (r) => R(r.group) },
            ]} />
          </Block>
        </Gate>
      </div>
    </>
  );
}
