import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, as, boot } from './helpers';

let app: NestFastifyApplication;
let admin: Client, staff: Client;

beforeAll(async () => {
  app = await boot();
  [admin, staff] = await Promise.all([as(app, 'nasional', 'admin'), as(app, 'nasional', 'petugas')]);
});
afterAll(() => app.close());

describe('CRUD petugas toko', () => {
  it('pengurus membuat, mengubah, mengatur ulang sandi, dan menghapus; petugas tidak boleh', async () => {
    const depots = (await admin.get('/depots')).body;
    const d = depots[0];
    const made = await admin.call('POST', `/depots/${d.id}/staff`, { name: 'Dewi Lestari' });
    expect(made.body.username).toBe('dewi.lestari');
    const list = (await admin.get('/depots/staff')).body;
    const row = list.find((r: any) => r.username === 'dewi.lestari');
    expect(row).toMatchObject({ name: 'Dewi Lestari', depotId: d.id, mustChangePassword: true });
    expect((await staff.call('POST', `/depots/staff/${row.id}/reset`)).status).toBe(403);
    expect((await staff.call('DELETE', `/depots/staff/${row.id}`)).status).toBe(403);
    expect((await admin.call('PATCH', `/depots/staff/${row.id}`, { name: 'Dewi L.' })).status).toBe(200);
    const reset = await admin.call('POST', `/depots/staff/${row.id}/reset`);
    expect(reset.body.username).toBe('dewi.lestari');
    expect(reset.body.password).not.toBe(made.body.password);
    expect((await admin.call('DELETE', `/depots/staff/${row.id}`)).status).toBe(200);
    expect((await admin.get('/depots/staff')).body.some((r: any) => r.id === row.id)).toBe(false);
    expect((await admin.call('DELETE', `/depots/staff/${row.id}`)).status).toBe(422);
  });
});
