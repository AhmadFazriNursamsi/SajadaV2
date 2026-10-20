import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot } from './helpers';

let app: NestFastifyApplication;
let admin: Client, staff: Client;
const dir = mkdtempSync(join(tmpdir(), 'apk-'));

beforeAll(async () => {
  process.env.APK_PATH = join(dir, 'sajadah.apk');
  app = await boot();
  [admin, staff] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas')]);
});
afterAll(async () => { delete process.env.APK_PATH; await app.close(); });

describe('unduh aplikasi (QR di web admin)', () => {
  it('info hanya untuk pengurus; unduhan publik 404 sebelum berkas ada, lalu mengalir setelahnya', async () => {
    expect((await staff.get('/app/info')).status).toBe(403);
    const before = (await admin.get('/app/info')).body;
    expect(before).toMatchObject({ available: false, size: 0 });
    expect(before.url).toMatch(/^http:\/\/.+\/api\/app\/sajadah\.apk$/);
    expect((await app.inject({ method: 'GET', url: '/api/app/sajadah.apk' })).statusCode).toBe(404);
    writeFileSync(process.env.APK_PATH!, 'PK-bukan-apk-sungguhan');
    expect((await admin.get('/app/info')).body).toMatchObject({ available: true, size: 22 });
    const r = await app.inject({ method: 'GET', url: '/api/app/sajadah.apk' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(r.body).toBe('PK-bukan-apk-sungguhan');
  });
});
