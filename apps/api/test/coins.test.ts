import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot } from './helpers';

process.env.VOUCHER_IMAGE_DIR = mkdtempSync(join(tmpdir(), 'sajadah-voucher-'));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...new Array(200).fill(1)]).toString('base64');
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

const coins = async () => (await member.get('/me/coins')).body;
const buy = async (qty: number) => {
  const placed = await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty }] });
  const id = placed.body[0].id;
  await staff.post(`/orders/${id}/approve`);
  await staff.post(`/orders/${id}/ship`, { deliveryRef: `SJ-KOIN-${qty}` });
  return id as string;
};

describe('Koin per produk dan penukaran voucher', () => {
  it('koin produk diatur pengurus dan tampil di toko anggota', async () => {
    expect((await member.call('PATCH', `/central/products/${prod.id}`, { coins: 5 })).status).toBe(403);
    expect((await admin.call('PATCH', `/central/products/${prod.id}`, { coins: -1 })).status).toBe(400);
    expect((await admin.call('PATCH', `/central/products/${prod.id}`, { coins: 5 })).status).toBe(200);
    expect((await member.get('/me/shop')).body.products.find((p: any) => p.id === prod.id).coins).toBe(5);
  });

  it('koin bertambah (koin produk × jumlah) hanya saat belanja diterima, sekali saja', async () => {
    const before = (await coins()).balance;
    const id = await buy(3);
    expect((await coins()).balance).toBe(before);
    expect((await staff.post(`/orders/${id}/receive`, { proofRef: 'KOIN-1', receiverName: 'Siti' })).status).toBe(201);
    const c = await coins();
    expect(c.balance).toBe(before + 15);
    expect(c.entries[0]).toMatchObject({ kind: 'earn', amount: 15 });
    expect((await member.get('/me')).body.coinBalance).toBe(before + 15);
    expect((await staff.post(`/orders/${id}/receive`, { proofRef: 'KOIN-1', receiverName: 'Siti' })).status).toBe(422);
    expect((await coins()).balance).toBe(before + 15);
  });

  it('katalog voucher: hanya pengurus yang mengelola; anggota hanya melihat yang aktif', async () => {
    const v = { name: 'Voucher Umroh', description: 'Paket umroh', coinCost: 10, stock: 2 };
    expect((await member.post('/vouchers', v)).status).toBe(403);
    expect((await admin.post('/vouchers', { ...v, coinCost: 0 })).status).toBe(400);
    const made = await admin.post('/vouchers', v);
    expect(made.status).toBe(201);
    await admin.post('/vouchers', { name: 'Voucher Nonaktif', coinCost: 1, stock: 5, active: false });
    const list = (await coins()).vouchers;
    expect(list.map((x: any) => x.name)).toContain('Voucher Umroh');
    expect(list.map((x: any) => x.name)).not.toContain('Voucher Nonaktif');
  });

  it('tukar voucher: koin dan stok berkurang; koin kurang atau stok habis ditolak; pengurus terbitkan dengan kode', async () => {
    const vid = (await coins()).vouchers.find((x: any) => x.name === 'Voucher Umroh').id;
    const big = (await admin.post('/vouchers', { name: 'Voucher Mahal', coinCost: 1_000_000, stock: 1 })).body.id;
    expect((await member.post(`/me/vouchers/${big}/redeem`)).status).toBe(422);
    const b0 = (await coins()).balance;
    const r = await member.post(`/me/vouchers/${vid}/redeem`);
    expect(r.status).toBe(201);
    const c = await coins();
    expect(c.balance).toBe(b0 - 10);
    expect(c.redemptions[0]).toMatchObject({ voucherName: 'Voucher Umroh', coins: 10, status: 'pending' });
    expect(c.vouchers.find((x: any) => x.id === vid).stock).toBe(1);
    const red = (await admin.get('/voucher-redemptions')).body.find((x: any) => x.id === r.body.id);
    expect(red).toMatchObject({ status: 'pending', memberName: expect.any(String) });
    expect((await member.post(`/voucher-redemptions/${red.id}/fulfill`, {})).status).toBe(403);
    expect((await admin.post(`/voucher-redemptions/${red.id}/fulfill`, { code: 'UMROH-2026' })).status).toBe(201);
    expect((await admin.post(`/voucher-redemptions/${red.id}/fulfill`, {})).status).toBe(422);
    expect((await coins()).redemptions[0]).toMatchObject({ status: 'fulfilled', code: 'UMROH-2026' });
  });

  it('penukaran ditolak: koin dan stok kembali', async () => {
    const vid = (await coins()).vouchers.find((x: any) => x.name === 'Voucher Umroh').id;
    await staff.post(`/orders/${await buy(4)}/receive`, { proofRef: 'KOIN-2', receiverName: 'Siti' }); // +20 koin
    const b0 = (await coins()).balance;
    const r = await member.post(`/me/vouchers/${vid}/redeem`);
    expect(r.status).toBe(201);
    expect((await admin.post(`/voucher-redemptions/${r.body.id}/reject`, {})).status).toBe(400);
    expect((await admin.post(`/voucher-redemptions/${r.body.id}/reject`, { reason: 'Kuota habis di pemasok' })).status).toBe(201);
    const c = await coins();
    expect(c.balance).toBe(b0);
    expect(c.vouchers.find((x: any) => x.id === vid).stock).toBe(1);
    expect(c.entries[0]).toMatchObject({ kind: 'refund', amount: 10 });
    // stok habis
    expect((await member.post(`/me/vouchers/${vid}/redeem`)).status).toBe(201);
    expect((await member.post(`/me/vouchers/${vid}/redeem`)).status).toBe(422);
  });

  it('foto voucher: hanya pengurus, isi harus gambar, tampil di katalog anggota dan bisa dimuat publik', async () => {
    const id = (await admin.post('/vouchers', { name: 'Voucher Foto', coinCost: 5, stock: 1 })).body.id;
    expect((await member.post(`/vouchers/${id}/image`, { contentType: 'image/png', data: PNG })).status).toBe(403);
    expect((await admin.post(`/vouchers/${id}/image`, { contentType: 'image/jpeg', data: Buffer.from('bukan gambar'.repeat(20)).toString('base64') })).status).toBe(422);
    expect((await admin.post(`/vouchers/${id}/image`, { contentType: 'image/png', data: PNG })).status).toBe(201);
    const url = (await coins()).vouchers.find((x: any) => x.id === id).imageUrl;
    expect(url).toMatch(/^\/api\/vouchers\/image\//);
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect((await app.inject({ method: 'GET', url: '/api/vouchers/image/..%2Fx' })).statusCode).toBe(404);
    expect((await admin.get('/vouchers')).body.find((x: any) => x.id === id).imageUrl).toBe(url);
  });
});
