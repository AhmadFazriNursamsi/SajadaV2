import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client, as, boot, receiveViaMember } from './helpers';

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

const inst = async () => (await member.get('/me/installments')).body;
const balance = async () => (await member.get('/me/rewards')).body.balance;
/** Belanja sendiri qty buah sampai diterima (hari aktif). Harga Produk A Rp100.000 → imbalan 20% = Rp20.000 per buah. */
async function buyReceived(qty: number) {
  const id = (await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty }] })).body[0].id;
  await staff.post(`/orders/${id}/approve`);
  await staff.post(`/orders/${id}/ship`, { deliveryRef: `SJ-T-${qty}` });
  expect((await receiveViaMember(member, staff, id)).status).toBe(201); // anggota memeriksa barang → diterima
}
/** Pindah ke hari berikutnya (WIB) lalu login ulang karena token berusia 12 jam. */
let shift = 0;
async function nextDay() {
  vi.useRealTimers();
  shift += 26 * 3600_000;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + shift);
  [admin, staff, member] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas'), as(app, 'nasional', 'anggota')]);
}

describe('Tagihan harian Rp30.000: dipotong otomatis bila imbalan hari itu sudah mencapai Rp30.000', () => {
  it('belum ada transaksi: belum mulai; belum dipotong saat dipesan', async () => {
    expect(await inst()).toMatchObject({ amount: 30_000, totalDays: 730, paidDays: 0, remainingDays: 730, arrears: 0, status: 'belum_mulai', chargedToday: false });
  });

  it('imbalan hari itu di bawah Rp30.000: tidak ada potongan dan hari tidak dihitung', async () => {
    await buyReceived(1); // imbalan 20.000 < 30.000
    expect(await inst()).toMatchObject({ paidDays: 0, arrears: 0, status: 'belum_mulai', chargedToday: false });
    expect(await balance()).toBe(20_000);
  });

  it('imbalan beberapa pesanan di hari yang sama dijumlahkan; begitu mencapai Rp30.000 dipotong sekali', async () => {
    await buyReceived(1); // total hari ini 40.000 ≥ 30.000 → potong 30.000
    let i = await inst();
    expect(i).toMatchObject({ paidDays: 1, remainingDays: 729, arrears: 0, status: 'berjalan', chargedToday: true });
    expect(i.entries[0]).toMatchObject({ seq: 1, due: 30_000, paid: 30_000, arrearsAfter: 0 });
    expect(await balance()).toBe(20_000 + 20_000 - 30_000);
    await buyReceived(5); // transaksi lain di hari yang sama: tidak dipotong lagi
    i = await inst();
    expect(i.paidDays).toBe(1);
    expect(await balance()).toBe(10_000 + 100_000);
  });

  it('satu pesanan besar langsung mencapai batas (>= Rp30.000)', async () => {
    await nextDay();
    await buyReceived(2); // imbalan 40.000 → potong 30.000
    expect(await inst()).toMatchObject({ paidDays: 2, remainingDays: 728, arrears: 0 });
    expect(await balance()).toBe(110_000 + 40_000 - 30_000);
  });

  it('hari dengan imbalan kecil dilewati: tenor tidak berkurang', async () => {
    await nextDay();
    const before = await inst();
    await buyReceived(1); // 20.000 < 30.000
    expect(await inst()).toMatchObject({ paidDays: before.paidDays, chargedToday: false });
    expect(await balance()).toBe(120_000 + 20_000);
  });

  it('pembatalan sebelum diterima tidak mengaktifkan hari; pengurus melihat ringkasan, anggota tidak', async () => {
    await nextDay();
    const before = await inst();
    const id = (await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty: 5 }] })).body[0].id;
    await staff.post(`/orders/${id}/reject`, { reason: 'uji' });
    expect(await inst()).toMatchObject({ paidDays: before.paidDays, chargedToday: false });
    expect((await member.get('/installments/summary')).status).toBe(403);
    const s = (await admin.get('/installments/summary')).body;
    expect(s.totalDays).toBe(730);
    expect(s.kpis.collected).toBeGreaterThan(0);
    expect(s.members.find((m: any) => m.paidDays === before.paidDays)).toMatchObject({ status: 'berjalan' });
  });
});
