import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot } from './helpers';

let app: NestFastifyApplication;
let pengurus: Client, petugas: Client, petugas2: Client, anggota: Client;
let pusat: Client; // alias pengurus: mengurus produk, stok pusat, kirim ke toko
let depots: any[], prods: any[];
const stockOf = async (c: Client, depotId: string, sku: string) => (await c.get(`/products?depotId=${depotId}`)).body.find((p: any) => p.sku === sku);
const centralOf = async (sku: string) => (await pusat.get('/central/stock')).body.find((p: any) => p.sku === sku);

beforeAll(async () => {
  app = await boot();
  [pengurus, petugas, petugas2, anggota] = await Promise.all(['admin', 'petugas', 'petugas2', 'anggota'].map((r) => as(app, 'nasional', r)));
  pusat = pengurus;
  depots = (await pengurus.get('/depots')).body;
  prods = (await pengurus.get('/products')).body;
});
afterAll(() => app.close());

describe('Pengurus: akses pusat', () => {
  it('peran Admin pusat dan Akuntan tidak ada; akun lamanya tidak bisa masuk', async () => {
    for (const u of ['pusat.nasional', 'akuntan.nasional']) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: 'sajadah123' } });
      expect(r.statusCode).toBe(401);
    }
    expect((await pengurus.get('/auth/me')).body.role).toBe('tenant_admin');
    expect((await pengurus.get('/central-admins')).status).toBe(404);
  });

  it('petugas dan anggota TIDAK boleh membuat produk / stok pusat / kirim / memproses permintaan; petugas tidak melihat stok pusat', async () => {
    for (const c of [petugas, anggota]) {
      expect((await c.post('/central/products', { name: 'Gelap', buyPrice: 1000, sellPrice: 2000, safety: 1, target: 2 })).status).toBe(403);
      expect((await c.post('/central/receipts', { productId: prods[0].id, qty: 1 })).status).toBe(403);
      expect((await c.post('/central/shipments', { depotId: depots[0].id, items: [{ productId: prods[0].id, qty: 1 }] })).status).toBe(403);
      expect((await c.post('/central/requests/00000000-0000-4000-8000-000000000000/fulfill', { items: [{ productId: prods[0].id, qty: 1 }] })).status).toBe(403);
    }
    expect((await petugas.get('/central/stock')).status).toBe(403);
    expect((await anggota.get('/central/stock')).status).toBe(403);
    expect((await pengurus.get('/central/stock')).status).toBe(200);
  });
});

describe('Pengurus: produk', () => {
  it('buat produk baru: SKU otomatis, validasi harga, tidak boleh kembar', async () => {
    const bad = await pusat.post('/central/products', { name: 'Gratis', sellPrice: 0, safety: 2, target: 5 });
    expect(bad.status).toBe(400);
    expect((await pusat.post('/central/products', { name: 'Rugi', sellPrice: 6000, safety: 9, target: 5 })).status).toBe(400);
    const ok = await pusat.post('/central/products', { name: 'Produk D', buyPrice: 90000, sellPrice: 130000, safety: 4, target: 16 });
    expect(ok.status).toBe(201);
    expect(ok.body.sku).toBe('PRD-04');
    expect((await pusat.post('/central/products', { name: 'produk D', buyPrice: 90000, sellPrice: 130000, safety: 4, target: 16 })).status).toBe(422);
    expect((await pusat.post('/central/products', { name: 'Lain', sku: 'PRD-04', buyPrice: 1, sellPrice: 2, safety: 0, target: 0 })).status).toBe(422);
    // produk baru muncul di toko dengan stok 0
    const row = await stockOf(pengurus, depots[0].id, 'PRD-04');
    expect(row).toMatchObject({ physical: 0, sellPrice: 130000, active: true });
    const log = (await pengurus.get('/audit-log?limit=20')).body.rows;
    expect(log.some((r: any) => r.message.includes('Produk baru Produk D'))).toBe(true);
  });

  it('ubah harga tercatat; pesanan lama tetap memakai harga saat dibuat', async () => {
    const p = (await centralOf('PRD-04'));
    expect((await pusat.call('PATCH', `/central/products/${p.id}`, {})).status).toBe(422);
    const ok = await pusat.call('PATCH', `/central/products/${p.id}`, { sellPrice: 140000, name: 'Produk D isi' });
    expect(ok.status).toBe(200);
    expect(ok.body.sellPrice).toBe(140000);
    const log = (await pengurus.get('/audit-log?limit=20')).body.rows;
    expect(log.some((r: any) => r.message.includes('harga 130000 → 140000'))).toBe(true);
    // nonaktifkan produk; produk nonaktif tidak bisa dikirim
    expect((await pusat.call('PATCH', `/products/${p.id}/active`)).status).toBe(200);
    await pusat.post('/central/receipts', { productId: p.id, qty: 10 });
    const sh = await pusat.post('/central/shipments', { depotId: depots[0].id, items: [{ productId: p.id, qty: 1 }] });
    expect(sh.status).toBe(422);
    expect(sh.body.message).toContain('nonaktif');
    await pusat.call('PATCH', `/products/${p.id}/active`);
  });
});

describe('Pengurus: stok pusat → kirim ke toko', () => {
  let shipId = '', shipNo = '';
  const urat = () => prods.find((p) => p.sku === 'PRD-01')!;
  const halus = () => prods.find((p) => p.sku === 'PRD-02')!;

  it('stok pusat awal dari seed, barang masuk menambah dan tercatat di kartu stok pusat', async () => {
    expect((await centralOf('PRD-01')).central).toBe(60);
    const row = await centralOf('PRD-01');                                                 // rincian stok tiap toko ikut dikirim
    expect(Object.keys(row.byDepot).sort()).toEqual(depots.map((d: any) => d.id).sort());
    expect(row.byDepot[depots[0].id]).toEqual({ physical: expect.any(Number), inTransit: 0 });
    expect((await pusat.post('/central/receipts', { productId: urat().id, qty: 0 })).status).toBe(400);
    expect((await pusat.post('/central/receipts', { productId: urat().id, qty: 15, note: 'Dari pemasok CV Sumber Prima' })).status).toBe(201);
    expect((await centralOf('PRD-01')).central).toBe(75);
    const card = (await pusat.get(`/central/products/${urat().id}/movements`)).body;
    expect(card[0]).toMatchObject({ type: 'receipt', qty: 15, balanceAfter: 75 });
  });

  it('kirim ke toko: stok pusat berkurang, toko mendapat "dalam perjalanan", stok toko belum berubah', async () => {
    const before = await stockOf(pengurus, depots[0].id, 'PRD-01');
    const r = await pusat.post('/central/shipments', { depotId: depots[0].id, note: 'Kiriman pekan ini', items: [{ productId: urat().id, qty: 20 }, { productId: halus().id, qty: 10 }] });
    expect(r.status).toBe(201);
    shipId = r.body.id; shipNo = r.body.no;
    expect(shipNo).toMatch(/^KRM-\d{4}$/);
    expect((await centralOf('PRD-01'))).toMatchObject({ central: 55, onTheWay: 20 });
    const after = await stockOf(pengurus, depots[0].id, 'PRD-01');
    expect(after.physical).toBe(before.physical);
    expect(after.inTransit).toBe(before.inTransit + 20);
    // stok toko lain tidak tersentuh
    expect((await stockOf(pengurus, depots[1].id, 'PRD-01')).inTransit).toBe(0);
  });

  it('validasi: stok pusat kurang, toko tidak ada, produk ganda, daftar kosong', async () => {
    const big = await pusat.post('/central/shipments', { depotId: depots[0].id, items: [{ productId: urat().id, qty: 9999 }] });
    expect(big.status).toBe(422);
    expect(big.body.message).toContain('Stok pusat');
    expect((await centralOf('PRD-01')).central).toBe(55); // transaksi dibatalkan utuh
    expect((await pusat.post('/central/shipments', { depotId: '00000000-0000-4000-8000-000000000000', items: [{ productId: urat().id, qty: 1 }] })).status).toBe(422);
    expect((await pusat.post('/central/shipments', { depotId: depots[0].id, items: [{ productId: urat().id, qty: 1 }, { productId: urat().id, qty: 2 }] })).status).toBe(400);
    expect((await pusat.post('/central/shipments', { depotId: depots[0].id, items: [] })).status).toBe(400);
  });

  it('petugas toko hanya melihat dan menerima kiriman ke tokonya sendiri', async () => {
    const mine = (await petugas.get('/central/shipments')).body;
    expect(mine.map((s: any) => s.no)).toContain(shipNo);
    expect((await petugas2.get('/central/shipments')).body.map((s: any) => s.no)).not.toContain(shipNo);
    expect((await petugas2.post(`/central/shipments/${shipId}/receive`, {})).status).toBe(403);
    expect((await anggota.get('/central/shipments')).status).toBe(403);
  });

  it('terima kiriman: stok toko bertambah, perjalanan nol, kartu stok toko tercatat; tidak bisa dua kali', async () => {
    const before = await stockOf(petugas, depots[0].id, 'PRD-01');
    const r = await petugas.post(`/central/shipments/${shipId}/receive`, { note: 'Lengkap' });
    expect(r.status).toBe(201);
    const after = await stockOf(petugas, depots[0].id, 'PRD-01');
    expect(after.physical).toBe(before.physical + 20);
    expect(after.inTransit).toBe(before.inTransit - 20);
    const card = (await petugas.get(`/products/${urat().id}/movements?depotId=${depots[0].id}`)).body;
    expect(card[0]).toMatchObject({ type: 'transfer_in', qty: 20, refNo: shipNo });
    expect((await petugas.post(`/central/shipments/${shipId}/receive`, {})).status).toBe(422);
    expect((await pusat.post(`/central/shipments/${shipId}/cancel`, { reason: 'sudah diterima' })).status).toBe(422);
    expect((await centralOf('PRD-01')).onTheWay).toBe(0);
  });

  it('batalkan kiriman yang belum diterima: stok kembali ke pusat dan perjalanan toko dikurangi', async () => {
    const c0 = (await centralOf('PRD-03')).central;
    const t0 = (await stockOf(pengurus, depots[1].id, 'PRD-03')).inTransit;
    const p3 = prods.find((p) => p.sku === 'PRD-03')!;
    const r = await pusat.post('/central/shipments', { depotId: depots[1].id, items: [{ productId: p3.id, qty: 7 }] });
    expect((await centralOf('PRD-03')).central).toBe(c0 - 7);
    expect((await pusat.post(`/central/shipments/${r.body.id}/cancel`, { reason: 'x' })).status).toBe(400);
    expect((await petugas2.post(`/central/shipments/${r.body.id}/cancel`, { reason: 'bukan hak petugas' })).status).toBe(403);
    expect((await pusat.post(`/central/shipments/${r.body.id}/cancel`, { reason: 'Salah toko tujuan' })).status).toBe(201);
    expect((await centralOf('PRD-03')).central).toBe(c0);
    expect((await stockOf(pengurus, depots[1].id, 'PRD-03')).inTransit).toBe(t0);
    expect((await petugas2.post(`/central/shipments/${r.body.id}/receive`, {})).status).toBe(422);
    const hist = (await pusat.get('/central/shipments?status=cancelled')).body;
    expect(hist.find((s: any) => s.id === r.body.id)).toMatchObject({ status: 'cancelled', cancelReason: 'Salah toko tujuan' });
  });

  it('cek konsistensi (pengurus) tetap hijau, termasuk kartu stok pusat dan kiriman terbuka', async () => {
    // satu kiriman terbuka agar pemeriksaan "dalam perjalanan" benar-benar teruji
    await pusat.post('/central/shipments', { depotId: depots[1].id, items: [{ productId: urat().id, qty: 3 }] });
    const c = (await pengurus.get('/system/consistency')).body;
    expect(c.checks.map((x: any) => x.name)).toEqual(expect.arrayContaining(['Kartu stok pusat = stok gudang pusat', 'Dalam perjalanan di toko = kiriman pusat yang belum diterima']));
    expect(c.checks.filter((x: any) => !x.ok)).toEqual([]);
  });
});

describe('Petugas dibatasi ke pekerjaan toko', () => {
  it('petugas ditolak di data anggota, ringkasan keuangan, komisi, investor, wilayah, keuangan, log, konsistensi', async () => {
    for (const u of ['/members', '/members/network', '/overview', '/system/consistency', '/orders/commissions', '/investors/funding', '/profit-reports', '/regions', '/finance/summary', '/audit-log', '/commission-plan/history', '/central/stock']) expect((await petugas.get(u)).status, u).toBe(403);
    expect((await petugas.post('/members', { name: 'X' })).status).toBe(403);
    expect((await petugas.post('/regions', { level: 'province', parentId: null, name: 'Prov X' })).status).toBe(403);
  });

  it('petugas tetap bisa pekerjaan toko: stok, pesanan tokonya, PO, opname, kiriman, tugas toko', async () => {
    for (const u of ['/depots', '/products', '/orders', '/purchase-orders', '/suppliers', '/stock-counts', '/central/shipments', '/overview/depot-tasks', '/commission-plan']) expect((await petugas.get(u)).status, u).toBe(200);
    const t = (await petugas.get('/overview/depot-tasks')).body;
    expect(Object.keys(t.actions).sort()).toEqual(['awaitingApproval', 'draftPo', 'memberReports', 'paidNotShipped', 'pendingVerification', 'stockRequestsPending']);
    expect(t.tenant.depotName).toBe(depots[0].name);
    expect(JSON.stringify(t)).not.toMatch(/balance|salesValue|pendingCommission|memberBalance/i); // tanpa data keuangan
    expect((await petugas2.get('/overview/depot-tasks')).body.tenant.depotName).toBe(depots[1].name);
    expect((await anggota.get('/overview/depot-tasks')).status).toBe(403);
  });

  it('pengurus tetap mengakses semuanya', async () => {
    for (const u of ['/members', '/overview', '/system/consistency', '/orders/commissions', '/investors/funding', '/regions', '/finance/summary', '/audit-log', '/overview/depot-tasks']) expect((await pengurus.get(u)).status, u).toBe(200);
  });
});

describe('Permintaan stok: petugas meminta, pengurus kirim (penuh/sebagian) atau tolak', () => {
  const p = (sku: string) => prods.find((x) => x.sku === sku)!;
  const centralNow = async (sku: string) => (await pusat.get('/central/stock')).body.find((x: any) => x.sku === sku).central;
  let reqA = '', reqNoA = '';

  it('petugas membuat permintaan untuk tokonya; validasi produk/jumlah; pengurus melihat stok pusat, petugas tidak', async () => {
    expect((await petugas.post('/central/requests', { items: [] })).status).toBe(400);
    expect((await petugas.post('/central/requests', { items: [{ productId: p('PRD-01').id, qty: 0 }] })).status).toBe(400);
    expect((await petugas.post('/central/requests', { items: [{ productId: p('PRD-01').id, qty: 5 }, { productId: p('PRD-01').id, qty: 2 }] })).status).toBe(400);
    expect((await petugas.post('/central/requests', { depotId: depots[1].id, items: [{ productId: p('PRD-01').id, qty: 5 }] })).status).toBe(403); // toko lain
    expect((await anggota.post('/central/requests', { items: [{ productId: p('PRD-01').id, qty: 5 }] })).status).toBe(403);
    const r = await petugas.post('/central/requests', { note: 'Stok urat dan halus tinggal sedikit', items: [{ productId: p('PRD-01').id, qty: 30 }, { productId: p('PRD-02').id, qty: 10 }] });
    expect(r.status).toBe(201);
    expect(r.body.no).toMatch(/^REQ-\d{4}$/);
    reqA = r.body.id; reqNoA = r.body.no;
    const mine = (await petugas.get('/central/requests')).body.find((x: any) => x.id === reqA);
    expect(mine).toMatchObject({ status: 'pending', depotName: depots[0].name, totalQty: 40, totalSent: 0 });
    expect(mine.lines[0].central).toBeUndefined();                                           // petugas tidak melihat stok pusat
    expect((await petugas2.get('/central/requests')).body.map((x: any) => x.id)).not.toContain(reqA);
    const adm = (await pengurus.get('/central/requests?status=pending')).body.find((x: any) => x.id === reqA);
    expect(adm.lines.map((l: any) => [l.sku, l.qty, typeof l.central])).toEqual([['PRD-01', 30, 'number'], ['PRD-02', 10, 'number']]);
    expect((await pengurus.get('/overview')).body.actions.stockRequests).toBeGreaterThan(0);
    expect((await petugas.get('/overview/depot-tasks')).body.actions.stockRequestsPending).toBeGreaterThan(0);
  });

  it('hanya pengurus yang memproses; kirim sebagian: jumlah ≤ diminta, ≥1 produk; membuat kiriman dan menurunkan stok pusat', async () => {
    await pusat.post('/central/receipts', { productId: p('PRD-01').id, qty: 25 });
    await pusat.post('/central/receipts', { productId: p('PRD-02').id, qty: 50 });
    const c1 = await centralNow('PRD-01'), c2 = await centralNow('PRD-02');
    expect((await petugas.post(`/central/requests/${reqA}/fulfill`, { items: [{ productId: p('PRD-01').id, qty: 1 }] })).status).toBe(403);
    expect((await pusat.post(`/central/requests/${reqA}/fulfill`, { items: [{ productId: p('PRD-01').id, qty: 31 }] })).status).toBe(422);   // melebihi diminta
    expect((await pusat.post(`/central/requests/${reqA}/fulfill`, { items: [{ productId: p('PRD-01').id, qty: 0 }] })).status).toBe(422);    // tidak ada yang dikirim
    expect((await pusat.post(`/central/requests/${reqA}/fulfill`, { items: [{ productId: p('PRD-03').id, qty: 1 }] })).status).toBe(422);    // bukan produk di permintaan
    const ok = await pusat.post(`/central/requests/${reqA}/fulfill`, { note: 'Urat hanya 25', items: [{ productId: p('PRD-01').id, qty: 25 }, { productId: p('PRD-02').id, qty: 10 }] }); // urat dikirim 25 dari 30 diminta (sebagian)
    expect(ok.status).toBe(201);
    expect(ok.body.shipmentNo).toMatch(/^KRM-\d{4}$/);
    expect(await centralNow('PRD-01')).toBe(c1 - 25); expect(await centralNow('PRD-02')).toBe(c2 - 10);
    const done = (await pengurus.get('/central/requests')).body.find((x: any) => x.id === reqA);
    expect(done).toMatchObject({ status: 'sent', totalQty: 40, totalSent: 35, shipmentNo: ok.body.shipmentNo, shipmentStatus: 'in_transit', decisionNote: 'Urat hanya 25' });
    expect(done.lines.find((l: any) => l.sku === 'PRD-01')).toMatchObject({ qty: 30, qtySent: 25 });
    // tidak bisa diproses dua kali / ditolak / dibatalkan setelah diproses
    expect((await pusat.post(`/central/requests/${reqA}/fulfill`, { items: [{ productId: p('PRD-02').id, qty: 1 }] })).status).toBe(422);
    expect((await pusat.post(`/central/requests/${reqA}/reject`, { reason: 'sudah dikirim' })).status).toBe(422);
    expect((await petugas.post(`/central/requests/${reqA}/cancel`)).status).toBe(422);
    // kiriman muncul di toko peminta; petugas menerima → stok toko bertambah
    const sh = (await petugas.get('/central/shipments?status=in_transit')).body.find((s: any) => s.no === ok.body.shipmentNo);
    expect(sh.note).toContain(reqNoA);
    expect(sh.request).toMatchObject({ no: reqNoA });                                          // toko melihat apa yang diminta vs dikirim
    expect(sh.request.lines.find((l: any) => l.productId === p('PRD-01').id)).toMatchObject({ qty: 30, qtySent: 25 });
    const before = (await petugas.get(`/products?depotId=${depots[0].id}`)).body.find((x: any) => x.sku === 'PRD-02').physical;
    expect((await petugas.post(`/central/shipments/${sh.id}/receive`, {})).status).toBe(201);
    expect((await petugas.get(`/products?depotId=${depots[0].id}`)).body.find((x: any) => x.sku === 'PRD-02').physical).toBe(before + 10);
    expect((await pengurus.get('/system/consistency')).body.ok).toBe(true);
  });

  it('tolak (alasan wajib; hanya pengurus) dan batal oleh peminta (hanya toko sendiri)', async () => {
    const mk = async (c: Client) => (await c.post('/central/requests', { items: [{ productId: p('PRD-03').id, qty: 4 }] })).body.id as string;
    const a = await mk(petugas);
    expect((await pusat.post(`/central/requests/${a}/reject`, { reason: 'x' })).status).toBe(400);
    expect((await petugas.post(`/central/requests/${a}/reject`, { reason: 'bukan hak petugas' })).status).toBe(403);
    const c3 = await centralNow('PRD-03');
    expect((await pusat.post(`/central/requests/${a}/reject`, { reason: 'Stok pusat habis, tunggu PO' })).status).toBe(201);
    expect(await centralNow('PRD-03')).toBe(c3);                                                 // tidak mengubah stok
    expect((await petugas.get('/central/requests')).body.find((x: any) => x.id === a)).toMatchObject({ status: 'rejected', decisionNote: 'Stok pusat habis, tunggu PO' });
    const b = await mk(petugas);
    expect((await petugas2.post(`/central/requests/${b}/cancel`)).status).toBe(403);             // toko lain
    expect((await petugas.post(`/central/requests/${b}/cancel`)).status).toBe(201);
    expect((await petugas.post(`/central/requests/${b}/cancel`)).status).toBe(422);
    expect((await pusat.post(`/central/requests/${b}/fulfill`, { items: [{ productId: p('PRD-03').id, qty: 1 }] })).status).toBe(422);
    const log = (await pengurus.get('/audit-log?limit=50')).body.rows.map((r: any) => r.message).join('\n');
    expect(log).toMatch(/Permintaan stok REQ-\d+ \(invoice INV-\d+\) dari/); expect(log).toMatch(/diproses → kiriman KRM-\d+; kurang:/); expect(log).toMatch(/ditolak: Stok pusat habis/);
  });
});

describe('Pengurus hanya baca untuk stok toko; petugas mengisi stok toko', () => {
  it('petugas mencatat barang masuk di tokonya (pengurus tidak boleh); kartu stok mencatatnya', async () => {
    const before = (await petugas.get(`/products?depotId=${depots[0].id}`)).body.find((x: any) => x.sku === 'PRD-01').physical;
    expect((await petugas.post(`/products/${prods[0].id}/receipts`, { qty: 0 })).status).toBe(400);
    expect((await petugas.post(`/products/${prods[0].id}/receipts`, { qty: 3 })).status).toBe(201);
    expect((await petugas.get(`/products?depotId=${depots[0].id}`)).body.find((x: any) => x.sku === 'PRD-01').physical).toBe(before + 3);
    expect((await petugas.get(`/products/${prods[0].id}/movements`)).body[0]).toMatchObject({ type: 'receipt', qty: 3 });
    expect((await petugas.post(`/products/${prods[0].id}/receipts`, { depotId: depots[1].id, qty: 3 })).status).toBe(403);   // toko lain
    expect((await pengurus.post(`/products/${prods[0].id}/receipts`, { depotId: depots[0].id, qty: 3 })).status).toBe(403);
  });

  it('pengurus tidak menerima kiriman/PO, tidak membuat opname atau permintaan; produk hanya diubah pengurus', async () => {
    await pusat.post('/central/receipts', { productId: prods[1].id, qty: 2 });
    const sh = await pusat.post('/central/shipments', { depotId: depots[0].id, items: [{ productId: prods[1].id, qty: 1 }] });
    expect(sh.status).toBe(201);
    expect((await pengurus.post(`/central/shipments/${sh.body.id}/receive`, {})).status).toBe(403);
    expect((await petugas.post(`/central/shipments/${sh.body.id}/receive`, {})).status).toBe(201);
    expect((await pengurus.post('/central/requests', { depotId: depots[0].id, items: [{ productId: prods[0].id, qty: 3 }] })).status).toBe(403);
    expect((await pengurus.post('/stock-counts', { depotId: depots[0].id })).status).toBe(403);
    expect((await pengurus.post('/purchase-orders/00000000-0000-4000-8000-000000000000/receive', { accepted: 1, rejected: 0 })).status).toBe(403);
    expect((await petugas.call('PATCH', `/products/${prods[0].id}/active`)).status).toBe(403);   // master produk: pengurus
    expect((await pengurus.call('PATCH', `/products/${prods[0].id}/active`)).status).toBe(200);
    expect((await pengurus.call('PATCH', `/products/${prods[0].id}/active`)).status).toBe(200);
  });
});

describe('Pemeriksaan kiriman di toko (diterima sesuai atau tidak)', () => {
  const pd = (sku: string) => prods.find((x) => x.sku === sku)!;
  const depotStockOf = async (sku: string) => (await petugas.get(`/products?depotId=${depots[0].id}`)).body.find((x: any) => x.sku === sku);
  const mkShip = async () => {
    await pusat.post('/central/receipts', { productId: pd('PRD-01').id, qty: 20 });
    await pusat.post('/central/receipts', { productId: pd('PRD-02').id, qty: 20 });
    const r = await pusat.post('/central/shipments', { depotId: depots[0].id, items: [{ productId: pd('PRD-01').id, qty: 10 }, { productId: pd('PRD-02').id, qty: 6 }] });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };

  it('selisih wajib beralasan; tidak boleh melebihi dikirim; produk di luar kiriman ditolak', async () => {
    const id = await mkShip();
    const A = pd('PRD-01').id, B = pd('PRD-02').id;
    const r1 = await petugas.post(`/central/shipments/${id}/receive`, { items: [{ productId: A, qty: 8 }, { productId: B, qty: 6 }] });
    expect(r1.status).toBe(422); expect(r1.body.message).toMatch(/Pilih alasan selisihnya/);
    expect((await petugas.post(`/central/shipments/${id}/receive`, { items: [{ productId: A, qty: 8, issue: 'lainnya' }, { productId: B, qty: 6 }] })).body.message).toMatch(/perlu dijelaskan/);
    expect((await petugas.post(`/central/shipments/${id}/receive`, { items: [{ productId: A, qty: 11 }, { productId: B, qty: 6 }] })).body.message).toMatch(/Jelaskan kelebihannya/);
    expect((await petugas.post(`/central/shipments/${id}/receive`, { items: [{ productId: A, qty: 8, issue: 'lebih' }, { productId: B, qty: 6 }] })).body.message).toMatch(/hanya untuk jumlah yang melebihi/);
    expect((await petugas.post(`/central/shipments/${id}/receive`, { items: [{ productId: pd('PRD-03').id, qty: 1 }] })).status).toBe(422);
    expect((await petugas.post(`/central/shipments/${id}/receive`, { items: [{ productId: A, qty: 1, issue: 'bukan-alasan' }] })).status).toBe(400);
    // semua penolakan tidak mengubah apa pun: kiriman masih di perjalanan
    expect((await petugas.get('/central/shipments?status=in_transit')).body.some((s: any) => s.id === id)).toBe(true);
    // diterima sesuai kiriman (items kosong atau lengkap)
    const a0 = (await depotStockOf('PRD-01')).physical, b0 = (await depotStockOf('PRD-02')).physical;
    expect((await petugas.post(`/central/shipments/${id}/receive`, { items: [{ productId: A, qty: 10 }, { productId: B, qty: 6 }] })).status).toBe(201);
    expect((await depotStockOf('PRD-01')).physical).toBe(a0 + 10); expect((await depotStockOf('PRD-02')).physical).toBe(b0 + 6);
    const done = (await pusat.get('/central/shipments?status=received')).body.find((s: any) => s.id === id);
    expect(done.hasIssue).toBe(false);
  });

  it('diterima dengan selisih: stok toko bertambah sebesar yang diterima, perjalanan nol, selisih tercatat dan terlihat pengurus', async () => {
    const id = await mkShip();
    const A = pd('PRD-01').id, B = pd('PRD-02').id;
    const a0 = await depotStockOf('PRD-01'), b0 = await depotStockOf('PRD-02');
    const r = await petugas.post(`/central/shipments/${id}/receive`, { note: 'Dus penyok', items: [{ productId: A, qty: 7, issue: 'rusak', note: '3 pak basah' }, { productId: B, qty: 0, issue: 'salah_kirim', note: 'yang datang produk lain' }] });
    expect(r.status).toBe(201);
    const a1 = await depotStockOf('PRD-01'), b1 = await depotStockOf('PRD-02');
    expect(a1.physical).toBe(a0.physical + 7); expect(a1.inTransit).toBe(a0.inTransit - 10);
    expect(b1.physical).toBe(b0.physical); expect(b1.inTransit).toBe(b0.inTransit - 6);       // 0 diterima: perjalanan tetap dibersihkan
    const sh = (await pengurus.get('/central/shipments?status=received')).body.find((s: any) => s.id === id);
    expect(sh.hasIssue).toBe(true);
    expect(sh.lines.find((l: any) => l.sku === 'PRD-01')).toMatchObject({ qty: 10, qtyReceived: 7, issue: 'rusak', issueNote: '3 pak basah' });
    expect(sh.lines.find((l: any) => l.sku === 'PRD-02')).toMatchObject({ qty: 6, qtyReceived: 0, issue: 'salah_kirim' });
    const card = (await petugas.get(`/products/${A}/movements`)).body[0];
    expect(card).toMatchObject({ type: 'transfer_in', qty: 7 }); expect(card.note).toMatch(/sebagian \(7 dari 10\)/);
    const log = (await pengurus.get('/audit-log?limit=10')).body.rows.map((x: any) => x.message).join('\n');
    expect(log).toMatch(/SELISIH: .*Produk A 7\/10 \(Rusak/);
    expect((await pengurus.get('/system/consistency')).body.ok).toBe(true);
  });

  it('barang diterima LEBIH dari yang dikirim: boleh, wajib dijelaskan; stok toko bertambah sebesar yang diterima dan ditandai selisih', async () => {
    const id = await mkShip();
    const A = pd('PRD-01').id, B = pd('PRD-02').id;
    const a0 = await depotStockOf('PRD-01'), b0 = await depotStockOf('PRD-02');
    const r = await petugas.post(`/central/shipments/${id}/receive`, { items: [{ productId: A, qty: 13, note: 'dus tambahan tanpa surat jalan' }, { productId: B, qty: 6 }] });
    expect(r.status).toBe(201);
    const a1 = await depotStockOf('PRD-01'), b1 = await depotStockOf('PRD-02');
    expect(a1.physical).toBe(a0.physical + 13); expect(a1.inTransit).toBe(a0.inTransit - 10);   // perjalanan hanya dikurangi sebesar yang dikirim
    expect(b1.physical).toBe(b0.physical + 6);
    const sh = (await pengurus.get('/central/shipments?status=received')).body.find((s: any) => s.id === id);
    expect(sh.hasIssue).toBe(true);
    expect(sh.lines.find((l: any) => l.sku === 'PRD-01')).toMatchObject({ qty: 10, qtyReceived: 13, issue: 'lebih', issueNote: 'dus tambahan tanpa surat jalan' });
    expect((await petugas.get(`/products/${A}/movements`)).body[0].note).toMatch(/diterima lebih \(13 dari 10 dikirim\)/);
    expect((await pengurus.get('/audit-log?limit=5')).body.rows.map((x: any) => x.message).join('\n')).toMatch(/SELISIH: .*Produk A 13\/10 \(Jumlah lebih dari yang dikirim: dus tambahan/);
    expect((await pengurus.get('/system/consistency')).body.ok).toBe(true);
  });
});
