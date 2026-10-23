import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client, PHOTO, as, boot, receiveViaMember } from './helpers';

let app: NestFastifyApplication;
let admin: Client, staff: Client, member: Client;
let depot: any, prod: any;

beforeAll(async () => {
  app = await boot();
  [admin, staff, member] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas'), as(app, 'nasional', 'anggota')]);
  depot = (await admin.get('/depots')).body[0];
  prod = (await admin.get('/products')).body[0];
});
afterAll(async () => { vi.useRealTimers(); await app.close(); });

/** Maju sekian hari lalu login ulang (token berusia 12 jam). */
async function advanceDays(days: number) {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + days * 86_400_000);
  [admin, staff, member] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas'), as(app, 'nasional', 'anggota')]);
}
const rewardBalance = async () => (await member.get('/me/rewards')).body.balance;
async function shippedMemberOrder() {
  const id = (await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty: 2 }] })).body[0].id;
  await staff.post(`/orders/${id}/approve`);
  expect((await staff.post(`/orders/${id}/ship`, { deliveryRef: 'SJ-OVR' })).status).toBe(201);
  return id as string;
}
const rowOf = async (id: string) => (await admin.get('/orders')).body.find((x: any) => x.id === id);

describe('Pengurus menyelesaikan pesanan anggota yang tak kunjung diperiksa', () => {
  it('hanya pengurus; alasan wajib; belum boleh sebelum masa tunggu 3 hari; belum ada imbalan', async () => {
    const id = await shippedMemberOrder();
    const before = await rewardBalance();
    const body = { reason: 'Anggota tidak bisa dihubungi, barang sudah diterima toko tujuan' };
    expect((await staff.post(`/orders/${id}/receive-override`, body)).status).toBe(403); // petugas tidak boleh
    expect((await member.post(`/orders/${id}/receive-override`, body)).status).toBe(403);
    expect((await admin.post(`/orders/${id}/receive-override`, { reason: 'singkat' })).status).toBe(400);
    const early = await admin.post(`/orders/${id}/receive-override`, body);
    expect(early.status).toBe(422);
    expect(early.body.message).toMatch(/Beri anggota waktu memeriksa barangnya dulu/);
    expect((await rowOf(id)).status).toBe('shipped');
    expect(await rewardBalance()).toBe(before);
  });

  it('setelah 3 hari tanpa pemeriksaan: pengurus bisa menyelesaikan, imbalan cair, tercatat di audit; tidak bisa dua kali', async () => {
    const id = await shippedMemberOrder();
    await advanceDays(4);
    const before = await rewardBalance();
    const body = { reason: 'Anggota tidak bisa dihubungi, barang sudah diterima toko tujuan' };
    expect((await admin.post(`/orders/${id}/receive-override`, body)).status).toBe(201);
    const row = await rowOf(id);
    expect(row.status).toBe('received');
    expect(row.proofRef).toBe(`PENGURUS-${row.groupNo}`);
    expect(await rewardBalance()).toBeGreaterThan(before - 1); // imbalan produk dikreditkan (dikurangi tagihan harian bila berlaku)
    const log = (await admin.get('/audit-log?limit=30')).body.rows;
    expect(log.some((r: any) => r.message.includes('diselesaikan pengurus tanpa pemeriksaan anggota') && r.message.includes('Anggota tidak bisa dihubungi'))).toBe(true);
    expect((await admin.post(`/orders/${id}/receive-override`, body)).status).toBe(422); // sudah selesai
  });

  it('pesanan yang sudah diperiksa anggota atau pesanan pelanggan umum tidak bisa lewat jalur ini', async () => {
    const id = await shippedMemberOrder();
    expect((await receiveViaMember(member, staff, id)).status).toBe(201);
    await advanceDays(8);
    expect((await admin.post(`/orders/${id}/receive-override`, { reason: 'Sudah diperiksa anggota tadi' })).status).toBe(422);
    const m = (await admin.get('/members')).body[0];
    const c = (await staff.post('/orders', { sellerId: m.id, customerName: 'Ibu Ani', items: [{ productId: prod.id, qty: 1 }] })).body[0];
    await admin.post(`/orders/${c.id}/pay-cash`); await staff.post(`/orders/${c.id}/ship`, { deliveryRef: 'SJ-C' });
    const r = await admin.post(`/orders/${c.id}/receive-override`, { reason: 'Pelanggan umum tidak lewat jalur ini' });
    expect(r.status).toBe(422); expect(r.body.message).toMatch(/Hanya untuk pesanan anggota/);
  });

  it('bila anggota sudah mengirim foto, pengurus tidak menyelesaikannya: itu urusan verifikasi petugas toko', async () => {
    const id = await shippedMemberOrder();
    expect((await member.post(`/me/orders/${id}/check`, { photo: PHOTO })).status).toBe(201);
    await advanceDays(10);
    const r = await admin.post(`/orders/${id}/receive-override`, { reason: 'Coba lewati verifikasi petugas toko' });
    expect(r.status).toBe(422); expect(r.body.message).toMatch(/petugas toko yang memverifikasi/);
  });
});
