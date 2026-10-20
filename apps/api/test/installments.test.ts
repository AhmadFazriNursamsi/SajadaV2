import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
afterAll(async () => { vi.useRealTimers(); await app.close(); });

const inst = async () => (await member.get('/me/installments')).body;
const balance = async () => (await member.get('/me/rewards')).body.balance;
/** Belanja sendiri qty buah sampai diterima (hari aktif). Harga Produk A Rp100.000 → imbalan 20% = Rp20.000 per buah. */
async function buyReceived(qty: number) {
  const id = (await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty }] })).body[0].id;
  await staff.post(`/orders/${id}/approve`);
  await staff.post(`/orders/${id}/ship`, { deliveryRef: `SJ-T-${qty}` });
  expect((await staff.post(`/orders/${id}/receive`, { proofRef: 'B', receiverName: 'Siti' })).status).toBe(201);
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

describe('Tagihan harian Rp30.000 selama 730 hari aktif', () => {
  it('belum ada transaksi: belum mulai; belum dipotong saat dipesan', async () => {
    expect(await inst()).toMatchObject({ amount: 30_000, totalDays: 730, paidDays: 0, remainingDays: 730, arrears: 0, status: 'belum_mulai', chargedToday: false });
  });

  it('hari aktif: dipotong sekali per hari dari saldo penarikan saat belanja diterima', async () => {
    await buyReceived(2); // imbalan 40.000 → potong 30.000
    let i = await inst();
    expect(i).toMatchObject({ paidDays: 1, remainingDays: 729, arrears: 0, status: 'berjalan', chargedToday: true });
    expect(i.entries[0]).toMatchObject({ seq: 1, due: 30_000, paid: 30_000, arrearsAfter: 0 });
    expect(await balance()).toBe(10_000);
    await buyReceived(1); // transaksi kedua di hari yang sama: tidak dipotong lagi
    i = await inst();
    expect(i.paidDays).toBe(1);
    expect(await balance()).toBe(30_000);
  });

  it('hari tanpa transaksi dilewati: tenor tidak berkurang; saat aktif lagi dipotong (tenor makin panjang bila jarang belanja)', async () => {
    await nextDay(); // hari berikutnya: tidak belanja, tidak ada perubahan
    expect((await inst()).paidDays).toBe(1);
    await buyReceived(1); // saldo 30.000 + 20.000 − 30.000
    const i = await inst();
    expect(i).toMatchObject({ paidDays: 2, remainingDays: 728, arrears: 0 });
    expect(await balance()).toBe(20_000);
  });

  it('saldo kurang: hari tetap dihitung, kekurangan jadi tunggakan lalu ikut dipotong pada hari aktif berikutnya', async () => {
    expect((await member.post('/me/rewards/transfer', { amount: await balance() })).status).toBe(201); // kosongkan saldo penarikan
    await nextDay();
    await buyReceived(1); // imbalan 20.000 < 30.000
    let i = await inst();
    expect(i).toMatchObject({ paidDays: 3, arrears: 10_000 });
    expect(i.entries[0]).toMatchObject({ due: 30_000, paid: 20_000, arrearsAfter: 10_000 });
    expect(await balance()).toBe(0);
    await nextDay();
    await buyReceived(1); // tagih 30.000 + tunggakan 10.000, hanya ada 20.000
    i = await inst();
    expect(i).toMatchObject({ paidDays: 4, arrears: 20_000, remainingAmount: 726 * 30_000 + 20_000 });
    await nextDay();
    await buyReceived(5); // imbalan 100.000: tagih 30.000 + 20.000 → sisa 50.000
    i = await inst();
    expect(i).toMatchObject({ paidDays: 5, arrears: 0 });
    expect(await balance()).toBe(50_000);
  });

  it('pembatalan sebelum diterima tidak mengaktifkan hari; pengurus melihat ringkasan, anggota tidak', async () => {
    await nextDay();
    const before = await inst();
    const id = (await member.post('/me/orders', { depotId: depot.id, items: [{ productId: prod.id, qty: 1 }] })).body[0].id;
    await staff.post(`/orders/${id}/reject`, { reason: 'uji' });
    expect(await inst()).toMatchObject({ paidDays: before.paidDays, chargedToday: false });
    expect((await member.get('/installments/summary')).status).toBe(403);
    const s = (await admin.get('/installments/summary')).body;
    expect(s.totalDays).toBe(730);
    expect(s.kpis.collected).toBeGreaterThan(0);
    expect(s.members.find((m: any) => m.paidDays === before.paidDays)).toMatchObject({ status: 'berjalan' });
  });
});
