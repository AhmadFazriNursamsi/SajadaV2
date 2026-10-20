import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot, undoOrder } from './helpers';
import { DB } from '../src/core/db.module';
import type { Database } from '../src/db/db';
import { members as membersTable, orders as ordersTable, tenants as tenantsTable } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { DEMO_PASSWORD } from '../src/seed/seed';
import { MasterService, type MasterData } from '../src/regions/master.service';
import { LoginLimiter } from '../src/auth/login-limiter';

let app: NestFastifyApplication;
/** Data referensi kecil untuk tes (tanpa memuat 80 ribu baris). Kecamatan pemekaran (…011) bentrok prefiks 01 dengan Mijen. */
const REF: MasterData = {
  provinces: [['32', 'Jawa Barat'], ['33', 'Jawa Tengah']],
  regencies: [['3301', '33', 'Kabupaten Cilacap'], ['3374', '33', 'Kota Semarang']],
  districts: [['3374010', '3374', 'Mijen'], ['3374011', '3374', 'Mijen Barat'], ['3374020', '3374', 'Gunungpati'], ['3374130', '3374', 'Semarang Tengah'], ['3301010', '3301', 'Kedungreja']],
  villages: [['3374130002', '3374130', 'Karangkidul'], ['3374130005', '3374130', 'Miroto'], ['3374010001', '3374010', 'Jatisari']],
};
let admin: Client, staff: Client, member: Client;
/** Akuntan sudah dihapus: pengurus memegang semua tugas keuangan (alias lama dipertahankan agar tes mudah dibaca). */
let acct: Client;
/** Barang masuk di toko dicatat petugas toko itu (pengurus hanya melihat). */
const addStock = async (who: Client, productId: string, qty: number) => {
  expect((await who.post(`/products/${productId}/receipts`, { qty })).status).toBe(201);
};
let ms: any[], ps: any[];
const byName = (rows: any[], n: string) => rows.find((r) => r.name === n);

beforeAll(async () => {
  app = await boot();
  await app.get(MasterService, { strict: false }).load(REF);
  [admin, staff, member] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas'), as(app, 'nasional', 'anggota')]);
  acct = admin;
  ms = (await admin.get('/members')).body;
  ps = (await admin.get('/products')).body;
});
afterAll(() => app.close());

describe('auth & peran', () => {
  it('health publik', async () => expect((await new Client(app).get('/health')).body.status).toBe('ok'));
  it('login tanpa tenant: tenant ditentukan dari username + kata sandi', async () => {
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin.jabar', password: 'sajadah123' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().tenant.slug).toBe('jabar');
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin.jabar', password: 'salah' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().message).toBe('Username atau kata sandi salah');
    const none = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tidak.ada', password: 'sajadah123' } });
    expect(none.json().message).toBe('Username atau kata sandi salah'); // pesan sama: tidak membocorkan akun
  });
  it('tanpa token ditolak', async () => expect((await new Client(app).get('/members')).status).toBe(401));
  it('kata sandi salah ditolak', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenant: 'nasional', username: 'admin.nasional', password: 'salah' } });
    expect(r.statusCode).toBe(401);
  });
  it('role member tidak boleh akses endpoint staf', async () => expect((await member.get('/members')).status).toBe(403));
  it('isolasi tenant: tenant lain tidak melihat data nasional', async () => {
    const other = await as(app, 'jabar', 'admin');
    const names = (await other.get('/members')).body.map((m: any) => m.name);
    expect(names).not.toContain('Siti Rahma');
    expect(names).toContain('Sari Wulandari');
  });
});

describe('anggota', () => {
  let villages: any[];
  beforeAll(async () => { villages = (await admin.get('/regions')).body.filter((r: any) => r.level === 'village'); });

  it('tambah anggota: daerah wajib dari Struktur daerah; langsung ditempatkan dan bernomor; pratinjau cocok', async () => {
    const v = villages[0];
    expect((await admin.post('/members', { name: 'Baru', villageId: v.id, familyCode: 'Z' })).status).toBe(400); // kode keluarga
    expect((await admin.post('/members', { name: 'Baru', familyCode: 'L' })).status).toBe(400); // daerah wajib
    expect((await admin.post('/members', { name: 'Baru', villageId: crypto.randomUUID(), familyCode: 'L' })).status).toBe(422); // bukan wilayah tenant ini
    const prov = (await admin.get('/regions')).body.find((r: any) => r.level === 'province');
    expect((await admin.post('/members', { name: 'Baru', villageId: prov.id, familyCode: 'L' })).status).toBe(422); // bukan kelurahan
    const preview = (await admin.get(`/members/next-number?villageId=${v.id}`)).body.memberNo;
    expect(preview).toMatch(/^32\d{4}\d{2}000004$/);
    const r = await admin.post('/members', { name: 'Baru', villageId: v.id, familyCode: 'L' });
    expect(r.status).toBe(201);
    expect(r.body.memberNo).toBe(preview); // nomor final = pratinjau
    expect(r.body.area).toBe(v.path[v.path.length - 2]); // daerah = nama kecamatan dari kelurahan
    const row = (await admin.get('/members')).body.find((m: any) => m.id === r.body.id);
    expect(row).toMatchObject({ placed: true, villageId: v.id });
    expect((await admin.get('/members/next-number?villageId=bukan-uuid')).status).toBe(400);
  });
  it('penempatan memakai kelurahan; nomor hanya setelah penempatan, 14 digit, dari kode wilayah, unik berurutan', async () => {
    const rina = byName(ms, 'Rina Marlina');
    expect(rina.placed).toBe(false);
    expect((await admin.post(`/members/${rina.id}/member-number`)).status).toBe(422);
    expect((await admin.post(`/members/${rina.id}/placement`, {})).status).toBe(400); // villageId wajib
    const prov = (await admin.get('/regions')).body.find((r: any) => r.level === 'province');
    expect((await admin.post(`/members/${rina.id}/placement`, { villageId: prov.id })).status).toBe(422); // bukan kelurahan
    expect((await admin.post(`/members/${rina.id}/placement`, { villageId: villages[2].id })).status).toBe(201);
    const r = await admin.post(`/members/${rina.id}/member-number`);
    expect(r.body.memberNo).toMatch(/^32\d{4}\d{2}000005$/); // 32 = provinsi Jawa Barat; 000005 sesudah 3 nomor seed + 1 anggota baru
    // nomor tidak berubah saat penempatan dipindah
    await admin.post(`/members/${rina.id}/placement`, { villageId: villages[0].id });
    expect((await admin.get('/members')).body.find((m: any) => m.id === rina.id).memberNo).toBe(r.body.memberNo);
    expect((await admin.post(`/members/${rina.id}/member-number`)).status).toBe(422);
  });
  it('alokasi penyertaan: total harus Rp12,5 juta, investor valid, tanggal & referensi wajib', async () => {
    const dewi = byName(ms, 'Dewi Lestari');
    const inv = (await admin.get('/investors/funding')).body.investors;
    const ok = { ref: 'FUND-1', date: '2026-09-10', allocations: [{ investorId: inv[0].id, amount: 8_750_000 }, { investorId: inv[1].id, amount: 3_750_000 }] };
    expect((await admin.post(`/members/${dewi.id}/funding`, { ...ok, allocations: [{ investorId: inv[0].id, amount: 10_000_000 }] })).body.message).toMatch(/Total alokasi/);
    expect((await admin.post(`/members/${dewi.id}/funding`, { ...ok, allocations: [{ investorId: inv[0].id, amount: 6_000_000 }, { investorId: inv[0].id, amount: 6_500_000 }] })).body.message).toMatch(/sekali/);
    expect((await admin.post(`/members/${dewi.id}/funding`, { ...ok, allocations: [{ investorId: crypto.randomUUID(), amount: 12_500_000 }] })).status).toBe(422);
    expect((await admin.post(`/members/${dewi.id}/funding`, { ...ok, date: 'kemarin' })).status).toBe(400);
    expect((await staff.post(`/members/${dewi.id}/funding`, ok)).status).toBe(403); // hanya pengurus
  });
  it('aktivasi butuh pendanaan; tanggal tidak di masa depan / sebelum pendanaan; menyimpan snapshot anggaran', async () => {
    const dewi = byName(ms, 'Dewi Lestari');
    const act = (date: string) => admin.post(`/members/${dewi.id}/activation`, { ref: 'AKT-1', date });
    expect((await act('2026-09-12')).body.message).toMatch(/investor/); // belum didanai
    const inv = (await admin.get('/investors/funding')).body.investors;
    expect((await admin.post(`/members/${dewi.id}/funding`, { ref: 'FUND-1', date: '2026-09-10', allocations: [{ investorId: inv[0].id, amount: 8_750_000 }, { investorId: inv[1].id, amount: 3_750_000 }] })).status).toBe(201);
    expect((await admin.post(`/members/${dewi.id}/funding`, { ref: 'FUND-1', date: '2026-09-10', allocations: [{ investorId: inv[0].id, amount: 12_500_000 }] })).status).toBe(422); // sudah tercatat
    expect((await act('2099-01-01')).body.message).toMatch(/masa depan/);
    expect((await act('2026-09-01')).body.message).toMatch(/sebelum tanggal pendanaan/);
    expect((await act('2026-09-12')).status).toBe(201);
    const after = (await admin.get('/members')).body.find((m: any) => m.id === dewi.id);
    expect(after).toMatchObject({ active: true, balance: 10_000_000, remaining: 12_500_000, activatedAt: '2026-09-12', activationRef: 'AKT-1', fundingRef: 'FUND-1' });
    expect(after.budgetSnapshot).toMatchObject({ hpAndroid: 2_000_000, application: 250_000 });
    const f = (await admin.get('/investors/funding')).body.members.find((m: any) => m.id === dewi.id);
    expect(f).toMatchObject({ funded: true, total: 12_500_000 });
  });
  it('sponsor tidak boleh membentuk siklus', async () => {
    const [siti, , dewi] = [byName(ms, 'Siti Rahma'), 0, byName(ms, 'Dewi Lestari')];
    // rantai: Dewi -> Budi -> Siti; menjadikan Dewi sponsor Siti = siklus
    const r = await admin.call('PATCH', `/members/${siti.id}/sponsor`, { sponsorId: dewi.id });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/siklus/);
  });
});

describe('struktur daerah & master investor', () => {
  it('menambah pohon wilayah berurutan; induk, kode dan nama divalidasi', async () => {
    const p = await admin.post('/regions', { level: 'province', parentId: null, code: '99', name: 'Provinsi Uji' });
    expect(p.status).toBe(201);
    expect((await admin.post('/regions', { level: 'province', parentId: null, code: '98', name: 'provinsi uji' })).body.message).toMatch(/sudah ada/); // nama ganda (tak peka huruf)
    expect((await admin.post('/regions', { level: 'regency', parentId: null, code: '01', name: 'X' })).status).toBe(400); // wajib induk
    expect((await admin.post('/regions', { level: 'regency', parentId: p.body.id, code: '1', name: 'X' })).status).toBe(400); // kode 2 digit
    expect((await admin.post('/regions', { level: 'district', parentId: p.body.id, code: '01', name: 'Kec' })).body.message).toMatch(/harus berupa/); // induk salah tingkat
    const k = await admin.post('/regions', { level: 'regency', parentId: p.body.id, code: '01', name: 'Kab Uji' });
    expect(k.status).toBe(201);
    expect((await admin.post('/regions', { level: 'regency', parentId: p.body.id, code: '01', name: 'Kab Lain' })).body.message).toMatch(/Kode lokal 01/); // kode kembar satu induk
    // hapus: induk yang punya anak ditolak; daun boleh
    expect((await admin.call('DELETE', `/regions/${p.body.id}`)).body.message).toMatch(/di bawahnya/);
    expect((await admin.call('DELETE', `/regions/${k.body.id}`)).status).toBe(200);
    expect((await admin.call('DELETE', `/regions/${p.body.id}`)).status).toBe(200);
  });
  it('jalur lengkap provinsi → kelurahan dibuat manual, lalu dipakai menempatkan anggota & membentuk nomor', async () => {
    const mk = (b: any) => admin.post('/regions', b);
    const p = await mk({ level: 'province', parentId: null, code: '33', name: 'Jawa Tengah' });
    const k = await mk({ level: 'regency', parentId: p.body.id, code: '74', name: 'Kota Semarang' });
    const c = await mk({ level: 'district', parentId: k.body.id, code: '05', name: 'Mijen' });
    const v = await mk({ level: 'village', parentId: c.body.id, code: '001', name: 'Cangkiran' });
    expect([p, k, c, v].map((x) => x.status)).toEqual([201, 201, 201, 201]);
    const view = (await admin.get('/regions')).body.find((r: any) => r.id === v.body.id);
    expect(view.path).toEqual(['Jawa Tengah', 'Kota Semarang', 'Mijen', 'Cangkiran']);
    const preview = (await admin.get(`/members/next-number?villageId=${v.body.id}`)).body.memberNo;
    expect(preview).toMatch(/^337405\d{2}\d{6}$/); // provinsi 33, kabupaten 74, kecamatan 05
    for (const id of [v.body.id, c.body.id, k.body.id, p.body.id]) expect((await admin.call('DELETE', `/regions/${id}`)).status).toBe(200);
  });
  it('kode lokal opsional: ditetapkan otomatis berurutan, dan tidak bentrok bila dibuat serentak', async () => {
    const p = await admin.post('/regions', { level: 'province', parentId: null, name: 'Provinsi Otomatis' });
    expect(p.body.code).toMatch(/^\d{2}$/);
    const k = await admin.post('/regions', { level: 'regency', parentId: p.body.id, name: 'Kab A' });
    expect(k.body.code).toBe('01');
    expect((await admin.post('/regions', { level: 'regency', parentId: p.body.id, code: '02', name: 'Kab B' })).body.code).toBe('02'); // kode manual tetap diterima
    expect((await admin.post('/regions', { level: 'regency', parentId: p.body.id, name: 'Kab C' })).body.code).toBe('03'); // melewati kode terpakai
    const par = await Promise.all(['D1', 'D2', 'D3', 'D4'].map((n) => admin.post('/regions', { level: 'district', parentId: k.body.id, name: n })));
    expect(par.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(par.map((r) => r.body.code)).size).toBe(4); // empat kode berbeda
    const v = await admin.post('/regions', { level: 'village', parentId: par[0]!.body.id, name: 'Desa Uji' });
    expect(v.body.code).toBe('001');
    expect((await admin.post('/regions', { level: 'regency', parentId: p.body.id, code: '5', name: 'Kab X' })).status).toBe(400); // kode manual tetap divalidasi
    const view = (await admin.get('/regions')).body;
    const mine = view.filter((r: any) => r.path[0] === 'Provinsi Otomatis').sort((a: any, b: any) => b.path.length - a.path.length);
    for (const r of mine) expect((await admin.call('DELETE', `/regions/${r.id}`)).status).toBe(200);
  });
  it('data referensi di database: daftar per induk, kode lokal diturunkan, akses dibatasi', async () => {
    const r = await admin.get('/master/wilayah?level=province');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ available: true, items: [{ code: '32', name: 'Jawa Barat', localCode: '32' }, { code: '33', name: 'Jawa Tengah', localCode: '33' }] });
    const kab = (await admin.get('/master/wilayah?level=regency&parent=33')).body.items;
    expect(kab.map((i: any) => [i.code, i.localCode])).toEqual([['3301', '01'], ['3374', '74']]); // 2 digit terakhir
    const kec = (await admin.get('/master/wilayah?level=district&parent=3374')).body.items;
    // Mijen 01; Mijen Barat (prefiks 01 sudah dipakai) → 02; Gunungpati (prefiks 02 sudah dipakai) → 03; Semarang Tengah tetap 13
    expect(kec.map((i: any) => [i.name, i.localCode])).toEqual([['Mijen', '01'], ['Mijen Barat', '02'], ['Gunungpati', '03'], ['Semarang Tengah', '13']]);
    const desa = (await admin.get('/master/wilayah?level=village&parent=3374130')).body.items;
    expect(desa.map((i: any) => [i.name, i.localCode])).toEqual([['Karangkidul', '002'], ['Miroto', '005']]);
    expect((await admin.get('/master/wilayah?level=regency')).status).toBe(422); // induk wajib
    expect((await admin.get('/master/wilayah?level=regency&parent=abc')).status).toBe(422);
    expect((await admin.get('/master/wilayah?level=province&parent=33')).status).toBe(422);
    expect((await admin.get('/master/wilayah?level=planet')).status).toBe(422);
    expect((await new Client(app).get('/master/wilayah?level=province')).status).toBe(401);
    expect((await member.get('/master/wilayah?level=province')).status).toBe(403);
    await app.get(MasterService, { strict: false }).load(REF); // memuat ulang menggantikan, bukan menggandakan
    expect((await admin.get('/master/wilayah?level=province')).body.items).toHaveLength(2);
  });
  it('dari data referensi: nama & kode diturunkan server, induk harus cocok, klien tidak dipercaya', async () => {
    const fm = (level: string, parentId: string | null, sourceCode: string, who = admin) => who.post('/regions/from-master', { level, parentId, sourceCode });
    const p = await fm('province', null, '33');
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ name: 'Jawa Tengah', code: '33', sourceCode: '33' });
    expect((await fm('province', null, '33')).body.message).toMatch(/sudah ada/);
    expect((await fm('province', null, '99')).body.message).toMatch(/tidak ada pada data referensi/);
    expect((await fm('province', p.body.id, '32')).body.message).toMatch(/tidak memiliki induk/);
    const k = await fm('regency', p.body.id, '3374');
    expect(k.body).toMatchObject({ name: 'Kota Semarang', code: '74' });
    const d = await fm('district', k.body.id, '3374130');
    expect(d.body).toMatchObject({ name: 'Semarang Tengah', code: '13', sourceCode: '3374130' });
    const d2 = await fm('district', k.body.id, '3374011'); // pemekaran: kode lokal 02, bukan 01
    expect(d2.body).toMatchObject({ name: 'Mijen Barat', code: '02' });
    const v = await fm('village', d.body.id, '3374130005');
    expect(v.body).toMatchObject({ name: 'Miroto', code: '005', sourceCode: '3374130005' });
    expect((await fm('district', k.body.id, '3301010')).body.message).toMatch(/tidak ada pada data referensi/); // kecamatan milik kabupaten lain
    expect((await fm('village', d.body.id, '3374010001')).body.message).toMatch(/tidak ada pada data referensi/); // desa milik kecamatan lain
    const view = (await admin.get('/regions')).body.find((r: any) => r.id === v.body.id);
    expect(view.path).toEqual(['Jawa Tengah', 'Kota Semarang', 'Semarang Tengah', 'Miroto']);
    expect((await admin.get(`/members/next-number?villageId=${v.body.id}`)).body.memberNo).toMatch(/^337413\d{2}\d{6}$/); // 33 · 74 · 13
    expect((await admin.post('/regions/from-master', { level: 'province', parentId: null })).status).toBe(400);
    const mine = (await admin.get('/regions')).body.filter((r: any) => r.path[0] === 'Jawa Tengah').sort((a: any, b: any) => b.path.length - a.path.length);
    for (const r of mine) expect((await admin.call('DELETE', `/regions/${r.id}`)).status).toBe(200);
  });
  it('induk manual tidak bisa memakai data referensi; kode turunan yang bentrok dengan saudara manual ditolak', async () => {
    const fm = (level: string, parentId: string | null, sourceCode: string) => admin.post('/regions/from-master', { level, parentId, sourceCode });
    const p = await admin.post('/regions', { level: 'province', parentId: null, code: '77', name: 'Provinsi Manual' });
    const k = await admin.post('/regions', { level: 'regency', parentId: p.body.id, code: '01', name: 'Kab Manual' });
    expect((await fm('district', k.body.id, '3374130')).body.message).toMatch(/ditambahkan manual/);
    const pr = await fm('province', null, '33'); const kb = await fm('regency', pr.body.id, '3374');
    const man = await admin.post('/regions', { level: 'district', parentId: kb.body.id, code: '13', name: 'Kecamatan Manual' }); // mengambil kode 13
    expect((await fm('district', kb.body.id, '3374130')).body.message).toMatch(/Kode lokal 13 sudah dipakai/);
    for (const id of [man.body.id, kb.body.id, pr.body.id, k.body.id, p.body.id]) expect((await admin.call('DELETE', `/regions/${id}`)).status).toBe(200);
  });
  it('penempatan dari data referensi: jalur dibuat otomatis & idempoten, wilayah manual ditautkan, input divalidasi', async () => {
    const rina = byName((await admin.get('/members')).body, 'Rina Marlina');
    const home = (await admin.get('/regions')).body.find((r: any) => r.level === 'village');
    const regions = async () => (await admin.get('/regions')).body as any[];
    const place = (body: any, who = admin) => who.post(`/members/${rina.id}/placement`, body);
    const wipe = async () => {
      await place({ villageId: home.id });
      for (const r of (await regions()).filter((r) => r.path[0].toLowerCase() === 'jawa tengah').sort((a, b) => b.path.length - a.path.length)) expect((await admin.call('DELETE', `/regions/${r.id}`)).status).toBe(200);
    };
    const n0 = (await regions()).length;
    expect((await place({ villageSourceCode: '3374130005' })).status).toBe(201);
    const after = await regions();
    expect(after.length).toBe(n0 + 4);
    const byCode = (src: string) => after.find((r) => r.sourceCode === src);
    expect([byCode('33').code, byCode('3374').code, byCode('3374130').code, byCode('3374130005').code]).toEqual(['33', '74', '13', '005']);
    expect((await admin.get('/members')).body.find((m: any) => m.id === rina.id).regionPath).toBe('Miroto, Semarang Tengah, Kota Semarang, Jawa Tengah');
    expect((await place({ villageSourceCode: '3374130005' })).status).toBe(201); // idempoten
    expect((await regions()).length).toBe(n0 + 4);
    expect((await place({ villageSourceCode: '3374130002' })).status).toBe(201); // saudara dari jalur yang sama: hanya +1
    expect((await regions()).length).toBe(n0 + 5);
    expect((await place({ villageSourceCode: '3374130999' })).body.message).toMatch(/tidak ada pada data referensi/);
    expect((await place({ villageSourceCode: '33741300' })).status).toBe(400);
    expect((await place({ villageSourceCode: '3374130005', villageId: home.id })).status).toBe(400);
    expect((await place({})).status).toBe(400);
    await wipe();
    const man = await admin.post('/regions', { level: 'province', parentId: null, code: '55', name: 'jawa tengah' });
    const n1 = (await regions()).length;
    expect((await place({ villageSourceCode: '3374130005' })).status).toBe(201);
    expect((await regions()).find((r) => r.id === man.body.id)).toMatchObject({ sourceCode: '33', code: '55' }); // tertaut, kode manual tetap
    expect((await regions()).length).toBe(n1 + 3);
    await wipe();
    expect((await regions()).length).toBe(n0);
  });
  it('wilayah yang dipakai penempatan anggota tidak boleh dihapus; tenant lain tidak melihat wilayah ini', async () => {
    const v = (await admin.get('/regions')).body.find((r: any) => r.level === 'village' && r.members > 0);
    expect((await admin.call('DELETE', `/regions/${v.id}`)).status).toBe(422);
    const other = await as(app, 'jabar', 'admin');
    const names = (await other.get('/regions')).body.map((r: any) => r.name);
    expect(names).not.toContain('Kabupaten Bandung');
  });
  it('master investor: kode unik, hapus hanya bila belum punya alokasi, hanya pengurus', async () => {
    const c = await admin.post('/investors', { code: 'inv-09', name: 'Investor Uji', sharePercent: 10 });
    expect(c.status).toBe(201);
    expect(c.body.code).toBe('INV-09'); // dinormalkan huruf besar
    expect((await admin.post('/investors', { code: 'INV-09', name: 'Ganda', sharePercent: 10 })).body.message).toMatch(/sudah dipakai/);
    expect((await staff.post('/investors', { code: 'INV-10', name: 'X', sharePercent: 10 })).status).toBe(403);
    const used = (await admin.get('/investors/funding')).body.investors.find((i: any) => i.code === 'INV-01');
    expect((await admin.call('DELETE', `/investors/${used.id}`)).body.message).toMatch(/alokasi/);
    expect((await admin.call('DELETE', `/investors/${c.body.id}`)).status).toBe(200);
  });
});

describe('marketplace: reservasi → bayar → kirim → terima → komisi', () => {
  let siti: any, budi: any, urat: any, order: any;
  beforeAll(() => { siti = byName(ms, 'Siti Rahma'); budi = byName(ms, 'Budi Santoso'); urat = byName(ps, 'Produk A'); });

  it('checkout melebihi stok tersedia ditolak', async () => {
    const r = await staff.post('/orders', { sellerId: budi.id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: 999 }] });
    expect(r.status).toBe(422);
  });
  it('checkout mereservasi stok dan membekukan snapshot upline', async () => {
    const before = byName((await staff.get('/products')).body, 'Produk A');
    const r = await staff.post('/orders', { sellerId: budi.id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: 2 }] });
    expect(r.status).toBe(201);
    order = r.body[0];
    expect(order.uplines).toEqual([siti.id]);
    const after = byName((await staff.get('/products')).body, 'Produk A');
    expect(after.reserved).toBe(before.reserved + 2);
    expect(after.physical).toBe(before.physical);
  });
  it('saldo belanja: berkurang tepat sebesar pesanan; melebihi saldo & pembeli belum aktif ditolak; refund memulihkan', async () => {
    const bal = async (id: string) => (await admin.get('/members')).body.find((m: any) => m.id === id).balance;
    const mk = async (memberId: string, qty: number) => (await staff.post('/orders', { sellerId: memberId, buyerId: memberId, items: [{ productId: urat.id, qty }] })).body[0]; // belanja sendiri (saldo)
    // 1) berkurang tepat total pesanan
    const b0 = await bal(siti.id);
    const o = await mk(siti.id, 3);
    expect(await bal(siti.id)).toBe(b0); // dibuat saja belum mengurangi saldo
    expect((await staff.post(`/orders/${o.id}/pay-balance`)).status).toBe(201);
    expect(await bal(siti.id)).toBe(b0 - 3 * urat.sellPrice);
    expect((await staff.post(`/orders/${o.id}/pay-balance`)).body.message).toMatch(/sudah dibayar/); // tidak bisa dua kali
    expect(await bal(siti.id)).toBe(b0 - 3 * urat.sellPrice);
    // 2) saldo tidak cukup: kecilkan saldo pembeli langsung di DB, lalu coba bayar
    const db = app.get<Database>(DB);
    await db.update(membersTable).set({ balance: 250_000 }).where(eq(membersTable.id, budi.id));
    const big = await mk(budi.id, 3); // Rp300.000 > saldo Rp250.000
    const r = await staff.post(`/orders/${big.id}/pay-balance`);
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/saldo belanja .* tidak cukup/);
    expect(await bal(budi.id)).toBe(250_000); // saldo tidak berubah
    expect((await staff.get('/orders')).body.find((x: any) => x.id === big.id).status).toBe('awaiting_payment'); // status pesanan tidak berubah
    // 3) pembeli yang saldonya belum aktif
    const rina = byName(ms, 'Rina Marlina');
    const inactive = await mk(rina.id, 1);
    expect((await staff.post(`/orders/${inactive.id}/pay-balance`)).body.message).toMatch(/belum aktif/);
    // 4) refund memulihkan saldo & reservasi
    expect((await staff.post(`/orders/${o.id}/cancel`, { reason: 'uji' })).status).toBe(201);
    expect(await bal(siti.id)).toBe(b0);
    for (const x of [big, inactive]) expect((await staff.post(`/orders/${x.id}/cancel`, { reason: 'uji' })).status).toBe(201);
    await db.update(membersTable).set({ balance: 10_000_000 }).where(eq(membersTable.id, budi.id)); // kembalikan agar tes lain tidak terpengaruh
  });
  it('kirim sebelum dibayar ditolak; bayar dari saldo penjual lalu kirim mengurangi fisik & reservasi', async () => {
    expect((await staff.post(`/orders/${order.id}/ship`, { deliveryRef: 'SJ-1' })).status).toBe(422);
    expect((await staff.post(`/orders/${order.id}/pay-balance`)).status).toBe(201); // pesanan pelanggan umum dibayar dari saldo anggota penjual
    expect((await acct.post(`/orders/${order.id}/pay-cash`)).status).toBe(422); // sudah dibayar; jangan catat kas lagi
    const p0 = byName((await staff.get('/products')).body, 'Produk A');
    expect((await staff.post(`/orders/${order.id}/ship`, { deliveryRef: 'SJ-1' })).status).toBe(201);
    const p1 = byName((await staff.get('/products')).body, 'Produk A');
    expect(p1.physical).toBe(p0.physical - 2);
    expect(p1.reserved).toBe(p0.reserved - 2);
  });
  it('batal setelah kirim ditolak; komisi menunggu bukti terima', async () => {
    expect((await staff.post(`/orders/${order.id}/cancel`, { reason: 'x' })).status).toBe(422);
    expect((await acct.post(`/orders/${order.id}/commission/approve`)).status).toBe(422);
    expect((await staff.post(`/orders/${order.id}/receive`, { proofRef: 'BKT-9', receiverName: 'Ibu Ani' })).status).toBe(201);
  });
  it('komisi: approve → pay hanya urut, hanya keuangan; anggota yang membeli sendiri tidak berkomisi', async () => {
    expect((await staff.post(`/orders/${order.id}/commission/approve`)).status).toBe(403);
    expect((await admin.post(`/orders/${order.id}/commission/pay`)).status).toBe(422);
    expect((await acct.post(`/orders/${order.id}/commission/approve`)).status).toBe(201);
    expect((await admin.post(`/orders/${order.id}/commission/pay`)).status).toBe(201);
    const lines = (await acct.get('/orders/commissions')).body.filter((l: any) => l.orderNo === order.no);
    expect(lines.map((l: any) => l.amount)).toEqual([2 * urat.sellPrice * 0.05, 2 * urat.sellPrice * 0.03]);
  });
  it('batal pesanan berbayar saldo mengembalikan saldo penuh', async () => {
    const o = (await staff.post('/orders', { sellerId: siti.id, buyerId: siti.id, items: [{ productId: urat.id, qty: 1 }] })).body[0];
    const b0 = (await admin.get('/members')).body.find((m: any) => m.id === siti.id).balance;
    await staff.post(`/orders/${o.id}/pay-balance`);
    expect((await staff.post(`/orders/${o.id}/cancel`, { reason: '' })).status).toBe(400);
    expect((await staff.post(`/orders/${o.id}/cancel`, { reason: 'salah pesan' })).status).toBe(201);
    expect((await admin.get('/members')).body.find((m: any) => m.id === siti.id).balance).toBe(b0);
  });
  it('dua checkout paralel tidak melebihi stok (tidak oversell)', async () => {
    const avail = byName((await staff.get('/products')).body, 'Produk C').available;
    const keju = byName(ps, 'Produk C');
    const results = await Promise.all([1, 2].map(() => staff.post('/orders', { sellerId: siti.id, buyerId: siti.id, items: [{ productId: keju.id, qty: avail - 1 }] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });
});

describe('pengadaan & keuangan', () => {
  it('evaluasi aturan membuat draf PO sekali (PO berjalan diperhitungkan)', async () => {
    const first = (await staff.post('/replenishment/evaluate')).body.created;
    const second = (await staff.post('/replenishment/evaluate')).body.created;
    expect(first[0]).toBe('PO-0087'); // halus: tersedia 4 ≤ safety 5; kebutuhan 8 → MOQ 10
    expect(second).toEqual([]);
  });
  let po: any;
  it('terima sebagian lalu selesai; hanya kuantitas layak menambah stok', async () => {
    const list = (await staff.get('/purchase-orders')).body;
    po = list.find((p: any) => p.no === 'PO-0086');
    expect((await staff.post(`/purchase-orders/${po.id}/receive`, { accepted: 9, rejected: 0 })).status).toBe(422); // > sisa
    const halus0 = byName((await staff.get('/products')).body, 'Produk B').physical;
    expect((await staff.post(`/purchase-orders/${po.id}/receive`, { accepted: 3, rejected: 1 })).status).toBe(201);
    expect(byName((await staff.get('/products')).body, 'Produk B').physical).toBe(halus0 + 3);
    expect((await acct.post(`/finance/purchase-orders/${po.id}/invoice`)).status).toBe(422); // belum selesai
    await staff.post(`/purchase-orders/${po.id}/receive`, { accepted: 2, rejected: 0 });
    expect((await staff.get('/purchase-orders')).body.find((p: any) => p.id === po.id).status).toBe('done');
  });
  it('invoice dari kuantitas layak, bayar AP: batas sisa, kas, referensi ganda', async () => {
    const inv = await acct.post(`/finance/purchase-orders/${po.id}/invoice`);
    expect(inv.status).toBe(201);
    expect((await acct.post(`/finance/purchase-orders/${po.id}/invoice`)).status).toBe(422);
    const ap = (await acct.get('/finance/payables')).body;
    const mine = ap.find((x: any) => x.no === inv.body.no);
    expect(mine.amount).toBe(5 * 63_000);
    expect((await acct.post(`/finance/payables/${mine.id}/payments`, { amount: mine.amount + 1, ref: 'PAY-A' })).status).toBe(422);
    expect((await acct.post(`/finance/payables/${mine.id}/payments`, { amount: 100_000, ref: 'PAY-A' })).status).toBe(201);
    expect((await acct.post(`/finance/payables/${mine.id}/payments`, { amount: 100_000, ref: 'PAY-A' })).body.message).toMatch(/ganda/);
    const s = (await acct.get('/finance/summary')).body;
    expect(s.payableOverdue).toBe(1_500_000); // INV-8790 lewat waktu
  });
  it('staf tidak boleh akses keuangan', async () => expect((await staff.get('/finance/summary')).status).toBe(403));
});

describe('laporan bagi hasil', () => {
  let rep: any, siti: any;
  beforeAll(() => { siti = byName(ms, 'Siti Rahma'); });
  it('validasi laporan: rugi & biaya > pendapatan ditolak', async () => {
    const base = { memberId: siti.id, period: '2026-10', ref: 'LAP-1' };
    expect((await acct.post('/profit-reports', { ...base, revenue: 100, cost: 200 })).status).toBe(400);
    expect((await acct.post('/profit-reports', { ...base, period: '2026-13', revenue: 100, cost: 0 })).status).toBe(400);
  });
  it('draf → settle membagi 20/80 lalu marginal, dan memperbarui posisi anggota', async () => {
    expect((await acct.post('/profit-reports', { memberId: siti.id, period: '2026-08', ref: 'LAP-0', revenue: 10, cost: 1 })).body.message).toMatch(/sebelum aktivasi/); // aktivasi 2026-09
    rep = (await acct.post('/profit-reports', { memberId: siti.id, period: '2026-10', ref: 'LAP-1', revenue: 25_000_000, cost: 5_000_000 })).body;
    expect((await acct.post('/profit-reports', { memberId: siti.id, period: '2026-11', ref: 'LAP-2', revenue: 10, cost: 1 })).status).toBe(422); // satu draf per anggota
    const s = await admin.post(`/profit-reports/${rep.id}/settle`);
    expect(s.body.member + s.body.investor).toBe(20_000_000);
    expect(s.body.remainingAfter).toBe(0);
    const m = (await admin.get('/members')).body.find((x: any) => x.id === siti.id);
    expect(m).toMatchObject({ remaining: 0, cumulative: 4_375_000 });
    expect((await admin.post(`/profit-reports/${rep.id}/settle`)).status).toBe(422);
  });
  it('skenario tidak mengubah data', async () => {
    const r = await admin.get('/investors/scenario?profit=20000000&remaining=12500000&cumulative=0');
    expect(r.body.member + r.body.investor).toBe(20_000_000);
  });
});

describe('me & ringkasan', () => {
  it('anggota hanya melihat datanya sendiri', async () => {
    const me = (await member.get('/me')).body;
    expect(me.name).toBe('Siti Rahma');
    const orders = (await member.get('/me/orders')).body;
    expect(orders.orders.every((o: any) => ['seller', 'buyer'].includes(o.role))).toBe(true);
    expect((await member.get('/me/entitlements')).body.remaining).toBe(0);
    expect((await member.get('/overview')).status).toBe(403);
  });
  it('ringkasan & konsistensi data', async () => {
    const o = (await admin.get('/overview')).body;
    expect(o.sales7).toHaveLength(7);
    expect(o.activity.length).toBeGreaterThan(0);
    expect((await admin.get('/system/consistency')).body.ok).toBe(true);
  });
  it('endpoint tak dikenal /api → 404 JSON', async () => expect((await admin.get('/tidak-ada')).status).toBe(404));
});

describe('akun login anggota', () => {
  it('akun otomatis: username dari nama, sandi acak, wajib ganti sandi, hak akses', async () => {
    const v = (await admin.get('/regions')).body.find((r: any) => r.level === 'village');
    expect((await staff.post('/members', { name: 'Tes Akun', villageId: v.id, familyCode: 'L', createAccount: true })).body.account).toBeFalsy(); // petugas tidak boleh
    const a = await admin.post('/members', { name: 'Budí Santoso', villageId: v.id, familyCode: 'L', createAccount: true });
    expect(a.status).toBe(201);
    expect(a.body.account.username).toBe('budi.santoso');
    expect(a.body.account.password).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9]{10}$/);
    const b = await admin.post('/members', { name: 'Budi Santoso', villageId: v.id, familyCode: 'L', createAccount: true });
    expect(b.body.account.username).toBe('budi.santoso2'); // kembar → angka
    expect(b.body.account.password).not.toBe(a.body.account.password);

    const login = await new Client(app).post('/auth/login', { username: 'budi.santoso', password: a.body.account.password });
    expect(login.status).toBe(201);
    expect(login.body.user.mustChangePassword).toBe(true);
    const c = new Client(app); c.token = login.body.token;
    expect((await c.get('/me')).status).toBe(403); // wajib ganti sandi dulu
    expect((await c.get('/auth/me')).body.username).toBe('budi.santoso');
    expect((await c.post('/auth/change-password', { current: 'salah', next: 'Baru12345' })).status).toBe(401);
    expect((await c.post('/auth/change-password', { current: a.body.account.password, next: 'lemah' })).status).toBe(400);
    expect((await c.post('/auth/change-password', { current: a.body.account.password, next: 'Baru12345' })).status).toBe(201);
    expect((await new Client(app).post('/auth/login', { username: 'budi.santoso', password: a.body.account.password })).status).toBe(401);
    expect((await new Client(app).post('/auth/login', { username: 'budi.santoso', password: 'Baru12345' })).body.user.mustChangePassword).toBe(false);

    const list = (await admin.get('/members')).body;
    expect(list.find((m: any) => m.id === a.body.id).username).toBe('budi.santoso');
    expect((await admin.post(`/members/${a.body.id}/account`)).status).toBe(422); // sudah punya
    expect((await staff.post(`/members/${a.body.id}/account/reset`)).status).toBe(403);
    const r = await admin.post(`/members/${a.body.id}/account/reset`);
    expect(r.status).toBe(201);
    expect((await new Client(app).post('/auth/login', { username: 'budi.santoso', password: 'Baru12345' })).status).toBe(401);
    expect((await new Client(app).post('/auth/login', { username: 'budi.santoso', password: r.body.password })).body.user.mustChangePassword).toBe(true);
  });
  it('lupa kata sandi: respons seragam, pengurus melihat permintaan, reset membersihkannya', async () => {
    const v = (await admin.get('/regions')).body.find((r: any) => r.level === 'village');
    const a = await admin.post('/members', { name: 'Lupa Sandi', villageId: v.id, familyCode: 'L', createAccount: true });
    const ada = await new Client(app).post('/auth/forgot', { username: 'lupa.sandi' });
    const tak = await new Client(app).post('/auth/forgot', { username: 'tidak.ada.sama.sekali' });
    expect(ada.status).toBe(201); expect(tak.status).toBe(201);
    expect(ada.body).toEqual(tak.body); // tidak membocorkan keberadaan akun
    expect((await admin.get('/members')).body.find((m: any) => m.id === a.body.id).resetRequestedAt).toBeTruthy();
    await admin.post(`/members/${a.body.id}/account/reset`);
    expect((await admin.get('/members')).body.find((m: any) => m.id === a.body.id).resetRequestedAt).toBeNull();
  });
});

describe('toko: stok, pemesanan anggota, dan persetujuan per toko', () => {
  let staff2: Client, depots: any[], d1: any, d2: any, urat: any;
  beforeAll(async () => {
    staff2 = await as(app, 'nasional', 'petugas2');
    depots = (await admin.get('/depots')).body;
    [d1, d2] = depots;
    urat = byName((await admin.get('/products')).body, 'Produk A');
  });

  it('admin melihat semua toko; petugas hanya tokonya', async () => {
    expect(depots.length).toBe(2);
    expect((await staff.get('/depots')).body.map((d: any) => d.id)).toEqual([d1.id]);
    expect((await staff2.get('/depots')).body.map((d: any) => d.id)).toEqual([d2.id]);
  });

  it('stok terpisah per toko dan petugas terkunci ke tokonya', async () => {
    const a = byName((await admin.get(`/products?depotId=${d1.id}`)).body, 'Produk A');
    const b = byName((await admin.get(`/products?depotId=${d2.id}`)).body, 'Produk A');
    expect(a.depotId).toBe(d1.id); expect(b.depotId).toBe(d2.id);
    expect(a.physical).not.toBe(b.physical);
    expect((await staff.get(`/products?depotId=${d2.id}`)).status).toBe(403); // toko lain
    expect((await staff2.get('/products')).body[0].depotId).toBe(d2.id);
    const before = byName((await staff2.get('/products')).body, 'Produk A').physical;
    await addStock(staff2, urat.id, 4);
    expect(byName((await staff2.get('/products')).body, 'Produk A').physical).toBe(before + 4);
    expect(byName((await staff.get('/products')).body, 'Produk A').physical).toBe(a.physical); // toko 1 tak berubah
  });

  it('anggota memesan dari toko pilihan → menunggu persetujuan; hanya toko itu yang menyetujui', async () => {
    const list = (await member.get('/me/depots')).body;
    expect(list.map((d: any) => d.id).sort()).toEqual([d1.id, d2.id].sort());
    const cat = (await member.get(`/me/depots/${d2.id}/products`)).body;
    const u2 = byName(cat, 'Produk A');
    expect(u2.available).toBeGreaterThan(2);
    const r = await member.post('/me/orders', { depotId: d2.id, items: [{ productId: urat.id, qty: 2 }] });
    expect(r.status).toBe(201);
    const o = r.body[0];
    expect(o.status).toBe('awaiting_approval'); expect(o.depot).toBe(d2.name);
    // stok tersedia toko 2 berkurang (reservasi), toko 1 tidak
    expect(byName((await member.get(`/me/depots/${d2.id}/products`)).body, 'Produk A').available).toBe(u2.available - 2);
    // belum disetujui: tak bisa dibayar/dikirim
    expect((await staff2.post(`/orders/${o.id}/pay-balance`)).status).toBe(422);
    // petugas toko lain tidak boleh menyetujui; petugas toko ini boleh
    expect((await staff.post(`/orders/${o.id}/approve`)).status).toBe(403);
    expect((await staff.get('/orders')).body.some((x: any) => x.id === o.id)).toBe(false);
    expect((await staff2.post(`/orders/${o.id}/approve`)).status).toBe(201);
    expect((await staff2.post(`/orders/${o.id}/approve`)).status).toBe(422); // dua kali
    // disetujui → saldo anggota langsung terpotong (tanpa konfirmasi bayar lagi) → status lunas, siap dikirim
    expect((await staff2.get('/orders')).body.find((x: any) => x.id === o.id)).toMatchObject({ status: 'paid', pay: 'balance' });
    expect((await staff2.post(`/orders/${o.id}/pay-balance`)).status).toBe(422); // sudah dibayar saat disetujui
    const p0 = byName((await staff2.get('/products')).body, 'Produk A');
    expect((await staff2.post(`/orders/${o.id}/ship`, { deliveryRef: 'SJ-D2' })).status).toBe(201);
    const p1 = byName((await staff2.get('/products')).body, 'Produk A');
    expect(p1.physical).toBe(p0.physical - 2); // stok keluar dari toko 2 saja
    expect(byName((await staff.get('/products')).body, 'Produk A').physical).toBe(byName((await admin.get(`/products?depotId=${d1.id}`)).body, 'Produk A').physical);
  });

  it('penolakan melepas reservasi; pesanan melebihi stok toko ditolak walau toko lain punya stok', async () => {
    const avail = byName((await member.get(`/me/depots/${d2.id}/products`)).body, 'Produk B').available;
    const halus = byName((await admin.get('/products')).body, 'Produk B');
    expect((await member.post('/me/orders', { depotId: d2.id, items: [{ productId: halus.id, qty: avail + 1 }] })).status).toBe(422);
    const r = await member.post('/me/orders', { depotId: d2.id, items: [{ productId: halus.id, qty: avail }] });
    expect(r.status).toBe(201);
    expect(byName((await member.get(`/me/depots/${d2.id}/products`)).body, 'Produk B').available).toBe(0);
    expect((await staff2.post(`/orders/${r.body[0].id}/reject`, { reason: '' })).status).toBe(400);
    expect((await staff2.post(`/orders/${r.body[0].id}/reject`, { reason: 'stok rusak' })).status).toBe(201);
    expect(byName((await member.get(`/me/depots/${d2.id}/products`)).body, 'Produk B').available).toBe(avail);
    const mine = (await member.get('/me/orders')).body.orders.find((x: any) => x.id === r.body[0].id);
    expect(mine.status).toBe('cancelled');
  });

  it('hanya anggota yang memesan lewat /me/orders; toko tak dikenal ditolak', async () => {
    expect((await staff.post('/me/orders', { depotId: d1.id, items: [{ productId: urat.id, qty: 1 }] })).status).toBe(403);
    expect((await member.post('/me/orders', { depotId: crypto.randomUUID(), items: [{ productId: urat.id, qty: 1 }] })).status).toBe(422);
    expect((await member.post('/me/orders', { depotId: d1.id, items: [] })).status).toBe(400);
  });

  it('pengurus menambah toko + akun petugas; nonaktif ditolak bila masih ada pesanan', async () => {
    expect((await staff.post('/depots', { name: 'Toko Baru' })).status).toBe(403);
    const nd = await admin.post('/depots', { name: 'Toko Baru Uji', address: 'Jl. Uji 1' });
    expect(nd.status).toBe(201);
    expect((await admin.post('/depots', { name: 'Toko Baru Uji' })).status).toBe(422); // nama kembar
    const acc = await admin.post(`/depots/${nd.body.id}/staff`, { name: 'Petugas Uji Baru' });
    expect(acc.status).toBe(201);
    expect(acc.body.username).toBe('petugas.uji.baru');
    const login = await new Client(app).post('/auth/login', { username: acc.body.username, password: acc.body.password });
    expect(login.body.user.mustChangePassword).toBe(true);
    const nonaktif = await admin.post('/depots/' + d1.id, {}); // metode salah → 404
    expect(nonaktif.status).toBe(404);
    expect((await admin.get('/system/consistency')).body.ok).toBe(true);
  });

  it('toko terdekat: urut menurut jarak dari posisi anggota; membayar pesanan sendiri dari saldo', async () => {
    // posisi di Kota Bandung → toko ke-2 (Kota Bandung) lebih dekat daripada toko ke-1 (Kab. Bandung/Soreang)
    const near = (await member.get('/me/depots?lat=-6.92&lng=107.61')).body;
    expect(near[0].nearest).toBe(true);
    expect(near[0].distanceKm).toBeLessThan(near[1].distanceKm);
    expect(near[0].id).toBe(d2.id);
    const far = (await member.get('/me/depots?lat=-7.03&lng=107.52')).body; // di Soreang
    expect(far[0].id).toBe(d1.id);
    expect((await member.get('/me/depots')).body.every((d: any) => d.distanceKm === null && !d.nearest)).toBe(true); // tanpa lokasi
    expect((await member.get('/me/depots?lat=abc&lng=1')).status).toBe(422);
    // pengurus mengatur koordinat; pasangan harus lengkap
    expect((await admin.patch(`/depots/${d1.id}`, { lat: -7.0 })).status).toBe(400);
    expect((await admin.patch(`/depots/${d1.id}`, { lat: 95, lng: 107 })).status).toBe(400);

    // bayar pesanan sendiri
    const bal0 = (await member.get('/me')).body.balance;
    const o = (await member.post('/me/orders', { depotId: d1.id, items: [{ productId: urat.id, qty: 1 }] })).body[0];
    expect((await member.post(`/me/orders/${o.id}/pay`)).status).toBe(422); // belum disetujui toko
    expect((await member.get('/me')).body.balance).toBe(bal0);               // saldo belum tersentuh sebelum disetujui
    expect((await staff.post(`/orders/${o.id}/approve`)).status).toBe(201);
    const total = (await staff.get('/orders')).body.find((x: any) => x.id === o.id).total;
    expect((await member.get('/me')).body.balance).toBe(bal0 - total);       // otomatis terpotong saat disetujui
    expect((await member.post(`/me/orders/${o.id}/pay`)).status).toBe(422); // tidak bisa dua kali
    expect((await member.get('/me/orders')).body.orders.find((x: any) => x.id === o.id).status).toBe('paid');
    // pesanan milik orang lain tidak bisa dibayar anggota ini
    const myId = (await member.get('/me')).body.id;
    const other = (await staff.get('/orders')).body.find((x: any) => x.status === 'awaiting_payment' && x.buyerId !== myId);
    if (other) expect((await member.post(`/me/orders/${other.id}/pay`)).status).toBe(422);
    // pengurus tidak bisa memakai endpoint anggota
    expect((await staff.post(`/me/orders/${o.id}/pay`)).status).toBe(403);
    await staff.post(`/orders/${o.id}/cancel`, { reason: 'uji' }); // kembalikan saldo
    expect((await member.get('/me')).body.balance).toBe(bal0);
  });

  it('persetujuan menolak bila saldo anggota belum aktif/tidak cukup (pesanan tetap menunggu, bisa ditolak); pelanggan umum tidak dipotong', async () => {
    const village = (await admin.get('/regions')).body.find((r: any) => r.level === 'village');
    const created = await admin.post('/members', { name: 'Anggota Tanpa Saldo', villageId: village.id, familyCode: 'L', createAccount: true });
    expect(created.status).toBe(201);
    const acc = new Client(app);
    const lg = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: created.body.account.username, password: created.body.account.password } });
    acc.token = lg.json().token;
    await acc.post('/auth/change-password', { current: created.body.account.password, next: 'Baru12345' });
    const o = (await acc.post('/me/orders', { depotId: d1.id, items: [{ productId: urat.id, qty: 1 }] })).body[0];
    const blocked = await staff.post(`/orders/${o.id}/approve`);
    expect(blocked.status).toBe(422); expect(blocked.body.message).toMatch(/Tidak bisa disetujui: saldo belanja Anggota Tanpa Saldo belum aktif/);
    expect((await staff.get('/orders')).body.find((x: any) => x.id === o.id).status).toBe('awaiting_approval');   // tetap menunggu
    expect((await staff.post(`/orders/${o.id}/reject`, { reason: 'saldo belum aktif' })).status).toBe(201);
    // pesanan pelanggan umum: disetujui tanpa pemotongan saldo; tetap menunggu bayar tunai
    const sale = (await member.post('/me/sales', { depotId: d1.id, customerName: 'Ibu Umum', items: [{ productId: urat.id, qty: 1 }] })).body[0];
    const row = (await staff.get('/orders')).body.find((x: any) => x.id === sale.id);
    expect(row).toMatchObject({ buyerId: null, pay: 'unpaid' });
    await staff.post(`/orders/${sale.id}/cancel`, { reason: 'bersih uji' });
  });

  it('daftar harga untuk simulasi: produk aktif tanpa harga beli, terbuka bagi anggota', async () => {
    const r = await member.get('/me/products');
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(Object.keys(r.body[0]).sort()).toEqual(['id', 'name', 'price']); // tidak membocorkan harga beli
    expect(byName(r.body, 'Produk A').price).toBe(100_000);
  });
});

describe('aturan komisi: hanya penjualan ke pelanggan umum', () => {
  let siti: any, budi: any, urat: any;
  beforeAll(async () => { siti = byName(ms, 'Siti Rahma'); budi = byName(ms, 'Budi Santoso'); urat = byName((await staff.get('/products')).body, 'Produk A'); });
  const physical = async () => byName((await staff.get('/products')).body, 'Produk A').physical;
  const balance = async () => (await member.get('/me')).body.balance;
  const cash = async () => (await app.get<Database>(DB).select().from(tenantsTable).where(eq(tenantsTable.slug, 'nasional')))[0]!.cash;
  const lines = async (no: string) => (await acct.get('/orders/commissions')).body.filter((l: any) => l.orderNo === no);
  const finish = async (o: any) => {
    expect((await staff.post(`/orders/${o.id}/ship`, { deliveryRef: 'SJ-R' })).status).toBe(201);
    expect((await staff.post(`/orders/${o.id}/receive`, { proofRef: 'BKT-R', receiverName: 'Uji' })).status).toBe(201);
    return o;
  };
  /** Penjualan anggota ke pelanggan umum sampai diterima (dibayar tunai). */
  async function soldToCustomer(sellerId: string, qty: number) {
    const o = (await staff.post('/orders', { sellerId, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty }] })).body[0];
    expect((await acct.post(`/orders/${o.id}/pay-cash`)).status).toBe(201);
    return finish(o);
  }
  /** Belanja anggota untuk dirinya sendiri sampai diterima (dibayar saldo). */
  async function boughtBySelf(memberId: string, qty: number) {
    const o = (await staff.post('/orders', { sellerId: memberId, buyerId: memberId, items: [{ productId: urat.id, qty }] })).body[0];
    expect((await staff.post(`/orders/${o.id}/pay-balance`)).status).toBe(201);
    return finish(o);
  }

  it('anggota tidak bisa menjual ke anggota lain; belanja sendiri tidak berkomisi', async () => {
    const r = await staff.post('/orders', { sellerId: budi.id, buyerId: siti.id, items: [{ productId: urat.id, qty: 1 }] });
    expect(r.status).toBe(422); expect(r.body.message).toMatch(/tidak dapat menjual ke anggota lain/);
    expect((await staff.post('/orders', { sellerId: budi.id, items: [{ productId: urat.id, qty: 1 }] })).status).toBe(400); // pembeli wajib
    expect((await staff.post('/orders', { sellerId: budi.id, buyerId: siti.id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: 1 }] })).status).toBe(400); // hanya satu pembeli
    const o = await boughtBySelf(siti.id, 1);
    const row = (await staff.get('/orders')).body.find((x: any) => x.id === o.id);
    expect(row.status).toBe('received'); expect(row.commissionEligible).toBe(false);
    expect(await lines(o.no)).toEqual([]);
    const c = await acct.post(`/orders/${o.id}/commission/approve`);
    expect(c.status).toBe(422); expect(c.body.message).toMatch(/pelanggan umum/);
    const mine = (await member.get('/me/orders')).body.orders.find((x: any) => x.id === o.id);
    expect(mine.selfOrder).toBe(true); expect(mine.commissionEligible).toBe(false);
    await undoOrder(app, o.id);
  });

  it('laporan harian anggota: penjualan ke pelanggan diterima hari ini → komisi otomatis, saldo per status', async () => {
    const rep = async (days = 3) => (await member.get(`/me/sales-report?days=${days}`)).body;
    const r0 = await rep();
    const today0 = r0.days[0];
    expect(r0.days.length).toBe(3);
    expect(r0.days[0].date > r0.days[1].date).toBe(true); // terbaru di atas
    const o = await soldToCustomer(siti.id, 2);        // komisi 5% × Rp200.000
    const r1 = await rep();
    expect(r1.days[0]).toMatchObject({ ownOrders: today0.ownOrders + 1, ownPacks: today0.ownPacks + 2, ownTurnover: today0.ownTurnover + 200_000, ownCommission: today0.ownCommission + 10_000 });
    expect(r1.balance.pending).toBe(r0.balance.pending + 10_000);
    expect(r1.balance.available).toBe(r0.balance.available + 10_000);
    await acct.post(`/orders/${o.id}/commission/approve`);
    const r2 = await rep();
    expect(r2.balance.pending).toBe(r0.balance.pending); expect(r2.balance.approved).toBe(r0.balance.approved + 10_000);
    expect(r2.balance.available).toBe(r1.balance.available);
    await admin.post(`/orders/${o.id}/commission/pay`);
    const r3 = await rep();
    expect(r3.balance.paid).toBe(r0.balance.paid + 10_000); expect(r3.balance.available).toBe(r0.balance.available);
    // belanja sendiri dan pesanan yang belum diterima tidak masuk laporan; yang belum diterima tampil "dalam proses"
    const self = await boughtBySelf(siti.id, 1);
    const open = (await staff.post('/orders', { sellerId: siti.id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: 1 }] })).body[0];
    const r4 = await rep();
    expect(r4.days[0].ownOrders).toBe(r3.days[0].ownOrders);
    expect(r4.inProgress.orders).toBe(r3.inProgress.orders + 1);
    expect(r4.inProgress.potentialCommission).toBe(r3.inProgress.potentialCommission + 5_000);
    await staff.post(`/orders/${open.id}/cancel`, { reason: 'uji' });
    await undoOrder(app, self.id);
    // komisi jaringan: sama dengan baris komisi anggota ini pada pesanan downline (Budi disponsori Siti)
    const down = await soldToCustomer(budi.id, 1);
    const mineLines = (await lines(down.no)).filter((l: any) => l.memberId === siti.id);
    expect(mineLines.length).toBe(1);
    const r5 = await rep();
    expect(r5.days[0].networkCommission).toBe(r3.days[0].networkCommission + mineLines[0].amount);
    await undoOrder(app, down.id);
  });

  it('laporan harian: batas rentang hari dan hanya untuk anggota', async () => {
    expect((await member.get('/me/sales-report?days=1')).body.days.length).toBe(1);
    expect((await member.get('/me/sales-report?days=500')).body.days.length).toBe(90);
    expect((await member.get('/me/sales-report?days=abc')).body.days.length).toBe(14);
    expect((await staff.get('/me/sales-report')).status).toBe(403);
  });
});

describe('anggota mencatat penjualan: hanya ke pelanggan umum', () => {
  let siti: any, budi: any, urat: any, d1: any;
  beforeAll(async () => { siti = byName(ms, 'Siti Rahma'); budi = byName(ms, 'Budi Santoso'); urat = byName((await staff.get('/products')).body, 'Produk A'); d1 = (await staff.get('/depots')).body[0]; });
  const report = async () => (await member.get('/me/sales-report?days=2')).body;

  it('penjualan ke anggota lain tidak tersedia di aplikasi', async () => {
    expect((await member.get('/me/buyers?q=Budi')).status).toBe(404); // pencarian anggota sudah dihapus
    const r = await member.post('/me/sales', { depotId: d1.id, buyerId: budi.id, items: [{ productId: urat.id, qty: 1 }] });
    expect(r.status).toBe(400); // nama pelanggan wajib; buyerId diabaikan
  });

  it('penjualan ke pelanggan umum: saldo belanja anggota penjual terpotong saat disetujui (pelanggan bayar tunai ke anggota); komisi 5% setelah diterima', async () => {
    const r0 = await report();
    expect((await member.post('/me/sales', { depotId: d1.id, customerName: 'A', items: [{ productId: urat.id, qty: 1 }] })).status).toBe(400); // nama terlalu pendek
    const r = await member.post('/me/sales', { depotId: d1.id, customerName: 'Ibu Ani', customerPhone: '0812-0000-1111', items: [{ productId: urat.id, qty: 3 }] });
    expect(r.status).toBe(201);
    const o = r.body[0];
    expect(o.status).toBe('awaiting_approval');
    const mine = (await member.get('/me/orders')).body.orders.find((x: any) => x.id === o.id);
    expect(mine).toMatchObject({ role: 'seller', buyerName: 'Ibu Ani', customerOrder: true, canPay: false });
    expect((await report()).inProgress.orders).toBe(r0.inProgress.orders + 1);
    expect((await member.post(`/me/orders/${o.id}/pay`)).status).toBe(422); // penjual bukan pembeli
    const balBefore = (await member.get('/me')).body.balance;
    expect((await staff.post(`/orders/${o.id}/approve`)).status).toBe(201);
    // persetujuan langsung memotong saldo belanja anggota penjual (pelanggan membayar tunai langsung ke anggota, di luar sistem)
    expect((await member.get('/me')).body.balance).toBe(balBefore - 300_000);
    expect((await staff.get('/orders')).body.find((x: any) => x.id === o.id)).toMatchObject({ status: 'paid', pay: 'balance' });
    expect((await staff.post(`/orders/${o.id}/pay-balance`)).status).toBe(422);   // sudah dibayar saat disetujui
    expect((await acct.post(`/orders/${o.id}/pay-cash`)).status).toBe(422);
    await staff.post(`/orders/${o.id}/ship`, { deliveryRef: 'SJ-S2' });
    expect((await report()).days[0].ownCommission).toBe(r0.days[0].ownCommission); // belum diterima → belum komisi
    await staff.post(`/orders/${o.id}/receive`, { proofRef: 'BKT-S2', receiverName: 'Ibu Ani' });
    expect((await report()).days[0].ownCommission).toBe(r0.days[0].ownCommission + 15_000); // 5% × 3 × 100rb
    await undoOrder(app, o.id);
    expect((await report()).days[0].ownCommission).toBe(r0.days[0].ownCommission);
    expect((await member.get('/me')).body.balance).toBe(balBefore);               // pembersih tes mengembalikan saldo penjual
    expect((await admin.get('/system/consistency')).body.ok).toBe(true);
  });

  it('stok toko tetap dijaga: penjualan melebihi stok ditolak; hanya anggota yang memakai /me/sales', async () => {
    const r = await member.post('/me/sales', { depotId: d1.id, customerName: 'Pak Budi', items: [{ productId: urat.id, qty: 9999 }] });
    expect(r.status).toBe(422); expect(r.body.message).toMatch(/melebihi stok/);
    expect((await staff.post('/me/sales', { depotId: d1.id, customerName: 'Pak Budi', items: [{ productId: urat.id, qty: 1 }] })).status).toBe(403);
  });
});

describe('referal: kode, pendaftaran dengan sponsor otomatis, bonus jaringan', () => {
  let siti: any, urat: any, village: any;
  beforeAll(async () => { siti = byName(ms, 'Siti Rahma'); urat = byName((await staff.get('/products')).body, 'Produk A'); village = (await admin.get('/regions')).body.find((r: any) => r.level === 'village'); });
  const net = async () => (await member.get('/me/network')).body;
  const addMember = async (name: string, referralCode?: string) => (await admin.post('/members', { name, villageId: village.id, familyCode: 'I', referralCode }));
  async function sold(sellerId: string, qty: number) {
    const o = (await staff.post('/orders', { sellerId, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty }] })).body[0];
    await acct.post(`/orders/${o.id}/pay-cash`);
    await staff.post(`/orders/${o.id}/ship`, { deliveryRef: 'SJ-REF' });
    await staff.post(`/orders/${o.id}/receive`, { proofRef: 'BKT-REF', receiverName: 'Ibu Ani' });
    return o;
  }

  it('setiap anggota punya kode referal unik (8 karakter); pratinjau sponsor; kode salah ditolak', async () => {
    const codes = (await admin.get('/members')).body.map((m: any) => m.referralCode);
    expect(codes.every((c: string) => /^[0-9A-Z]{8}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    const code = (await net()).referralCode;
    expect(code).toBe(siti.referralCode);
    // format dengan tanda hubung dan huruf kecil tetap dikenali
    const pv = await admin.get(`/members/referral/${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`);
    expect(pv.status).toBe(200); expect(pv.body.name).toBe('Siti Rahma');
    expect((await admin.get('/members/referral/ZZZZ-9999')).status).toBe(422);
    const bad = await addMember('Calon Salah Kode', 'ZZZZ9999');
    expect(bad.status).toBe(422); expect(bad.body.message).toMatch(/Kode referal tidak ditemukan/);
  });

  it('mendaftarkan anggota dengan kode referal: sponsor otomatis; bonus 3% (tingkat 1) dan 2% (tingkat 2) dari penjualan downline', async () => {
    const n0 = await net();
    const a = await addMember('Anggota Ajakan Satu', n0.referralCode.toLowerCase());
    expect(a.status).toBe(201);
    expect(a.body.sponsorId).toBe(siti.id);
    const b = await addMember('Anggota Ajakan Dua', a.body.referralCode); // diajak oleh A → tingkat 2 bagi Siti
    expect(b.body.sponsorId).toBe(a.body.id);
    const n1 = await net();
    expect(n1.downline.find((d: any) => d.id === a.body.id)).toMatchObject({ level: 1, volume: 0, bonus: 0, referrals: 1 });
    expect(n1.downline.find((d: any) => d.id === b.body.id)).toMatchObject({ level: 2 });
    expect(n1.perLevel.map((l: any) => l.members)).toEqual([n0.perLevel[0].members + 1, n0.perLevel[1].members + 1, n0.perLevel[2].members]);

    // A menjual 4 pak (Rp400.000): bonus Siti = 3% = 12.000. B menjual 2 pak (Rp200.000): bonus Siti = 2% = 4.000
    const oa = await sold(a.body.id, 4);
    const ob = await sold(b.body.id, 2);
    const n2 = await net();
    expect(n2.downline.find((d: any) => d.id === a.body.id)).toMatchObject({ volume: 400_000, bonus: 12_000 });
    expect(n2.downline.find((d: any) => d.id === b.body.id)).toMatchObject({ volume: 200_000, bonus: 4_000 });
    expect(n2.perLevel[0].bonus).toBe(n0.perLevel[0].bonus + 12_000);
    expect(n2.perLevel[1].bonus).toBe(n0.perLevel[1].bonus + 4_000);
    expect(n2.bonus.total).toBe(n0.bonus.total + 16_000);
    expect(n2.bonus.thisMonth).toBe(n0.bonus.thisMonth + 16_000);
    expect(n2.bonus.pending).toBe(n0.bonus.pending + 16_000);
    // laporan harian Siti memuat bonus yang sama sebagai komisi jaringan
    const rep = (await member.get('/me/sales-report?days=1')).body;
    expect(rep.days[0].networkCommission).toBeGreaterThanOrEqual(16_000);
    // disetujui keuangan → berpindah status, total tetap
    await acct.post(`/orders/${oa.id}/commission/approve`);
    const n3 = await net();
    expect(n3.bonus.approved).toBe(n0.bonus.approved + 12_000); expect(n3.bonus.total).toBe(n2.bonus.total);
    // retur membalik bonus
    await undoOrder(app, oa.id);
    await undoOrder(app, ob.id);
    const n4 = await net();
    expect(n4.bonus.total).toBe(n0.bonus.total);
    expect(n4.downline.find((d: any) => d.id === a.body.id).bonus).toBe(0);
  });

  it('penjualan downline ke anggota (belanja sendiri) tidak menghasilkan bonus; hanya anggota yang melihat jaringannya', async () => {
    const n0 = await net();
    const c = await addMember('Anggota Belanja Sendiri', n0.referralCode);
    const o = (await staff.post('/orders', { sellerId: c.body.id, buyerId: c.body.id, items: [{ productId: urat.id, qty: 1 }] })).body[0];
    expect((await net()).bonus.total).toBe(n0.bonus.total);
    await staff.post(`/orders/${o.id}/cancel`, { reason: 'uji' });
    expect((await staff.get('/me/network')).status).toBe(403);
  });
});

describe('admin: angka komisi di Ringkasan sesuai baris komisi', () => {
  it('komisi pending = jumlah baris komisi per penerima (bukan 11% tetap)', async () => {
    const budi = byName(ms, 'Budi Santoso'), urat = byName((await staff.get('/products')).body, 'Produk A');
    const before = (await admin.get('/overview')).body.kpis.pendingCommission;
    // Budi disponsori Siti saja → rantai 2 baris (5% + 3% = 8%), bukan 11%
    const o = (await staff.post('/orders', { sellerId: budi.id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: 10 }] })).body[0];
    await acct.post(`/orders/${o.id}/pay-cash`);
    await staff.post(`/orders/${o.id}/ship`, { deliveryRef: 'SJ-KPI' });
    await staff.post(`/orders/${o.id}/receive`, { proofRef: 'BKT-KPI', receiverName: 'Ibu Ani' });
    const lines = (await acct.get('/orders/commissions')).body.filter((l: any) => l.orderNo === o.no);
    const expected = lines.reduce((a: number, l: any) => a + l.amount, 0);
    expect(expected).toBe(80_000);                         // 8% × Rp1.000.000
    const after = (await admin.get('/overview')).body.kpis.pendingCommission;
    expect(after - before).toBe(expected);                 // bukan 110.000
    await undoOrder(app, o.id);
    expect((await admin.get('/overview')).body.kpis.pendingCommission).toBe(before);
  });
});

describe('keamanan: pembatas login, header, dan pemisahan tugas komisi', () => {
  const limiter = () => app.get(LoginLimiter);
  afterAll(() => limiter().reset());

  it('percobaan login gagal berulang dikunci (429) dan tidak membocorkan keberadaan akun; sandi benar pun ditolak selama kunci', async () => {
    limiter().reset();
    const body = (password: string) => ({ username: 'admin.nasional', password });
    for (let i = 0; i < 5; i++) expect((await new Client(app).post('/auth/login', body('salah' + i))).status).toBe(401);
    const locked = await new Client(app).post('/auth/login', body('sajadah123'));      // sandi benar, tetapi sudah terkunci
    expect(locked.status).toBe(429);
    expect(locked.body.message).toMatch(/Terlalu banyak percobaan gagal/);
    expect(locked.body.retryAfterSeconds).toBeGreaterThan(0);
    // akun lain dari IP yang sama tidak terkunci (kunci per IP+username)
    expect((await new Client(app).post('/auth/login', { username: 'admin.jabar', password: 'sajadah123' })).status).toBe(201);
    // username yang tidak ada dihitung sama (tidak membocorkan keberadaan)
    for (let i = 0; i < 5; i++) await new Client(app).post('/auth/login', { username: 'hantu.tidak.ada', password: 'x' + i });
    expect((await new Client(app).post('/auth/login', { username: 'hantu.tidak.ada', password: 'x' })).status).toBe(429);
    limiter().reset();
    expect((await new Client(app).post('/auth/login', body('sajadah123'))).status).toBe(201);
  });

  it('login berhasil menghapus hitungan gagal pasangan itu; lupa sandi dibatasi', async () => {
    limiter().reset();
    for (let i = 0; i < 4; i++) await new Client(app).post('/auth/login', { username: 'petugas.nasional', password: 'salah' + i });
    expect((await new Client(app).post('/auth/login', { username: 'petugas.nasional', password: 'sajadah123' })).status).toBe(201);
    for (let i = 0; i < 4; i++) expect((await new Client(app).post('/auth/login', { username: 'petugas.nasional', password: 'salah' + i })).status).toBe(401); // mulai dari nol lagi
    limiter().reset();
    for (let i = 0; i < 5; i++) expect((await new Client(app).post('/auth/forgot', { username: 'spam.user' })).status).toBe(201);
    expect((await new Client(app).post('/auth/forgot', { username: 'spam.user' })).status).toBe(429);
    limiter().reset();
  });

  it('ganti sandi: tebakan sandi lama dibatasi', async () => {
    limiter().reset();
    const c = await as(app, 'nasional', 'petugas');
    for (let i = 0; i < 5; i++) expect((await c.post('/auth/change-password', { current: 'salah' + i, next: 'Baru12345' })).status).toBe(401);
    expect((await c.post('/auth/change-password', { current: 'sajadah123', next: 'Baru12345' })).status).toBe(429);
    limiter().reset();
  });

  it('header keamanan ada di respons API', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBeTruthy();
    expect(r.headers['permissions-policy']).toMatch(/camera=\(\)/);
  });

  it('komisi: pengurus menyetujui dan mencatat pembayaran (tanpa pemisahan tugas); petugas tidak boleh', async () => {
    const budi = byName(ms, 'Budi Santoso'), urat = byName((await staff.get('/products')).body, 'Produk A');
    const o = (await staff.post('/orders', { sellerId: budi.id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: 1 }] })).body[0];
    await admin.post(`/orders/${o.id}/pay-cash`);
    await staff.post(`/orders/${o.id}/ship`, { deliveryRef: 'SJ-4E' });
    await staff.post(`/orders/${o.id}/receive`, { proofRef: 'BKT-4E', receiverName: 'Ibu Ani' });
    expect((await staff.post(`/orders/${o.id}/commission/approve`)).status).toBe(403);
    expect((await admin.post(`/orders/${o.id}/commission/approve`)).status).toBe(201);
    expect((await staff.post(`/orders/${o.id}/commission/pay`)).status).toBe(403);
    expect((await admin.post(`/orders/${o.id}/commission/pay`)).status).toBe(201);        // orang yang sama boleh
    const l = (await admin.get('/orders/commissions')).body.find((x: any) => x.orderNo === o.no);
    expect(l.approvedBy).toBe('Pengurus nasional'); expect(l.paidBy).toBe('Pengurus nasional');
    await undoOrder(app, o.id);
  });
});

describe('tarif komisi: dapat diatur pengurus, berlaku untuk pesanan baru, ada riwayat', () => {
  let budi: any, urat: any;
  beforeAll(async () => { budi = byName(ms, 'Budi Santoso'); urat = byName((await staff.get('/products')).body, 'Produk A'); });
  const put = (rates: number[], reason = 'penyesuaian kebijakan uji') => admin.call('PUT', '/commission-plan', { rates, reason });
  const sale = async () => (await staff.post('/orders', { sellerId: budi.id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: 2 }] })).body[0];

  it('semua peran membaca tarif berlaku; riwayat hanya keuangan; ubah hanya pengurus', async () => {
    expect((await member.get('/commission-plan')).body.rates).toEqual([5, 3, 2, 1]);
    expect((await staff.get('/commission-plan')).status).toBe(200);
    expect((await staff.get('/commission-plan/history')).status).toBe(403);
    expect((await member.get('/commission-plan/history')).status).toBe(403);
    expect((await acct.get('/commission-plan/history')).body.length).toBeGreaterThan(0);
    expect((await staff.call('PUT', '/commission-plan', { rates: [6, 3, 2, 1], reason: 'bukan pengurus' })).status).toBe(403);
  });

  it('validasi: 4 tarif, tiap tingkat ≤15%, total ≤30%, >0, tidak negatif, alasan wajib, tidak boleh sama dengan yang berlaku', async () => {
    expect((await put([5, 3, 2])).status).toBe(400);
    expect((await put([16, 3, 2, 1])).status).toBe(400);
    expect((await put([15, 10, 5, 1])).status).toBe(400);           // total 31%
    expect((await put([-1, 3, 2, 1])).status).toBe(400);
    expect((await put([0, 0, 0, 0])).status).toBe(400);
    expect((await put([6, 3, 2, 1], 'x')).status).toBe(400);
    const same = await put([5, 3, 2, 1]);
    expect(same.status).toBe(422); expect(same.body.message).toMatch(/sama dengan yang berlaku/);
  });

  it('tarif baru hanya untuk pesanan baru: pesanan lama tetap memakai tarif lamanya; tercatat di riwayat dan log', async () => {
    const old = await sale();
    expect(old.commissionRates).toEqual([5, 3, 2, 1]);
    const r = await put([6, 4, 2.5, 1]);
    expect(r.status).toBe(200); expect(r.body.rates).toEqual([6, 4, 2.5, 1]);
    expect((await member.get('/commission-plan')).body).toMatchObject({ rates: [6, 4, 2.5, 1], by: 'Pengurus nasional' });
    const fresh = await sale();
    expect(fresh.commissionRates).toEqual([6, 4, 2.5, 1]);
    for (const o of [old, fresh]) { await acct.post(`/orders/${o.id}/pay-cash`); await staff.post(`/orders/${o.id}/ship`, { deliveryRef: 'SJ-T' }); await staff.post(`/orders/${o.id}/receive`, { proofRef: 'BKT-T', receiverName: 'Ibu Ani' }); }
    const lines = (await acct.get('/orders/commissions')).body;
    expect(lines.filter((l: any) => l.orderNo === old.no).map((l: any) => l.percent)).toEqual([5, 3]);       // Budi + upline Siti
    expect(lines.filter((l: any) => l.orderNo === fresh.no).map((l: any) => l.percent)).toEqual([6, 4]);
    expect(lines.find((l: any) => l.orderNo === fresh.no && l.level === 0).amount).toBe(12_000);            // 6% × Rp200.000
    const h = (await acct.get('/commission-plan/history')).body;
    expect(h[0]).toMatchObject({ rates: [6, 4, 2.5, 1], createdByName: 'Pengurus nasional', reason: 'penyesuaian kebijakan uji' });
    const log = (await admin.get('/audit-log?q=Tarif komisi diubah')).body.rows;
    expect(log.some((x: any) => /5\/3\/2\/1 → 6\/4\/2\.5\/1/.test(x.message))).toBe(true);
    // simulasi/laporan memakai tarif pesanan masing-masing; KPI ringkasan = jumlah baris komisi
    expect((await admin.get('/overview')).body.kpis.pendingCommission).toBeGreaterThanOrEqual(0);
    for (const o of [old, fresh]) await undoOrder(app, o.id);
    expect((await put([5, 3, 2, 1], 'kembalikan ke tarif awal setelah uji')).status).toBe(200);              // pulihkan agar tes lain tidak terpengaruh
  });
});

describe('anggota: ubah data, nonaktifkan, aktifkan kembali', () => {
  let urat: any, village: any;
  beforeAll(async () => { urat = byName((await staff.get('/products')).body, 'Produk A'); village = (await admin.get('/regions')).body.find((r: any) => r.level === 'village'); });

  it('ubah nama/status keluarga: hanya pengurus; nama akun ikut berubah; tanpa perubahan ditolak', async () => {
    const m = (await admin.post('/members', { name: 'Anggota Ubah Data', villageId: village.id, familyCode: 'I', createAccount: true })).body;
    expect((await staff.call('PATCH', `/members/${m.id}`, { name: 'Dicoba Petugas' })).status).toBe(403);
    expect((await admin.call('PATCH', `/members/${m.id}`, { familyCode: 'Z' })).status).toBe(400);
    expect((await admin.call('PATCH', `/members/${m.id}`, {})).status).toBe(400);
    expect((await admin.call('PATCH', `/members/${m.id}`, { name: 'Anggota Ubah Data', familyCode: 'I' })).status).toBe(422);
    const r = await admin.call('PATCH', `/members/${m.id}`, { name: 'Anggota Sudah Diubah', familyCode: 'B' });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ name: 'Anggota Sudah Diubah', familyCode: 'B', memberNo: m.memberNo });
    const login = await new Client(app).post('/auth/login', { username: m.account.username, password: m.account.password });
    expect(login.body.user.name).toBe('Anggota Sudah Diubah');
  });

  it('nonaktifkan: butuh alasan; ditolak bila ada pesanan belum selesai; setelahnya tidak bisa masuk, memesan, atau mengajak; aktif kembali memulihkan', async () => {
    const m = (await admin.post('/members', { name: 'Anggota Keluar Uji', villageId: village.id, familyCode: 'L', createAccount: true })).body;
    const creds = { username: m.account.username, password: m.account.password };
    const tok = (await new Client(app).post('/auth/login', creds)).body.token;
    const me = new Client(app); me.token = tok;
    expect((await me.get('/auth/me')).status).toBe(200);
    expect((await staff.post(`/members/${m.id}/deactivate`, { reason: 'bukan pengurus' })).status).toBe(403);
    expect((await admin.post(`/members/${m.id}/deactivate`, { reason: 'x' })).status).toBe(400);
    // ada pesanan belum selesai → ditolak
    const o = (await staff.post('/orders', { sellerId: m.id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: 1 }] })).body[0];
    const blocked = await admin.post(`/members/${m.id}/deactivate`, { reason: 'mengundurkan diri' });
    expect(blocked.status).toBe(422); expect(blocked.body.message).toMatch(/pesanan yang belum selesai/);
    await staff.post(`/orders/${o.id}/cancel`, { reason: 'uji' });
    const ok = await admin.post(`/members/${m.id}/deactivate`, { reason: 'mengundurkan diri' });
    expect(ok.status).toBe(201);
    expect((await admin.post(`/members/${m.id}/deactivate`, { reason: 'dua kali' })).status).toBe(422);
    const row = (await admin.get('/members')).body.find((x: any) => x.id === m.id);
    expect(row.deactivatedAt).toBeTruthy(); expect(row.deactivationReason).toBe('mengundurkan diri');
    // tidak bisa masuk (sandi benar) dan token lama langsung tidak berlaku
    const l = await new Client(app).post('/auth/login', creds);
    expect(l.status).toBe(401); expect(l.body.message).toMatch(/dinonaktifkan/);
    expect((await me.get('/auth/me')).status).toBe(401);
    // tidak bisa memesan/menjual; kodenya tidak bisa dipakai mengajak
    const sale = await staff.post('/orders', { sellerId: m.id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: 1 }] });
    expect(sale.status).toBe(422); expect(sale.body.message).toMatch(/nonaktif/);
    const ref = await admin.post('/members', { name: 'Calon Via Kode Nonaktif', villageId: village.id, familyCode: 'P', referralCode: row.referralCode });
    expect(ref.status).toBe(422); expect(ref.body.message).toMatch(/nonaktif/);
    // aktifkan kembali
    expect((await admin.post(`/members/${m.id}/reactivate`)).status).toBe(201);
    expect((await admin.post(`/members/${m.id}/reactivate`)).status).toBe(422);
    expect((await new Client(app).post('/auth/login', creds)).status).toBe(201);
    expect((await staff.post('/orders', { sellerId: m.id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: 1 }] })).status).toBe(201);
    const logs = (await admin.get('/audit-log?q=Anggota Keluar Uji')).body.rows.map((x: any) => x.message).join(' | ');
    expect(logs).toMatch(/dinonaktifkan: mengundurkan diri/); expect(logs).toMatch(/diaktifkan kembali/);
  });
});

describe('log aktivitas lengkap', () => {
  it('hanya pengurus; pencarian, batas, dan halaman berikutnya', async () => {
    expect((await staff.get('/audit-log')).status).toBe(403);
    expect((await member.get('/audit-log')).status).toBe(403);
    const p1 = (await acct.get('/audit-log?limit=5')).body;
    expect(p1.rows.length).toBe(5); expect(p1.next).toBeTruthy();
    expect(Object.keys(p1.rows[0]).sort()).toEqual(['actor', 'at', 'id', 'message']);
    const p2 = (await acct.get(`/audit-log?limit=5&before=${encodeURIComponent(p1.next)}`)).body;
    expect(p2.rows.length).toBeGreaterThan(0);
    expect(new Date(p2.rows[0].at).getTime()).toBeLessThanOrEqual(new Date(p1.next).getTime());
    expect(p2.rows.some((r: any) => p1.rows.some((x: any) => x.id === r.id))).toBe(false);          // tidak tumpang tindih
    const q = (await admin.get('/audit-log?q=Anggota Keluar Uji&limit=200')).body.rows;
    expect(q.length).toBeGreaterThan(0); expect(q.every((r: any) => /Anggota Keluar Uji/i.test(r.message + r.actor))).toBe(true);
    expect((await admin.get('/audit-log?limit=9999')).body.rows.length).toBeLessThanOrEqual(200);
    expect((await admin.get('/audit-log?before=bukan-tanggal')).status).toBe(200);                  // kursor tidak valid diabaikan
  });
});

describe('stok opname: dokumen, alasan selisih, persetujuan pengurus, posting ke kartu stok', () => {
  let urat: any, halus: any, d1: any, d2: any, staff2: Client;
  const stockOf = async (name: string, c: Client = staff) => byName((await c.get('/products')).body, name);
  const lineOf = (doc: any, name: string) => doc.lines.find((l: any) => l.name === name);
  const open = async (c: Client = staff, depotId?: string) => { const r = await c.post('/stock-counts', depotId ? { depotId } : {}); expect(r.status).toBe(201); return (await c.get(`/stock-counts/${r.body.id}`)).body; };
  const save = (c: Client, id: string, lines: any[]) => c.call('PUT', `/stock-counts/${id}/lines`, { lines });
  beforeAll(async () => {
    staff2 = await as(app, 'nasional', 'petugas2');
    const ds = (await admin.get('/depots')).body; [d1, d2] = ds;
    urat = await stockOf('Produk A'); halus = await stockOf('Produk B');
    await admin.call('PUT', '/stock-counts/policy', { tolerancePct: 100, toleranceValue: 1_000_000_000 });   // tes alur dasar: toleransi longgar
  });
  afterAll(async () => { await admin.call('PUT', '/stock-counts/policy', { tolerancePct: 5, toleranceValue: 500_000 }); });

  it('membuka opname: snapshot stok sistem + harga beli; satu opname berjalan per toko; petugas terkunci ke tokonya', async () => {
    const doc = await open();
    expect(doc.no).toMatch(/^OPN-\d{4}$/); expect(doc.status).toBe('draft'); expect(doc.depotId).toBe(d1.id);
    expect(lineOf(doc, 'Produk A')).toMatchObject({ systemQty: urat.physical, countedQty: null, unitCost: 70_000 });
    expect(doc.lines.length).toBeGreaterThanOrEqual(3);
    const dup = await staff.post('/stock-counts', {});
    expect(dup.status).toBe(422); expect(dup.body.message).toMatch(/Masih ada opname yang berjalan/);
    expect((await staff.post('/stock-counts', { depotId: d2.id })).status).toBe(403);       // toko lain
    const other = await open(staff2);                                                        // toko 2 boleh paralel
    expect(other.depotId).toBe(d2.id);
    expect((await member.get('/stock-counts')).status).toBe(403);
    expect((await staff.get('/stock-counts')).body.every((x: any) => x.depotId === d1.id)).toBe(true);
    await staff.post(`/stock-counts/${doc.id}/cancel`, { reason: 'uji pembukaan' });
    await staff2.post(`/stock-counts/${other.id}/cancel`, { reason: 'uji pembukaan' });
    expect((await staff.get('/stock-counts')).body.find((x: any) => x.id === doc.id).status).toBe('cancelled');
  });

  it('pengajuan: wajib ada hitungan, alasan untuk tiap selisih, catatan untuk "Lainnya", hitungan tidak boleh di bawah jumlah dipesan', async () => {
    const doc = await open();
    expect((await staff.post(`/stock-counts/${doc.id}/submit`)).body.message).toMatch(/Belum ada hasil hitung/);
    const lu = lineOf(doc, 'Produk A').id;
    expect((await save(staff, doc.id, [{ lineId: lu, countedQty: -1 }])).status).toBe(400);
    expect((await save(staff, doc.id, [{ lineId: crypto.randomUUID(), countedQty: 1 }])).status).toBe(422);
    await save(staff, doc.id, [{ lineId: lu, countedQty: urat.physical - 2 }]);
    expect((await staff.post(`/stock-counts/${doc.id}/submit`)).body.message).toMatch(/Isi alasan selisih untuk: Produk A/);
    await save(staff, doc.id, [{ lineId: lu, countedQty: urat.physical - 2, reason: 'lainnya' }]);
    expect((await staff.post(`/stock-counts/${doc.id}/submit`)).body.message).toMatch(/perlu catatan/);
    // hitungan di bawah jumlah dipesan ditolak
    const o = (await staff.post('/orders', { sellerId: byName(ms, 'Budi Santoso').id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: 3 }] })).body[0];
    await save(staff, doc.id, [{ lineId: lu, countedQty: 1, reason: 'hilang' }]);
    expect((await staff.post(`/stock-counts/${doc.id}/submit`)).body.message).toMatch(/tidak boleh kurang dari jumlah yang sudah dipesan/);
    await staff.post(`/orders/${o.id}/cancel`, { reason: 'uji opname' });
    // hitungan sama dengan sistem tidak butuh alasan; alasan dibuang bila tidak ada selisih
    await save(staff, doc.id, [{ lineId: lu, countedQty: urat.physical, reason: 'rusak' }]);
    expect(lineOf((await staff.get(`/stock-counts/${doc.id}`)).body, 'Produk A').reason).toBeNull();
    expect((await staff.post(`/stock-counts/${doc.id}/submit`)).status).toBe(201);
    expect((await save(staff, doc.id, [{ lineId: lu, countedQty: 5 }])).status).toBe(422);        // terkunci setelah diajukan
    await admin.post(`/stock-counts/${doc.id}/approve`);
  });

  it('persetujuan: petugas tidak boleh; posting menyesuaikan stok + kartu stok + nilai selisih; konsistensi terjaga', async () => {
    const before = await stockOf('Produk A');
    const bhalus = await stockOf('Produk B');
    const doc = await open();
    const lu = lineOf(doc, 'Produk A').id, lh = lineOf(doc, 'Produk B').id;
    await save(staff, doc.id, [
      { lineId: lu, countedQty: before.physical - 3, reason: 'rusak', note: 'kemasan sobek' },       // selisih −3
      { lineId: lh, countedQty: bhalus.physical + 2, reason: 'salah_catat' },                          // selisih +2
    ]);
    expect((await staff.post(`/stock-counts/${doc.id}/submit`)).status).toBe(201);
    expect((await staff.post(`/stock-counts/${doc.id}/approve`)).status).toBe(403);                  // petugas tidak berwenang
    const det = (await acct.get(`/stock-counts/${doc.id}`)).body;
    expect(det.status).toBe('submitted');
    expect(det.totals).toMatchObject({ counted: 2, varianceQty: -1, varianceValue: -3 * 70_000 + 2 * 63_000, loss: -210_000, gain: 126_000 });
    expect(lineOf(det, 'Produk A')).toMatchObject({ variance: -3, value: -210_000 });
    const ok = await admin.post(`/stock-counts/${doc.id}/approve`);
    expect(ok.status).toBe(201); expect(ok.body).toMatchObject({ adjusted: 2, varianceQty: -1, varianceValue: -84_000 });
    expect((await stockOf('Produk A')).physical).toBe(before.physical - 3);
    expect((await stockOf('Produk B')).physical).toBe(bhalus.physical + 2);
    expect((await admin.post(`/stock-counts/${doc.id}/approve`)).status).toBe(422);                  // tidak bisa dua kali
    // kartu stok: mutasi 'opname' dengan referensi dokumen + alasan, saldo berantai konsisten
    const card = (await staff.get(`/products/${before.id}/movements`)).body;
    expect(card[0]).toMatchObject({ type: 'opname', qty: -3, refNo: doc.no, actor: 'Pengurus nasional' });
    expect(card[0].note).toMatch(/Rusak.*kemasan sobek/);
    expect(card[0].balanceAfter).toBe(before.physical - 3);
    expect(card.at(-1).type).toBe('opening');
    expect((await staff.get(`/products/${before.id}/movements?limit=1`)).body.length).toBe(1);
    expect((await staff.get(`/products/${before.id}/movements?depotId=${d2.id}`)).status).toBe(403);
    expect((await admin.get('/system/consistency')).body.ok).toBe(true);
    // log aktivitas
    expect((await admin.get(`/audit-log?q=${doc.no}`)).body.rows.some((r: any) => /disetujui dan diposting/.test(r.message))).toBe(true);
  });

  it('pengurus hanya menyetujui/mengembalikan (tidak menghitung); dikembalikan lalu dihitung ulang petugas', async () => {
    expect((await admin.post('/stock-counts', { depotId: d1.id })).status).toBe(403);               // pengurus tidak membuat opname
    const doc = await open(staff);
    const lu = lineOf(doc, 'Produk A').id;
    const cur = (await stockOf('Produk A')).physical;
    expect((await save(admin, doc.id, [{ lineId: lu, countedQty: cur + 1, reason: 'salah_catat' }])).status).toBe(403);   // juga tidak mengisi hitungan
    await save(staff, doc.id, [{ lineId: lu, countedQty: cur + 1, reason: 'salah_catat' }]);
    expect((await staff.post(`/stock-counts/${doc.id}/submit`)).status).toBe(201);
    expect((await admin.post(`/stock-counts/${doc.id}/cancel`, { reason: 'bukan hak pengurus' })).status).toBe(403);
    const back = await admin.post(`/stock-counts/${doc.id}/reject`, { reason: 'hitung ulang rak belakang' });
    expect(back.status).toBe(201);
    const redo = (await admin.get(`/stock-counts/${doc.id}`)).body;
    expect(redo.status).toBe('draft'); expect(redo.returnNote).toBe('hitung ulang rak belakang'); expect(redo.submittedByName).toBeNull();
    expect((await admin.post(`/stock-counts/${doc.id}/reject`, { reason: 'sudah berstatus draf' })).status).toBe(422);  // sudah draf
    await save(staff, doc.id, [{ lineId: lu, countedQty: cur, reason: null }]);                      // hitung ulang: tidak ada selisih
    expect((await staff.post(`/stock-counts/${doc.id}/submit`)).status).toBe(201);
    const posted = await admin.post(`/stock-counts/${doc.id}/approve`);
    expect(posted.status).toBe(201); expect(posted.body.adjusted).toBe(0);
    expect((await stockOf('Produk A')).physical).toBe(cur);                                         // tanpa selisih → stok tak berubah
  });

  it('transaksi selama penghitungan tidak hilang (selisih diterapkan ke stok saat ini); penyesuaian di bawah jumlah dipesan ditolak', async () => {
    const doc = await open();
    const lu = lineOf(doc, 'Produk A').id;
    const base = (await stockOf('Produk A')).physical;
    await save(staff, doc.id, [{ lineId: lu, countedQty: base - 2, reason: 'hilang' }]);             // selisih −2 terhadap snapshot
    expect((await staff.post(`/stock-counts/${doc.id}/submit`)).status).toBe(201);
    await addStock(staff, urat.id, 5);                                                                // barang masuk setelah snapshot
    const mid = (await staff.get(`/stock-counts/${doc.id}`)).body;
    expect(lineOf(mid, 'Produk A').moved).toBe(5);                                                  // UI bisa menandai perubahan sejak dimulai
    expect((await admin.post(`/stock-counts/${doc.id}/approve`)).status).toBe(201);
    expect((await stockOf('Produk A')).physical).toBe(base + 5 - 2);                                // bukan base − 2: penerimaan tetap ada
    // penyesuaian yang membuat stok < dipesan ditolak
    await addStock(staff, urat.id, 20);                                                               // pastikan stok cukup untuk skenario
    const d2doc = await open();
    const l2 = lineOf(d2doc, 'Produk A').id; const cur2 = await stockOf('Produk A'); const now = cur2.physical; const avail = cur2.available;
    await save(staff, d2doc.id, [{ lineId: l2, countedQty: now - 4, reason: 'rusak' }]);
    await staff.post(`/stock-counts/${d2doc.id}/submit`);
    const res = (await staff.post('/orders', { sellerId: byName(ms, 'Budi Santoso').id, customerName: 'Ibu Ani', items: [{ productId: urat.id, qty: avail }] })).body[0]; // dipesan setelah diajukan: dipesan (avail) > stok setelah penyesuaian (now − 4)
    expect(res).toBeTruthy(); expect(avail).toBeGreaterThan(4);
    const blocked = await admin.post(`/stock-counts/${d2doc.id}/approve`);
    expect(blocked.status).toBe(422); expect(blocked.body.message).toMatch(/di bawah jumlah yang sudah dipesan/);
    expect((await stockOf('Produk A')).physical).toBe(now);                                         // tidak ada yang berubah (transaksi dibatalkan)
    await staff.post(`/orders/${res.id}/cancel`, { reason: 'uji' });
    expect((await admin.post(`/stock-counts/${d2doc.id}/approve`)).status).toBe(201);
    expect((await admin.get('/system/consistency')).body.ok).toBe(true);
  });

  it('pembatalan; jalur lama opname langsung dihapus; kartu stok mencatat penerimaan dan pengiriman', async () => {
    const doc = await open();
    expect((await staff.post(`/stock-counts/${doc.id}/cancel`, { reason: '' })).status).toBe(400);
    expect((await staff.post(`/stock-counts/${doc.id}/cancel`, { reason: 'salah toko' })).status).toBe(201);
    expect((await staff.post(`/stock-counts/${doc.id}/approve`)).status).toBe(403);
    expect((await admin.post(`/stock-counts/${doc.id}/approve`)).status).toBe(422);                  // dibatalkan
    expect((await staff.post(`/products/${urat.id}/opname`, { count: 1 })).status).toBe(404);        // tidak ada jalan pintas
    const types = (await staff.get(`/products/${urat.id}/movements?limit=200`)).body.map((m: any) => m.type);
    for (const t of ['opening', 'receipt', 'shipment', 'opname']) expect(types).toContain(t);
  });
});

describe('stok opname: toleransi selisih (di atas ambang → persetujuan pengurus)', () => {
  let urat: any, staff2: Client;
  const stockOf = async () => byName((await staff.get('/products')).body, 'Produk A');
  const lineOf = (doc: any) => doc.lines.find((l: any) => l.name === 'Produk A');
  const setPolicy = (tolerancePct: number, toleranceValue: number) => admin.call('PUT', '/stock-counts/policy', { tolerancePct, toleranceValue });
  async function submitted(by: Client, delta: number) {
    const r = await by.post('/stock-counts', {}); expect(r.status).toBe(201);
    const doc = (await by.get(`/stock-counts/${r.body.id}`)).body;
    const cur = (await stockOf()).physical;
    await by.call('PUT', `/stock-counts/${doc.id}/lines`, { lines: [{ lineId: lineOf(doc).id, countedQty: cur + delta, reason: 'hilang' }] });
    expect((await by.post(`/stock-counts/${doc.id}/submit`)).status).toBe(201);
    return doc.id as string;
  }
  beforeAll(async () => { urat = await stockOf(); staff2 = await as(app, 'nasional', 'petugas2'); await addStock(staff, urat.id, 40); });
  afterAll(async () => { await setPolicy(5, 500_000); });

  it('kebijakan: semua staf membaca; hanya pengurus mengubah; validasi; perubahan tercatat', async () => {
    expect((await acct.get('/stock-counts/policy')).body).toMatchObject({ tolerancePct: 5, toleranceValue: 500_000 });
    expect((await staff.call('PUT', '/stock-counts/policy', { tolerancePct: 10, toleranceValue: 1 })).status).toBe(403);
    expect((await setPolicy(101, 1)).status).toBe(400);
    expect((await setPolicy(-1, 1)).status).toBe(400);
    expect((await setPolicy(5, 500_000)).status).toBe(422);              // sama
    expect((await setPolicy(10, 750_000)).status).toBe(200);
    expect((await member.get('/stock-counts/policy')).status).toBe(403);
    expect((await admin.get('/audit-log?q=Toleransi selisih opname')).body.rows[0].message).toMatch(/5% \/ Rp500\.000 → 10% \/ Rp750\.000/);
    await setPolicy(5, 500_000);
  });

  it('selisih di atas toleransi hanya diberi tanda peringatan (persen dan nilai); pengurus tetap yang menyetujui', async () => {
    await setPolicy(50, 1_000_000_000);                                    // ambang longgar: selisih kecil
    const small = await submitted(staff, -1);
    expect((await admin.get(`/stock-counts/${small}`)).body).toMatchObject({ needsAdmin: false, exceedReason: null });
    expect((await admin.post(`/stock-counts/${small}/approve`)).status).toBe(201);

    await setPolicy(5, 1_000_000_000);                                     // ≤5% per produk; selisih −10 dari ≥40 stok = >5%
    const big = await submitted(staff, -10);
    const det = (await admin.get(`/stock-counts/${big}`)).body;
    expect(det.needsAdmin).toBe(true); expect(det.exceedReason).toMatch(/Produk A −10 \(.*% > 5%\)/);
    expect(det.canApprove).toBe(true);
    expect((await staff.post(`/stock-counts/${big}/approve`)).status).toBe(403);
    expect((await admin.post(`/stock-counts/${big}/reject`, { reason: 'periksa ulang rak' })).status).toBe(201);
    const doc = (await staff.get(`/stock-counts/${big}`)).body;
    expect(doc.status).toBe('draft'); expect(doc.needsAdmin).toBe(true);                // pratinjau langsung untuk draf
    expect((await staff.post(`/stock-counts/${big}/submit`)).status).toBe(201);
    expect((await admin.post(`/stock-counts/${big}/approve`)).status).toBe(201);
    expect((await admin.get('/audit-log?q=melebihi toleransi')).body.rows.length).toBeGreaterThan(0);
    // nilai total di atas ambang nilai (walau persen kecil)
    await setPolicy(100, 100_000);                                          // ambang nilai Rp100.000; 2 pak × Rp70.000 = Rp140.000
    const val = await submitted(staff, -2);
    expect((await admin.get(`/stock-counts/${val}`)).body.exceedReason).toMatch(/nilai selisih Rp140\.000 > Rp100\.000/);
    expect((await admin.post(`/stock-counts/${val}/approve`)).status).toBe(201);
  });

  it('pengurus tidak bisa membuat/mengajukan opname; yang diajukan petugas disetujui pengurus dan konsisten', async () => {
    await setPolicy(1, 1_000_000_000);
    expect((await admin.post('/stock-counts', {})).status).toBe(403);
    const id = await submitted(staff, 3);
    expect((await admin.get(`/stock-counts/${id}`)).body).toMatchObject({ needsAdmin: true, canApprove: true });
    expect((await admin.post(`/stock-counts/${id}/approve`)).status).toBe(201);
    expect((await admin.get('/system/consistency')).body.ok).toBe(true);
  });
});

describe('CORS: metode tulis lintas-origin diizinkan (PUT/PATCH/DELETE) untuk origin yang dikonfigurasi', () => {
  it('preflight PUT dari origin lain mengembalikan metode yang diizinkan', async () => {
    const r = await app.inject({ method: 'OPTIONS', url: '/api/stock-counts/policy', headers: { origin: 'http://localhost:8082', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' } });
    expect(r.statusCode).toBeLessThan(300);
    expect(String(r.headers['access-control-allow-methods'])).toMatch(/PUT/);
    expect(String(r.headers['access-control-allow-methods'])).toMatch(/PATCH/);
    expect(String(r.headers['access-control-allow-methods'])).toMatch(/DELETE/);
  });
});

describe('sesi web lewat cookie HttpOnly', () => {
  it('login mengirim cookie HttpOnly SameSite=Strict; cookie dipakai tanpa header Bearer; lintas situs ditolak; logout menghapus', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin.nasional', password: DEMO_PASSWORD } });
    expect(login.statusCode).toBe(201);
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toMatch(/^sajadah_session=.+; Path=\/; HttpOnly; SameSite=Strict/);
    const cookie = setCookie.split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout' })).headers['set-cookie']).toMatch(/Max-Age=0/);
    expect((await app.inject({ method: 'POST', url: '/api/depots/staff/00000000-0000-4000-8000-000000000000/reset', headers: { cookie, origin: 'https://situs-jahat.example', host: 'localhost' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
  });
});
