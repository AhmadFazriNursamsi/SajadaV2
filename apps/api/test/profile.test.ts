import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot } from './helpers';

let app: NestFastifyApplication;
let admin: Client, staff: Client, member: Client;

beforeAll(async () => {
  app = await boot();
  [admin, staff, member] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas'), as(app, 'nasional', 'anggota')]);
});
afterAll(() => app.close());

describe('profil anggota (mobile): edit profil sendiri', () => {
  it('mengubah nama, nomor HP, dan alamat; data keanggotaan tidak ikut berubah; tercatat di log', async () => {
    const before = (await member.get('/me')).body;
    expect(before).toMatchObject({ phone: null, address: null });
    expect(before.username).toBe('anggota.nasional');
    const r = await member.call('PATCH', '/me', { name: 'Siti Rahma Hidayat', phone: '0812-3456-7890', address: 'Jl. Melati No. 5, Soreang' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Siti Rahma Hidayat', phone: '0812-3456-7890', address: 'Jl. Melati No. 5, Soreang' });
    const after = (await member.get('/me')).body;
    for (const k of ['memberNo', 'familyCode', 'area', 'balance', 'sponsor', 'username', 'active']) expect(after[k]).toEqual(before[k]);
    expect((await member.get('/auth/me')).body.name).toBe('Siti Rahma Hidayat');              // nama di sesi ikut terbarui
    expect((await admin.get('/members')).body.some((m: any) => m.name === 'Siti Rahma Hidayat')).toBe(true);
    expect((await admin.get('/audit-log?q=Profil diubah&limit=5')).body.rows[0].message).toMatch(/Profil diubah oleh anggota.*nama Siti Rahma → Siti Rahma Hidayat, nomor HP, alamat/);
    // alamat boleh dikosongkan, nomor HP wajib
    const clear = await member.call('PATCH', '/me', { address: '' });
    expect(clear.body).toMatchObject({ phone: '0812-3456-7890', address: null });
    const noPhone = await member.call('PATCH', '/me', { phone: '' });
    expect(noPhone.status).toBe(422); expect(noPhone.body.message).toMatch(/Nomor HP wajib diisi/);
    await member.call('PATCH', '/me', { name: 'Siti Rahma' });
  });

  it('validasi: nama pendek, nomor HP tidak valid, tidak ada perubahan; hanya anggota yang boleh', async () => {
    expect((await member.call('PATCH', '/me', { name: 'A' })).status).toBe(400);
    expect((await member.call('PATCH', '/me', { phone: 'abc123' })).status).toBe(400);
    expect((await member.call('PATCH', '/me', { phone: '123' })).status).toBe(400);
    expect((await member.call('PATCH', '/me', {})).status).toBe(400);
    expect((await member.call('PATCH', '/me', { address: 'x'.repeat(201) })).status).toBe(400);
    const same = await member.call('PATCH', '/me', { name: 'Siti Rahma' });
    expect(same.status).toBe(422); expect(same.body.message).toMatch(/Tidak ada yang diubah/);
    expect((await staff.call('PATCH', '/me', { name: 'Petugas Baru' })).status).toBe(403);
    expect((await admin.call('PATCH', '/me', { name: 'Pengurus Baru' })).status).toBe(403);
  });

  it('ganti kata sandi sendiri tetap bekerja untuk anggota (dipakai menu Profil)', async () => {
    const c = await as(app, 'nasional', 'anggota');
    expect((await c.post('/auth/change-password', { current: 'salah', next: 'Baru12345' })).status).toBe(401);
    expect((await c.post('/auth/change-password', { current: 'sajadah123', next: 'Baru12345' })).status).toBe(201);
    expect((await c.post('/auth/change-password', { current: 'Baru12345', next: 'sajadah123' })).status).toBe(201);
  });

  it('status keluarga: kode A (Single Mom) diterima, kode lama J ditolak', async () => {
    expect((await member.call('PATCH', '/me', { familyCode: 'J' })).status).toBe(400);
    const r = await member.call('PATCH', '/me', { familyCode: 'A' });
    expect(r.status).toBe(200);
    expect(r.body.familyCode).toBe('A');
    await member.call('PATCH', '/me', { familyCode: 'I' });
  });
});
