import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, PHOTO, receiveViaMember } from './helpers';

let app: NestFastifyApplication;
let admin: Client, staff: Client, member: Client;
let depot: any, prod: any;

beforeAll(async () => {
  app = await boot();
  [admin, staff, member] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas'), as(app, 'nasional', 'anggota')]);
  depot = (await admin.get('/depots')).body[0];
  prod = (await admin.get('/products')).body[0];
});
afterAll(() => app.close());

const rewards = async () => (await member.get('/me/rewards')).body;

describe('Saldo penarikan: imbalan per produk dari belanja yang sudah diterima', () => {
  let earned = 0;

  it('belum bertambah saat dipesan, disetujui, atau dikirim; bertambah sesuai persen produk (bawaan 20%) saat diterima, sekali saja', async () => {
    const before = (await rewards()).balance;
    const placed = await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty: 2 }] });
    expect(placed.status).toBe(201);
    const id = placed.body[0].id, total = placed.body[0].total;
    await staff.post(`/orders/${id}/approve`);
    await staff.post(`/orders/${id}/ship`, { deliveryRef: 'SJ-REWARD-1' });
    expect((await rewards()).balance).toBe(before);
    expect((await receiveViaMember(member, staff, id)).status).toBe(201);
    earned = Math.floor(total * 0.2);
    const r = await rewards();
    expect(r.balance).toBe(before + earned - 30_000); // hari aktif pertama: tagihan harian Rp30.000 dipotong dari saldo penarikan
    expect(r.entries.find((e: any) => e.kind === 'earn')).toMatchObject({ amount: earned });
    expect(r.entries.find((e: any) => e.kind === 'installment')).toMatchObject({ amount: -30_000 });
    expect((await member.post(`/me/orders/${id}/check`, { photo: PHOTO })).status).toBe(422); // tidak bisa dua kali
    expect((await rewards()).balance).toBe(before + earned - 30_000);
    expect((await member.get('/me')).body.rewardBalance).toBe(before + earned - 30_000);
  });

  it('pembatalan sebelum kirim tidak memberi imbalan', async () => {
    const before = (await rewards()).balance;
    const placed = await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty: 1 }] });
    await staff.post(`/orders/${placed.body[0].id}/reject`, { reason: 'uji' });
    expect((await rewards()).balance).toBe(before);
  });

  it('pindah ke saldo belanja: jumlah dibatasi saldo, saldo belanja bertambah', async () => {
    const r0 = (await rewards()).balance, b0 = (await member.get('/me')).body.balance;
    expect((await member.post('/me/rewards/transfer', { amount: r0 + 1 })).status).toBe(422);
    expect((await member.post('/me/rewards/transfer', { amount: 0 })).status).toBe(400);
    const ok = await member.post('/me/rewards/transfer', { amount: 1000 });
    expect(ok.status).toBe(201);
    expect((await rewards()).balance).toBe(r0 - 1000);
    expect((await member.get('/me')).body.balance).toBe(b0 + 1000);
  });

  it('penarikan: saldo ditahan, pengurus bayar atau tolak (ditolak = saldo kembali), hak akses dijaga', async () => {
    // tambah saldo lewat belanja diterima (cukup untuk dua penarikan minimal)
    const placed = await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty: 4 }] });
    const oid = placed.body[0].id;
    await staff.post(`/orders/${oid}/approve`); await staff.post(`/orders/${oid}/ship`, { deliveryRef: 'SJ-REWARD-W' }); await receiveViaMember(member, staff, oid);
    const r0 = (await rewards()).balance;
    const bad = { amount: 1000, bank: 'BCA', accountNo: '12ab', accountName: 'Siti' };
    expect((await member.post('/me/withdrawals', bad)).status).toBe(400);
    const small = await member.post('/me/withdrawals', { ...bad, accountNo: '1234567890', amount: 19_999 });
    expect(small.status).toBe(400); expect(JSON.stringify(small.body)).toMatch(/minimal Rp20\.000/);
    expect((await member.post('/me/withdrawals', { ...bad, accountNo: '1234567890', amount: r0 + 1 })).status).toBe(422);
    const a = await member.post('/me/withdrawals', { amount: 20_000, bank: 'BCA', accountNo: '1234567890', accountName: 'Siti Rahma' });
    expect(a.status).toBe(201);
    expect((await rewards()).balance).toBe(r0 - 20_000);
    const b = await member.post('/me/withdrawals', { amount: 20_000, bank: 'BRI', accountNo: '9876543210', accountName: 'Siti Rahma' });
    expect((await rewards()).balance).toBe(r0 - 40_000);

    expect((await member.get('/withdrawals')).status).toBe(403);
    expect((await staff.post(`/withdrawals/${a.body.id}/pay`)).status).toBe(403);
    expect((await staff.get('/me/rewards')).status).toBe(403);
    const list = (await admin.get('/withdrawals')).body;
    expect(list.find((w: any) => w.id === a.body.id)).toMatchObject({ status: 'pending', amount: 20_000, bank: 'BCA', memberName: expect.any(String) });

    expect((await admin.post(`/withdrawals/${a.body.id}/pay`)).status).toBe(201);
    expect((await admin.post(`/withdrawals/${a.body.id}/pay`)).status).toBe(422); // sudah diputuskan
    expect((await admin.post(`/withdrawals/${b.body.id}/reject`, { reason: '' })).status).toBe(400);
    expect((await admin.post(`/withdrawals/${b.body.id}/reject`, { reason: 'Nomor rekening salah' })).status).toBe(201);
    const after = await rewards();
    expect(after.balance).toBe(r0 - 20_000); // yang ditolak dikembalikan, yang dibayar tetap keluar
    expect(after.withdrawals.find((w: any) => w.id === a.body.id).status).toBe('paid');
    expect(after.withdrawals.find((w: any) => w.id === b.body.id)).toMatchObject({ status: 'rejected', reason: 'Nomor rekening salah' });
    expect(after.entries.some((e: any) => e.kind === 'refund' && e.amount === 20_000)).toBe(true);
  });

  it('ringkasan imbalan untuk pengurus: saldo beredar, imbalan per pesanan, saldo per anggota; anggota ditolak', async () => {
    expect((await member.get('/rewards/summary')).status).toBe(403);
    const r = (await admin.get('/rewards/summary')).body;
    expect(r.kpis.rewardEarned).toBeGreaterThan(0);
    expect(r.kpis.rewardBalance).toBe((await rewards()).balance);
    expect(r.kpis.rewardBalance).toBeLessThanOrEqual(r.kpis.rewardEarned);
    expect(r.orders[0]).toMatchObject({ reward: expect.any(Number), memberName: expect.any(String) });
    expect(r.orders.reduce((n: number, o: any) => n + o.reward, 0)).toBe(r.kpis.rewardEarned);
    expect(r.members.some((m: any) => m.rewardBalance > 0)).toBe(true);
    const ov = (await admin.get('/overview')).body;
    expect(ov.actions).toHaveProperty('withdrawalsPending');
    expect(ov.kpis.rewardBalance).toBe(r.kpis.rewardBalance);
  });
});

describe('Persen imbalan per produk', () => {
  const receive = async (items: { productId: string; qty: number }[], tag: string) => {
    const placed = await member.post('/me/orders', { depotId: depot.id, items });
    expect(placed.status).toBe(201);
    const id = placed.body[0].id;
    await staff.post(`/orders/${id}/approve`);
    await staff.post(`/orders/${id}/ship`, { deliveryRef: `SJ-${tag}` });
    expect((await receiveViaMember(member, staff, id)).status).toBe(201);
    return placed.body as { productId: string; total: number }[];
  };
  const lastEarn = async () => (await rewards()).entries.find((e: any) => e.kind === 'earn').amount;

  it('hanya admin yang mengatur; harus bilangan bulat 0–100; tercatat di audit', async () => {
    expect(prod.rewardPercent).toBe(20); // produk lama tetap 20%
    expect((await member.call('PATCH', `/central/products/${prod.id}`, { rewardPercent: 5 })).status).toBe(403);
    expect((await admin.call('PATCH', `/central/products/${prod.id}`, { rewardPercent: -1 })).status).toBe(400);
    expect((await admin.call('PATCH', `/central/products/${prod.id}`, { rewardPercent: 101 })).status).toBe(400);
    expect((await admin.call('PATCH', `/central/products/${prod.id}`, { rewardPercent: 12.5 })).status).toBe(400);
    expect((await admin.call('PATCH', `/central/products/${prod.id}`, { rewardPercent: 10 })).status).toBe(200);
    expect((await admin.get('/products')).body.find((p: any) => p.id === prod.id).rewardPercent).toBe(10);
  });

  it('imbalan dihitung per produk, tiap baris dibulatkan ke bawah, 0% tidak memberi apa pun', async () => {
    const products = (await admin.get('/products')).body.filter((p: any) => p.depotId === depot.id);
    const other = products.find((p: any) => p.id !== prod.id);
    expect((await admin.call('PATCH', `/central/products/${other.id}`, { rewardPercent: 0 })).status).toBe(200);
    const lines = await receive([{ productId: prod.id, qty: 1 }, { productId: other.id, qty: 1 }], 'PP-1');
    const a = lines.find((l) => l.productId === prod.id)!;
    expect(await lastEarn()).toBe(Math.floor(a.total * 0.1)); // 10% untuk produk pertama, 0% untuk produk kedua
    expect((await admin.call('PATCH', `/central/products/${other.id}`, { rewardPercent: 33 })).status).toBe(200);
    const lines2 = await receive([{ productId: prod.id, qty: 1 }, { productId: other.id, qty: 1 }], 'PP-2');
    const expected = lines2.reduce((n, l) => n + Math.floor((l.total * (l.productId === prod.id ? 10 : 33)) / 100), 0);
    expect(await lastEarn()).toBe(expected);
  });

  it('perubahan persen tidak mengubah imbalan pesanan yang sudah dikreditkan', async () => {
    const before = await lastEarn();
    expect((await admin.call('PATCH', `/central/products/${prod.id}`, { rewardPercent: 50 })).status).toBe(200);
    expect(await lastEarn()).toBe(before);
    await admin.call('PATCH', `/central/products/${prod.id}`, { rewardPercent: 20 }); // kembalikan
  });
});
