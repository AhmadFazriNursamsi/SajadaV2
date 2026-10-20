import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot } from './helpers';

let app: NestFastifyApplication;
let admin: Client, staff: Client, member: Client;
let prods: any[];

beforeAll(async () => {
  app = await boot();
  [admin, staff, member] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas'), as(app, 'nasional', 'anggota')]);
  prods = (await admin.get('/products')).body;
});
afterAll(() => app.close());

const raw = (c: Client, url: string) => app.inject({ method: 'GET', url: `/api${url}`, headers: { authorization: `Bearer ${c.token}` } });

describe('Invoice PDF permintaan stok ke pusat', () => {
  let id = '';

  it('tiap permintaan mendapat nomor invoice; petugas dan pengurus bisa mengunduh PDF, anggota tidak', async () => {
    const r = await staff.post('/central/requests', { items: [{ productId: prods[0].id, qty: 3 }, { productId: prods[1].id, qty: 2 }] });
    expect(r.status).toBe(201);
    id = r.body.id;
    const list = (await staff.get('/central/requests')).body;
    expect(list.find((x: any) => x.id === id).invoiceNo).toMatch(/^INV-\d{4}$/);
    for (const c of [staff, admin]) {
      const res = await raw(c, `/central/requests/${id}/invoice`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      expect(res.rawPayload.length).toBeGreaterThan(1500);
    }
    expect((await raw(member, `/central/requests/${id}/invoice`)).statusCode).toBe(403);
  });

  it('tautan sementara membuka PDF tanpa login; tanda tangan salah atau kedaluwarsa ditolak', async () => {
    const link = (await staff.post(`/central/requests/${id}/invoice-link`)).body.url as string;
    expect(link).toMatch(/^\/api\/invoices\/stock-requests\/[0-9a-f-]{36}\.pdf\?/);
    const ok = await app.inject({ method: 'GET', url: link });
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await app.inject({ method: 'GET', url: link.replace(/sig=.{6}/, 'sig=AAAAAA') })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: link.replace(/exp=\d+/, 'exp=1000') })).statusCode).toBe(401);
    expect((await member.post(`/central/requests/${id}/invoice-link`)).status).toBe(403);
  });

  it('profil badan usaha: hanya pengurus mengubah; dipakai di kop', async () => {
    expect((await staff.call('PUT', '/company-profile', { legalName: 'X' })).status).toBe(403);
    expect((await admin.call('PUT', '/company-profile', { npwp: 'abc' })).status).toBe(400);
    const r = await admin.call('PUT', '/company-profile', { legalName: 'Koperasi Sajadah Digital', address: 'Jl. Contoh No. 1, Bandung', npwp: '01.234.567.8-901.000', phone: '022-1234567', signatory: 'Ahmad Fauzi', signatoryTitle: 'Ketua' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ legalName: 'Koperasi Sajadah Digital', npwp: '01.234.567.8-901.000' });
    expect((await staff.get('/company-profile')).body.legalName).toBe('Koperasi Sajadah Digital');
  });
});
