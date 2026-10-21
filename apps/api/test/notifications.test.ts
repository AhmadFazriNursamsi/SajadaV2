import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot } from './helpers';

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

const inbox = async () => (await member.get('/me/notifications')).body;

describe('Notifikasi petugas toko', () => {
  it('pesanan baru dan pembayaran masuk kotak masuk petugas toko; admin tidak punya kotak masuk', async () => {
    const placed = await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty: 1 }] });
    const inbox = async () => (await staff.get('/me/notifications')).body;
    const n = await inbox();
    const fresh = n.items.find((x: any) => x.title === 'Pesanan baru menunggu persetujuan');
    expect(fresh).toMatchObject({ tab: 'trx', route: 'staff-orders', refId: 'awaiting_approval', read: false });
    expect(n.unread.trx).toBeGreaterThanOrEqual(1);
    await staff.post(`/orders/${placed.body[0].id}/approve`);
    expect((await staff.post('/me/notifications/read', {})).status).toBe(201);
    expect((await inbox()).unread).toEqual({ info: 0, trx: 0 });
    expect((await admin.get('/me/notifications')).status).toBe(403);
    expect((await staff.post('/me/push-token', { token: 'ExponentPushToken[petugas-abcdefgh]' })).status).toBe(201);
  });
});

describe('Notifikasi anggota', () => {
  it('kejadian pesanan masuk kotak masuk, dengan tujuan dan belum dibaca', async () => {
    const placed = await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty: 4 }] });
    const id = placed.body[0].id, groupId = placed.body[0].groupId;
    await staff.post(`/orders/${id}/approve`);
    await staff.post(`/orders/${id}/ship`, { deliveryRef: 'SJ-NOTIF' });
    await staff.post(`/orders/${id}/receive`, { proofRef: 'BUKTI-N', receiverName: 'Siti' });
    const n = await inbox();
    const titles = n.items.map((x: any) => x.title);
    expect(titles).toEqual(expect.arrayContaining(['Pesanan disetujui', 'Pesanan dalam pengiriman', 'Pesanan selesai', 'Saldo penarikan bertambah']));
    const done = n.items.find((x: any) => x.title === 'Pesanan selesai');
    expect(done).toMatchObject({ tab: 'trx', cat: 'Selesai', route: 'orders', refId: groupId, read: false });
    expect(n.items.find((x: any) => x.title === 'Saldo penarikan bertambah')).toMatchObject({ tab: 'info', cat: 'Saldo', route: 'reward' });
    expect(n.unread.trx).toBeGreaterThanOrEqual(3);
  });

  it('penolakan toko dan keputusan penarikan ikut dikabarkan', async () => {
    const placed = await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty: 1 }] });
    await staff.post(`/orders/${placed.body[0].id}/reject`, { reason: 'Stok habis' });
    const w = await member.post('/me/withdrawals', { amount: 20_000, bank: 'BCA', accountNo: '1234567890', accountName: 'Siti Rahma' });
    await admin.post(`/withdrawals/${w.body.id}/reject`, { reason: 'Nomor rekening salah' });
    const items = (await inbox()).items;
    expect(items.find((x: any) => x.title === 'Pesanan dibatalkan' && x.body.includes('Stok habis'))).toMatchObject({ cat: 'Dibatalkan' });
    expect(items.find((x: any) => x.title === 'Penarikan ditolak')).toMatchObject({ tab: 'info', route: 'reward' });
  });

  it('tandai terbaca: satu atau semua; hanya milik sendiri', async () => {
    const before = await inbox();
    const one = before.items.find((x: any) => !x.read);
    expect((await member.post('/me/notifications/read', { ids: [one.id] })).status).toBe(201);
    const mid = await inbox();
    expect(mid.items.find((x: any) => x.id === one.id).read).toBe(true);
    expect(mid.unread.info + mid.unread.trx).toBe(before.unread.info + before.unread.trx - 1);
    await member.post('/me/notifications/read', {});
    const after = await inbox();
    expect(after.unread).toEqual({ info: 0, trx: 0 });
    expect((await admin.get('/me/notifications')).status).toBe(403);
    expect((await member.post('/me/notifications/read', { ids: ['bukan-uuid'] })).status).toBe(400);
  });

  it('token push: hanya format Expo, bisa didaftarkan ulang', async () => {
    expect((await member.post('/me/push-token', { token: 'asal' })).status).toBe(400);
    expect((await member.post('/me/push-token', { token: 'ExponentPushToken[abcdefghijklmnop]' })).status).toBe(201);
    expect((await member.post('/me/push-token', { token: 'ExponentPushToken[abcdefghijklmnop]' })).status).toBe(201);
  });
});
