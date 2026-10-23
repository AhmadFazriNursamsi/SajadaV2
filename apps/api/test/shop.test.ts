import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot } from './helpers';

process.env.PRODUCT_IMAGE_DIR = mkdtempSync(join(tmpdir(), 'sajadah-img-'));
process.env.AVATAR_DIR = mkdtempSync(join(tmpdir(), 'sajadah-avatar-'));
let app: NestFastifyApplication;
let admin: Client, member: Client;

/** Isi PNG minimal: tanda tangan berkas yang benar, cukup untuk lolos pemeriksaan isi. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...new Array(200).fill(1)]).toString('base64');

beforeAll(async () => {
  app = await boot();
  [admin, member] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'anggota')]);
});
afterAll(() => app.close());


describe('Toko anggota', () => {
  it('katalog memuat kategori, harga tetap (tanpa coret/diskon), persen imbalan, dan stok per toko', async () => {
    const shop = (await member.get('/me/shop')).body;
    expect(shop.depots.length).toBeGreaterThan(0);
    expect(shop.categories).toContain('Makanan');
    const a = shop.products.find((p: any) => p.sku === 'PRD-01');
    expect(a).toMatchObject({ price: 100_000, rewardPercent: 20, category: 'Makanan', imageUrl: null });
    expect(a).not.toHaveProperty('listPrice');
    expect(a).not.toHaveProperty('discountPct');
    expect(Object.keys(a.stock).sort()).toEqual(shop.depots.map((d: any) => d.id).sort());
    expect(a.available).toBe(Object.values(a.stock).reduce((x: number, y: any) => x + y, 0));
  });

  it('pengurus mengubah deskripsi; harga normal tidak lagi dikenal', async () => {
    const id = (await member.get('/me/shop')).body.products.find((p: any) => p.sku === 'PRD-02').id;
    expect((await admin.call('PATCH', `/central/products/${id}`, { listPrice: 80_000 })).status).toBe(422); // tidak ada yang diubah: listPrice diabaikan
    expect((await admin.call('PATCH', `/central/products/${id}`, { description: 'Deskripsi baru' })).status).toBe(200);
    const p = (await member.get('/me/shop')).body.products.find((x: any) => x.id === id);
    expect(p).toMatchObject({ description: 'Deskripsi baru' });
    expect(p).not.toHaveProperty('discountPct');
  });

  it('unggah foto: hanya pengurus, isi harus gambar, lalu bisa dimuat publik', async () => {
    const id = (await member.get('/me/shop')).body.products[0].id;
    expect((await member.call('POST', `/central/products/${id}/image`, { contentType: 'image/png', data: PNG })).status).toBe(403);
    expect((await admin.call('POST', `/central/products/${id}/image`, { contentType: 'image/jpeg', data: Buffer.from('bukan gambar'.repeat(20)).toString('base64') })).status).toBe(422);
    const up = await admin.call('POST', `/central/products/${id}/image`, { contentType: 'image/png', data: PNG });
    expect(up.status).toBe(201);
    const url = (await member.get('/me/shop')).body.products.find((p: any) => p.id === id).imageUrl;
    expect(url).toMatch(/^\/api\/products\/image\//);
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect((await app.inject({ method: 'GET', url: '/api/products/image/..%2F..%2Fetc%2Fpasswd' })).statusCode).toBe(404);
  });

  it('foto profil: anggota mengganti fotonya sendiri, isi harus gambar, lalu tampil di profil', async () => {
    expect((await member.call('POST', '/me/avatar', { contentType: 'image/jpeg', data: Buffer.from('bukan gambar'.repeat(20)).toString('base64') })).status).toBe(422);
    const up = await member.call('POST', '/me/avatar', { contentType: 'image/png', data: PNG });
    expect(up.status).toBe(201);
    const url = (await member.get('/me')).body.avatarUrl;
    expect(url).toMatch(/^\/api\/members\/avatar\//);
    expect(url).toBe(up.body.avatarUrl);
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect((await app.inject({ method: 'GET', url: '/api/members/avatar/..%2Fx' })).statusCode).toBe(404);
  });
});
