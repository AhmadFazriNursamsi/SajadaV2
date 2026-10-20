import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, undoOrder } from './helpers';

let app: NestFastifyApplication;
let admin: Client, staff: Client, member: Client;
let depot: any, prods: any[];

beforeAll(async () => {
  app = await boot();
  [admin, staff, member] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas'), as(app, 'nasional', 'anggota')]);
  depot = (await admin.get('/depots')).body[0];
  prods = (await admin.get('/products')).body;
});
afterAll(() => app.close());

const rowsOf = async (groupNo: string) => (await staff.get('/orders')).body.filter((o: any) => o.groupNo === groupNo);

describe('satu checkout dengan banyak produk = satu pesanan', () => {
  let groupNo = '', ids: string[] = [], total = 0;

  it('3 produk dalam satu pesanan: satu nomor, satu grup, satu nomor urut terpakai', async () => {
    const before = (await staff.get('/orders')).body.length;
    const r = await member.post('/me/orders', { depotId: depot.id, items: prods.slice(0, 3).map((p) => ({ productId: p.id, qty: 1 })) });
    expect(r.status).toBe(201);
    expect(r.body).toHaveLength(3);
    groupNo = r.body[0].groupNo; ids = r.body.map((o: any) => o.id);
    expect(new Set(r.body.map((o: any) => o.groupId)).size).toBe(1);
    expect(r.body.map((o: any) => o.groupNo)).toEqual([groupNo, groupNo, groupNo]);
    expect(r.body.map((o: any) => o.no)).toEqual([`${groupNo}-1`, `${groupNo}-2`, `${groupNo}-3`]);
    expect(r.body.map((o: any) => o.lineNo)).toEqual([1, 2, 3]);
    expect((await staff.get('/orders')).body.length).toBe(before + 3);
    total = r.body.reduce((s: number, o: any) => s + o.qty * o.price, 0);
    // pesanan satu produk memakai nomor polos
    const one = await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prods[0].id, qty: 1 }] });
    expect(one.body[0].no).toBe(one.body[0].groupNo);
    await staff.post(`/orders/${one.body[0].id}/reject`, { reason: 'bersih uji' });
  });

  it('ringkasan dan jumlah menghitung pesanan, bukan baris produk', async () => {
    const t = (await staff.get('/overview/depot-tasks')).body.actions;
    const pending = (await staff.get('/orders')).body.filter((o: any) => o.status === 'awaiting_approval');
    expect(t.awaitingApproval).toBe(new Set(pending.map((o: any) => o.groupId)).size);
    expect(pending.filter((o: any) => o.groupNo === groupNo)).toHaveLength(3);
    const d = (await admin.get('/depots')).body.find((x: any) => x.id === depot.id);
    expect(d.awaitingApproval).toBe(t.awaitingApproval);
  });

  it('disetujui sekali: saldo terpotong sebesar total semua produk, ketiga baris berstatus sama', async () => {
    const bal0 = (await member.get('/me')).body.balance;
    expect((await staff.post(`/orders/${ids[1]}/approve`)).status).toBe(201);          // lewat baris mana pun
    expect((await member.get('/me')).body.balance).toBe(bal0 - total);                  // dipotong sekali
    const rows = await rowsOf(groupNo);
    expect(rows.map((o: any) => [o.status, o.pay])).toEqual([['paid', 'balance'], ['paid', 'balance'], ['paid', 'balance']]);
    expect((await staff.post(`/orders/${ids[0]}/approve`)).status).toBe(422);          // tidak bisa dua kali
    expect((await staff.post(`/orders/${ids[2]}/pay-balance`)).status).toBe(422);
  });

  it('kirim dan konfirmasi diterima berlaku untuk seluruh pesanan; stok berkurang per produk', async () => {
    const stock0 = Object.fromEntries((await staff.get('/products')).body.map((p: any) => [p.id, p.physical]));
    expect((await staff.post(`/orders/${ids[2]}/ship`, { deliveryRef: 'SJ-GRUP' })).status).toBe(201);
    const stock1 = Object.fromEntries((await staff.get('/products')).body.map((p: any) => [p.id, p.physical]));
    for (const p of prods.slice(0, 3)) expect(stock1[p.id]).toBe(stock0[p.id] - 1);
    expect((await rowsOf(groupNo)).every((o: any) => o.status === 'shipped' && o.deliveryRef === 'SJ-GRUP')).toBe(true);
    expect((await staff.post(`/orders/${ids[0]}/ship`, { deliveryRef: 'SJ-2' })).status).toBe(422);
    expect((await staff.post(`/orders/${ids[0]}/receive`, { proofRef: 'BKT-GRUP', receiverName: 'Penerima' })).status).toBe(201);
    expect((await rowsOf(groupNo)).every((o: any) => o.status === 'received')).toBe(true);
  });

  it('anggota melihat satu pesanan dengan tiga baris; tidak ada fitur retur lagi', async () => {
    const mine = (await member.get('/me/orders')).body.orders.filter((o: any) => o.groupNo === groupNo);
    expect(mine).toHaveLength(3);
    expect(new Set(mine.map((o: any) => o.groupId)).size).toBe(1);
    expect(mine[0]).not.toHaveProperty('canRequestReturn');
    // data untuk layar Detail pesanan: harga satuan, waktu/penyetuju, pembayaran, pengiriman, penerimaan
    expect(mine[0]).toMatchObject({ pay: 'balance', shipped: true, received: true, deliveryRef: 'SJ-GRUP', receiverName: 'Penerima', proofRef: 'BKT-GRUP' });
    expect(mine[0].price).toBeGreaterThan(0); expect(mine[0].approvedBy).toMatch(/^Petugas/); expect(mine[0].approvedAt).toBeTruthy(); expect(mine[0].receivedAt).toBeTruthy();
    expect((await member.post(`/me/orders/${ids[0]}/return-request`, { reason: 'ingin retur' })).status).toBe(404);   // fitur retur dihapus
    expect((await staff.post(`/orders/${ids[1]}/return`, { reason: 'ingin retur', restock: true })).status).toBe(404);
    expect((await staff.get('/overview/depot-tasks')).body.actions).not.toHaveProperty('returnRequests');
    await undoOrder(app, ids[0]);                                                                                  // bersihkan keadaan uji
    expect((await admin.get('/system/consistency')).body.ok).toBe(true);
  });

  it('batal sebelum kirim mengembalikan saldo semua produk; saldo tidak cukup menolak seluruh persetujuan', async () => {
    const bal0 = (await member.get('/me')).body.balance;
    const r = await member.post('/me/orders', { depotId: depot.id, items: prods.slice(0, 2).map((p) => ({ productId: p.id, qty: 1 })) });
    const t2 = r.body.reduce((s: number, o: any) => s + o.qty * o.price, 0);
    await staff.post(`/orders/${r.body[0].id}/approve`);
    expect((await member.get('/me')).body.balance).toBe(bal0 - t2);
    expect((await staff.post(`/orders/${r.body[1].id}/cancel`, { reason: 'dibatalkan grup' })).status).toBe(201);
    expect((await member.get('/me')).body.balance).toBe(bal0);
    expect((await rowsOf(r.body[0].groupNo)).every((o: any) => o.status === 'cancelled')).toBe(true);
  });

  it('penjualan ke pelanggan umum: saldo anggota penjual terpotong saat disetujui (total semua produk), pelanggan bayar tunai ke anggota', async () => {
    const bal0 = (await member.get('/me')).body.balance;
    const r = await member.post('/me/sales', { depotId: depot.id, customerName: 'Ibu Tunai', items: prods.slice(0, 2).map((p) => ({ productId: p.id, qty: 1 })) });
    expect(r.status).toBe(201);
    const id = r.body[0].id, gno = r.body[0].groupNo;
    const total = r.body.reduce((s: number, o: any) => s + o.total, 0);
    expect((await staff.post(`/orders/${id}/ship`, { deliveryRef: 'SJ-X' })).status).toBe(422);                       // belum disetujui/dibayar
    expect((await staff.post(`/orders/${id}/approve`)).status).toBe(201);
    expect((await member.get('/me')).body.balance).toBe(bal0 - total);                                                  // dipotong dari saldo penjual
    expect((await rowsOf(gno)).every((o: any) => o.status === 'paid' && o.pay === 'balance' && o.buyerId === null)).toBe(true);
    expect((await staff.post(`/orders/${id}/pay-balance`)).status).toBe(422);
    expect((await staff.post(`/orders/${id}/ship`, { deliveryRef: 'SJ-X' })).status).toBe(201);
    expect((await staff.post(`/orders/${id}/receive`, { proofRef: 'BKT-X', receiverName: 'Ibu Tunai' })).status).toBe(201);
    await undoOrder(app, id);
    expect((await member.get('/me')).body.balance).toBe(bal0);                                                          // pembersih tes mengembalikan saldo penjual
  });

  it('penjualan ditolak persetujuannya bila saldo anggota penjual tidak cukup/aktif', async () => {
    const village = (await admin.get('/regions')).body.find((r: any) => r.level === 'village');
    const created = await admin.post('/members', { name: 'Penjual Tanpa Saldo', villageId: village.id, familyCode: 'L', createAccount: true });
    const acc = new Client(app);
    const lg = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: created.body.account.username, password: created.body.account.password } });
    acc.token = lg.json().token;
    await acc.post('/auth/change-password', { current: created.body.account.password, next: 'Baru12345' });
    const r = await acc.post('/me/sales', { depotId: depot.id, customerName: 'Pak Umum', items: [{ productId: prods[0].id, qty: 1 }] });
    const blocked = await staff.post(`/orders/${r.body[0].id}/approve`);
    expect(blocked.status).toBe(422); expect(blocked.body.message).toMatch(/belum aktif/);
    expect((await rowsOf(r.body[0].groupNo))[0].status).toBe('awaiting_approval');
    expect((await staff.post(`/orders/${r.body[0].id}/reject`, { reason: 'saldo belum aktif' })).status).toBe(201);
  });

});

describe('anggota memeriksa barang yang dikirim; laporkan ke toko bila tidak sesuai', () => {
  const mk = async (n = 2) => {
    const r = await member.post('/me/orders', { depotId: depot.id, items: prods.slice(0, n).map((p) => ({ productId: p.id, qty: 1 })) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await staff.post(`/orders/${r.body[0].id}/approve`);
    return r.body;
  };

  it('belum dikirim: tidak bisa diperiksa; setelah dikirim anggota boleh memeriksa (canCheck)', async () => {
    const o = await mk();
    expect((await member.post(`/me/orders/${o[0].id}/check`, {})).status).toBe(422);
    let mine = (await member.get('/me/orders')).body.orders.find((x: any) => x.id === o[0].id);
    expect(mine.canCheck).toBe(false);
    await staff.post(`/orders/${o[0].id}/ship`, { deliveryRef: 'SJ-CEK' });
    mine = (await member.get('/me/orders')).body.orders.find((x: any) => x.id === o[0].id);
    expect(mine).toMatchObject({ canCheck: true, report: null });
    expect((await staff.post(`/me/orders/${o[0].id}/check`, {})).status).toBe(403);       // hanya anggota
    expect((await rowsOf(o[0].groupNo)).every((x: any) => x.status === 'shipped')).toBe(true);   // belum ada konfirmasi: petugas masih bisa mengonfirmasi
  });

  it('semua sesuai: tercatat "ok" tanpa tindakan toko', async () => {
    const o = await mk();
    await staff.post(`/orders/${o[0].id}/ship`, { deliveryRef: 'SJ-OK' });
    const r = await member.post(`/me/orders/${o[0].id}/check`, {});
    expect(r.status).toBe(201); expect(r.body.status).toBe('ok');
    expect((await member.get('/me/orders')).body.orders.find((x: any) => x.id === o[0].id)).toMatchObject({ report: { status: 'ok' }, canCheck: false });
    expect((await member.post(`/me/orders/${o[0].id}/check`, {})).body.message).toMatch(/hanya bisa dilakukan sekali/);   // sekali saja
    // pemeriksaan anggota = konfirmasi diterima: petugas tidak perlu mengonfirmasi lagi
    expect((await rowsOf(o[0].groupNo)).every((x: any) => x.status === 'received' && x.proofRef === `CEK-${o[0].groupNo}`)).toBe(true);
    expect((await staff.post(`/orders/${o[0].id}/receive`, { proofRef: 'BKT-X', receiverName: 'X' })).status).toBe(422);
    expect((await staff.get('/orders')).body.find((x: any) => x.id === o[0].id).report.status).toBe('ok');
    expect((await staff.get('/overview/depot-tasks')).body.actions.memberReports).toBe(0);
  });

  it('tidak sesuai: wajib alasan, jumlah ≤ dipesan; laporan terbuka muncul di toko dan bisa ditanggapi', async () => {
    const o = await mk();
    await staff.post(`/orders/${o[0].id}/ship`, { deliveryRef: 'SJ-BAD' });
    const A = o[0].productId, B = o[1].productId;
    expect((await member.post(`/me/orders/${o[0].id}/check`, { items: [{ productId: A, qty: 0 }, { productId: B, qty: 1 }] })).body.message).toMatch(/Pilih alasan selisihnya/);
    expect((await member.post(`/me/orders/${o[0].id}/check`, { items: [{ productId: A, qty: 0, issue: 'lainnya' }, { productId: B, qty: 1 }] })).body.message).toMatch(/perlu dijelaskan/);
    expect((await member.post(`/me/orders/${o[0].id}/check`, { items: [{ productId: A, qty: 2 }, { productId: B, qty: 1 }] })).body.message).toMatch(/melebihi yang dipesan/);
    expect((await member.post(`/me/orders/${o[0].id}/check`, { items: [{ productId: crypto.randomUUID(), qty: 1 }] })).status).toBe(422);
    const r = await member.post(`/me/orders/${o[0].id}/check`, { note: 'Dus penyok', items: [{ productId: A, qty: 0, issue: 'rusak', note: '1 pak basah' }, { productId: B, qty: 1 }] });
    expect(r.status).toBe(201); expect(r.body.status).toBe('open');
    expect((await member.post(`/me/orders/${o[0].id}/check`, {})).body.message).toMatch(/sudah Anda laporkan/);     // sekali saja
    expect((await member.get('/me/orders')).body.orders.find((x: any) => x.id === o[0].id)).toMatchObject({ report: { status: 'open' }, canCheck: false });
    expect((await staff.get('/overview/depot-tasks')).body.actions.memberReports).toBeGreaterThan(0);
    const rep = (await staff.get(`/orders/${o[1].id}/report`)).body;                          // lewat baris mana pun
    expect(rep).toMatchObject({ status: 'open', note: 'Dus penyok', groupNo: o[0].groupNo });
    expect(rep.lines.find((l: any) => l.productId === A)).toMatchObject({ qtyOrdered: 1, qtyReceived: 0, issue: 'rusak', note: '1 pak basah' });
    expect((await admin.get('/audit-log?q=TIDAK SESUAI&limit=3')).body.rows[0].message).toMatch(/anggota melaporkan barang TIDAK SESUAI/);
    expect((await member.post(`/orders/${o[0].id}/report/resolve`, { note: 'x' })).status).toBe(403);
    expect((await staff.post(`/orders/${o[0].id}/report/resolve`, { note: 'x' })).status).toBe(400);
    expect((await staff.post(`/orders/${o[0].id}/report/resolve`, { note: 'Pengganti dikirim besok' })).status).toBe(201);
    expect((await staff.post(`/orders/${o[0].id}/report/resolve`, { note: 'lagi' })).status).toBe(422);
    const mine = (await member.get('/me/orders')).body.orders.find((x: any) => x.id === o[0].id);
    expect(mine).toMatchObject({ report: { status: 'resolved', resolution: 'Pengganti dikirim besok' }, canCheck: false });
    expect((await member.post(`/me/orders/${o[0].id}/check`, {})).body.message).toMatch(/hanya bisa dilakukan sekali/);   // tidak bisa diperiksa ulang
    expect((await rowsOf(o[0].groupNo)).every((x: any) => x.status === 'received')).toBe(true);                             // tetap tercatat diterima
  });

  it('bila petugas lebih dulu mengonfirmasi diterima, anggota tetap bisa memeriksa sekali (bukti terima petugas tidak tertimpa)', async () => {
    const o = await mk(1);
    await staff.post(`/orders/${o[0].id}/ship`, { deliveryRef: 'SJ-LD' });
    expect((await staff.post(`/orders/${o[0].id}/receive`, { proofRef: 'BKT-PETUGAS', receiverName: 'Bu Ani' })).status).toBe(201);
    expect((await member.post(`/me/orders/${o[0].id}/check`, {})).status).toBe(201);
    const row = (await rowsOf(o[0].groupNo))[0];
    expect(row).toMatchObject({ status: 'received', proofRef: 'BKT-PETUGAS', receiverName: 'Bu Ani' });
    expect((await member.post(`/me/orders/${o[0].id}/check`, {})).status).toBe(422);
  });
});
