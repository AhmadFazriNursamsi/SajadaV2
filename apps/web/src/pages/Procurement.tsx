import { Badge, Block, Btn, Field, Fields, Gate, Kpi, Kpis, PageHead, Table } from '../ui';
import { R, useAct, useData, useForm } from '../hooks';
import { poLabel, type PoRow, type ProductRow } from '../types';
import { useSession } from '../session';
import { useDepot } from '../depot';

export default function ProcurementPage() {
  const pos = useData<PoRow[]>('/purchase-orders');
  const d = useDepot();
  const prods = useData<ProductRow[]>(`/products?depotId=${d.depotId}`, d.ready);
  const sup = useData<{ id: string; name: string; phone: string | null }[]>('/suppliers');
  const act = useAct();
  const { me } = useSession();
  const f = useForm({ ok: '5', no: '0', date: new Date().toISOString().slice(0, 10) });
  const ps = pos.data ?? [];
  const admin = me?.role === 'tenant_admin';
  const ops = true;
  return (
    <>
      <PageHead title="Safety stock & PO" desc="Pemasok, aturan stok minimum dan PO. Draf PO bukan pembelian yang sudah dikirim ke pemasok." />
      <div className="page">
        <Gate q={pos}>
          <Kpis>
            <Kpi l="Draf PO" v={ps.filter((p) => p.status === 'draft').length} n="menunggu persetujuan" tone="warn" />
            <Kpi l="PO disetujui" v={ps.filter((p) => p.status === 'approved' || p.status === 'partial').length} n="menunggu barang" />
            <Kpi l="Aturan aktif" v={`${(prods.data ?? []).filter((p) => p.autoReplenish).length} / ${(prods.data ?? []).length}`} />
            <Kpi l="Barang ditolak" v={`${ps.reduce((a, p) => a + p.rejected, 0)}`} n="tidak menambah stok" tone="bad" />
          </Kpis>
          <Block title="Master pemasok">
            <Table rows={sup.data ?? []} cols={[{ head: 'Pemasok', cell: (s) => s.name }, { head: 'Kontak', mono: true, cell: (s) => s.phone ?? '—' }, { head: 'Status', cell: () => <Badge tone="ok">Aktif</Badge> }]} />
          </Block>
          <Block title="Aturan safety stock" note="Otomatis: saat tersedia ≤ safety, kebutuhan dibulatkan ke MOQ dan kelipatan." tools={ops && <Btn kind="s" onClick={() => act.post('/replenishment/evaluate', 'Aturan dievaluasi')}>Evaluasi aturan</Btn>}>
            <Table rows={prods.data ?? []} cols={[
              { head: 'Produk', cell: (p) => p.name }, { head: 'Safety', mono: true, cell: (p) => p.safety }, { head: 'Target', mono: true, cell: (p) => p.target },
              { head: 'MOQ', mono: true, cell: (p) => p.moq }, { head: 'Kelipatan', mono: true, cell: (p) => p.multiple }, { head: 'Harga beli', mono: true, cell: (p) => R(p.buyPrice) },
              { head: 'Otomatis', cell: (p) => <Badge tone={p.autoReplenish ? 'ok' : 'warn'}>{p.autoReplenish ? 'Aktif' : 'Jeda'}</Badge> },
            ]} actions={(p) => ops && <Btn sm kind="g" onClick={() => act.run('PATCH', `/products/${p.id}/auto`, `Aturan ${p.name} diubah`)}>{p.autoReplenish ? 'Jedakan' : 'Aktifkan'}</Btn>} />
          </Block>
          <Block title="Purchase order" note="Penerimaan boleh sebagian; hanya kuantitas layak yang menambah stok. PO ditutup setelah seluruh kuantitas diterima layak.">
            <Fields><Field {...f.bind('ok', 'Jumlah layak')} type="number" /><Field {...f.bind('no', 'Jumlah ditolak')} type="number" /><Field {...f.bind('date', 'Tanggal dijanjikan pemasok')} type="date" /></Fields>
            <Table rows={ps} cols={[
              { head: 'PO', mono: true, cell: (p) => p.no }, { head: 'Toko', cell: (p) => p.depot }, { head: 'Produk', cell: (p) => p.product }, { head: 'Jumlah', mono: true, cell: (p) => `${p.qty}` },
              { head: 'Layak / ditolak', mono: true, cell: (p) => `${p.accepted} / ${p.rejected}` },
              { head: 'Status', cell: (p) => <Badge tone={poLabel[p.status][1]}>{poLabel[p.status][0] + (p.promisedDate ? ` · ${p.promisedDate}` : '')}</Badge> },
            ]} actions={(p) => (<>
              {admin && p.status === 'draft' && <Btn sm onClick={() => act.post(`/purchase-orders/${p.id}/approve`, `${p.no} disetujui (belum dikirim ke pemasok)`)}>Setujui</Btn>}
              {ops && (p.status === 'approved' || p.status === 'partial') && (<>
                <Btn sm kind="g" onClick={() => act.post(`/purchase-orders/${p.id}/schedule`, 'Jadwal pemasok dicatat', { date: f.v.date })}>Konfirmasi jadwal</Btn>
                {me?.role === 'staff' && <Btn sm onClick={() => act.post(`/purchase-orders/${p.id}/receive`, 'Penerimaan dicatat', { accepted: Number(f.v.ok), rejected: Number(f.v.no) })}>Periksa & terima barang</Btn>}
              </>)}
            </>)} />
          </Block>
        </Gate>
      </div>
    </>
  );
}
