import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client, as, boot } from './helpers';

let app: NestFastifyApplication;
let admin: Client, staff: Client, member: Client;
let depot: any, prod: any;

beforeAll(async () => {
  process.env.OPNAME_LOCK = 'on'; // tes lain mematikan penguncian; di sini justru yang diuji
  app = await boot();
  [admin, staff, member] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas'), as(app, 'nasional', 'anggota')]);
  depot = (await staff.get('/depots')).body[0];
  prod = (await staff.get('/products')).body.filter((p: any) => p.depotId === depot.id).sort((x: any, y: any) => y.physical - x.physical)[0];
});
afterAll(async () => { vi.useRealTimers(); process.env.OPNAME_LOCK = 'off'; await app.close(); });

/** Pindah jam ke tanggal `day` pukul 10:00 WIB, `monthsAhead` bulan dari bulan nyata sekarang, lalu login ulang (token berusia 12 jam). */
async function jumpTo(monthsAhead: number, day: number) {
  vi.useRealTimers();
  const now = new Date();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead, day, 3, 0, 0));
  [admin, staff, member] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas'), as(app, 'nasional', 'anggota')]);
}
const state = async () => (await staff.get('/overview/depot-tasks')).body.opname;
/** Pesanan anggota yang sudah disetujui (siap dikirim). */
async function approvedOrder() {
  const r = await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty: 1 }] });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect((await staff.post(`/orders/${r.body[0].id}/approve`)).status).toBe(201);
  return r.body[0].id as string;
}
/** Petugas menghitung seluruh produk sama dengan stok sistem lalu mengajukan opname. */
async function submitOpname() {
  const c = await staff.post('/stock-counts', {});
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const doc = (await staff.get(`/stock-counts/${c.body.id}`)).body;
  expect((await staff.call('PUT', `/stock-counts/${c.body.id}/lines`, { lines: doc.lines.map((l: any) => ({ lineId: l.id, countedQty: l.systemQty })) })).status).toBe(200);
  const r = await staff.post(`/stock-counts/${c.body.id}/submit`);
  if (r.status === 201) expect((await admin.post(`/stock-counts/${c.body.id}/approve`)).status).toBe(201); // pengurus menyetujui supaya opname berikutnya bisa dibuat
  return r;
}

describe('Stok opname wajib tiap akhir bulan: terlewat → transaksi toko dikunci', () => {
  let shipId = '';

  it('bulan berjalan belum waktunya: toko tidak dikunci', async () => {
    expect(['ok', 'due']).toContain((await state()).state);
    shipId = await approvedOrder(); // dipakai nanti untuk menguji pengiriman saat terkunci
    expect((await staff.post(`/orders/${shipId}/ship`, { deliveryRef: 'SJ-ADA' })).status).toBe(201);
  });

  it('dua bulan kemudian tanpa opname: toko terkunci — pesanan, pengiriman, penerimaan, dan stok masuk ditolak; pengurus melihat tokonya', async () => {
    const pending = await approvedOrder();            // disetujui sebelum terkunci
    await jumpTo(2, 2);
    const s = await state();
    expect(s).toMatchObject({ state: 'locked', dueDate: expect.any(String) });
    const tasks = (await admin.get('/overview/depot-tasks')).body;
    expect(tasks.opnameLocked).toEqual(expect.arrayContaining([expect.objectContaining({ name: depot.name })]));

    const blocked = (r: any) => { expect(r.status).toBe(422); expect(r.body.message).toMatch(/stok opname bulan .* belum diajukan/); };
    blocked(await staff.post(`/orders/${pending}/ship`, { deliveryRef: 'SJ-X' }));
    blocked(await staff.post(`/orders/${shipId}/pay-balance`));                                  // pembayaran/aksi pesanan lain
    blocked(await staff.post('/orders', { sellerId: (await admin.get('/members')).body[0].id, customerName: 'Ibu Ani', items: [{ productId: prod.id, qty: 1 }] }));
    const m = await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty: 1 }] });
    expect(m.status).toBe(422); expect(m.body.message).toMatch(/Toko ini sementara belum dapat melayani pesanan/); // anggota tidak diberi detail internal
    // membatalkan pesanan tetap boleh agar reservasi bisa dilepas
    expect((await staff.post(`/orders/${pending}/cancel`, { reason: 'toko dikunci' })).status).toBe(201);
  });

  it('opname boleh kapan saja; setelah diajukan toko terbuka lagi', async () => {
    expect((await state()).state).toBe('locked');
    expect((await submitOpname()).status).toBe(201);
    expect((await state()).state).toBe('ok');
    const id = await approvedOrder();
    expect((await staff.post(`/orders/${id}/ship`, { deliveryRef: 'SJ-BARU' })).status).toBe(201);
    expect((await admin.get('/overview/depot-tasks')).body.opnameLocked.map((x: any) => x.name)).not.toContain(depot.name);
  });

  it('mendekati akhir bulan: peringatan "due" (belum dikunci) sampai opname bulan itu diajukan', async () => {
    await jumpTo(2, 27);                              // opname diajukan tanggal 2, jendela bulan ini baru mulai ±24
    const s = await state();
    expect(s).toMatchObject({ state: 'due', daysLeft: expect.any(Number) });
    expect(s.daysLeft).toBeGreaterThanOrEqual(1); expect(s.daysLeft).toBeLessThanOrEqual(7);
    const id = await approvedOrder();                 // masih bisa bertransaksi
    expect((await staff.post(`/orders/${id}/ship`, { deliveryRef: 'SJ-DUE' })).status).toBe(201);
    expect((await submitOpname()).status).toBe(201);  // opname akhir bulan
    expect((await state()).state).toBe('ok');
  });

  it('bulan berikutnya terlewat tanpa opname: dikunci lagi; opname yang diajukan di jendela akhir bulan sebelumnya mencukupi bila ada', async () => {
    await jumpTo(3, 2);                               // opname akhir bulan ke-2 diajukan tanggal 27 → cukup untuk bulan itu
    expect((await state()).state).toBe('ok');
    await jumpTo(4, 2);                               // bulan ke-3 terlewat tanpa opname
    expect((await state()).state).toBe('locked');
  });
});
