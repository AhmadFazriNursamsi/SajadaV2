import { formatReferral } from '@sajadah/shared';
import { Badge, Block, Btn, Gate, Kpi, Kpis, PageHead, Table } from '../ui';
import { R, useData, useToast } from '../hooks';

interface Net {
  referralCode: string; sponsor: string | null; personal: number; downlineVolume: number;
  bonus: { pending: number; approved: number; paid: number; thisMonth: number; total: number };
  perLevel: { level: number; percent: number; members: number; volume: number; bonus: number }[];
  downline: { id: string; name: string; level: number; active: boolean; referrals: number; volume: number; bonus: number }[];
}

/** Jaringan anggota: kode referal, orang yang diajak (tingkat 1–3), dan bonus dari penjualan mereka. */
export default function MyNetworkPage() {
  const q = useData<Net>('/me/network');
  const toast = useToast();
  const d = q.data;
  const msg = d ? `Ayo bergabung jadi anggota Koperasi Sajadah! Saat mendaftar lewat petugas koperasi, sebutkan kode referal saya: ${formatReferral(d.referralCode)}` : '';
  const copy = async () => { try { await navigator.clipboard.writeText(msg); toast('Ajakan disalin'); } catch { toast('Tidak dapat menyalin; salin manual', false); } };
  return (
    <>
      <PageHead title="Jaringan saya" desc="Ajak pelanggan menjadi anggota dengan kode referal Anda. Anda mendapat bonus dari setiap penjualan mereka ke pelanggan, setelah pesanan lunas dan diterima." />
      <div className="page">
        <Gate q={q}>
          {d && (<>
            <Kpis>
              <Kpi l="Bonus jaringan" v={R(d.bonus.total)} n={`bulan ini ${R(d.bonus.thisMonth)}`} tone="ok" />
              <Kpi l="Menunggu persetujuan" v={R(d.bonus.pending)} n="oleh pengurus" tone={d.bonus.pending ? 'warn' : ''} />
              <Kpi l="Siap dibayar" v={R(d.bonus.approved)} />
              <Kpi l="Sudah dibayar" v={R(d.bonus.paid)} />
            </Kpis>
            <Block title="Kode referal saya" note="Beri kode ini ke pelanggan yang mau jadi anggota; petugas memasukkannya saat mendaftarkan mereka, lalu Anda otomatis menjadi sponsornya." tools={<Btn kind="s" onClick={() => void copy()}>Salin ajakan</Btn>}>
              <div style={{ padding: '16px 18px', fontSize: 30, fontWeight: 700, letterSpacing: 4, fontFamily: 'var(--mono, monospace)', color: 'var(--brand)' }}>{formatReferral(d.referralCode)}</div>
            </Block>
            <Block title="Bonus per tingkat" note={`Sponsor saya: ${d.sponsor ?? 'tanpa sponsor'} · volume penjualan Anda ${R(d.personal)} · volume jaringan ${R(d.downlineVolume)}`}>
              <Table rows={d.perLevel.map((l) => ({ ...l, id: String(l.level) }))} cols={[
                { head: 'Tingkat', cell: (l) => `Tingkat ${l.level}` }, { head: 'Bonus', mono: true, right: true, cell: (l) => `${l.percent}%` },
                { head: 'Anggota', mono: true, right: true, cell: (l) => l.members }, { head: 'Penjualan', mono: true, right: true, cell: (l) => R(l.volume) }, { head: 'Bonus Anda', mono: true, right: true, cell: (l) => <b>{R(l.bonus)}</b> },
              ]} />
            </Block>
            <Block title="Orang yang saya ajak">
              <Table empty="Belum ada yang diajak. Bagikan kode referal Anda ke pelanggan." rows={d.downline} cols={[
                { head: 'Nama', cell: (x) => x.name }, { head: 'Tingkat', mono: true, right: true, cell: (x) => `T${x.level}` },
                { head: 'Status', cell: (x) => <Badge tone={x.active ? 'ok' : 'warn'}>{x.active ? 'Aktif' : 'Belum aktif'}</Badge> },
                { head: 'Mengajak', mono: true, right: true, cell: (x) => x.referrals || '—' },
                { head: 'Penjualan', mono: true, right: true, cell: (x) => (x.volume ? R(x.volume) : '—') }, { head: 'Bonus Anda', mono: true, right: true, cell: (x) => <b>{x.bonus ? R(x.bonus) : '—'}</b> },
              ]} />
            </Block>
            <p className="note">Bonus hanya dari penjualan ke pelanggan umum. Perubahan sponsor dikelola pengurus dan tidak mengubah bonus pesanan lama.</p>
          </>)}
        </Gate>
      </div>
    </>
  );
}
