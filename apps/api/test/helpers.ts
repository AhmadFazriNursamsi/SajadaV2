import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/bootstrap';
import { seedIfEmpty, DEMO_PASSWORD } from '../src/seed/seed';
import { DB } from '../src/core/db.module';
import type { Database } from '../src/db/db';

export async function boot() {
  const app = await createApp({ serveWeb: false, logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await seedIfEmpty(app.get<Database>(DB), { all: true }); // tes memakai tiga koperasi untuk menguji isolasi data
  return app;
}

export class Client {
  token = '';
  constructor(private readonly app: NestFastifyApplication) {}
  async login(tenant: string, role: string) {
    const r = await this.app.inject({ method: 'POST', url: '/api/auth/login', payload: { tenant, username: `${role}.${tenant}`, password: DEMO_PASSWORD } });
    if (r.statusCode !== 201) throw new Error('login gagal ' + r.body);
    this.token = r.json().token;
    return this;
  }
  async call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
    const r = await this.app.inject({ method, url: '/api' + url, payload: payload as any, headers: this.token ? { authorization: `Bearer ${this.token}` } : {} });
    let body: any;
    try { body = r.json(); } catch { body = r.body; }
    return { status: r.statusCode, body };
  }
  get = (u: string) => this.call('GET', u);
  post = (u: string, b: unknown = {}) => this.call('POST', u, b);
  patch = (u: string, b: unknown = {}) => this.call('PATCH', u, b);
}
export const as = async (app: NestFastifyApplication, tenant: string, role: string) => new Client(app).login(tenant, role);

/**
 * Pembersih khusus tes: membatalkan efek sebuah pesanan yang sudah selesai (saldo kembali, stok kembali, komisi dibalik)
 * lewat basis data langsung. Fitur retur sudah dihapus dari aplikasi; tes memakai ini supaya keadaan antar-tes tetap bersih.
 */
export async function undoOrder(app: NestFastifyApplication, orderId: string) {
  const { eq, and } = await import('drizzle-orm');
  const { orders, members, depotStock, stockMovements, tenants } = await import('../src/db/schema');
  const db = app.get<Database>(DB);
  const [head] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!head) throw new Error('pesanan tidak ada');
  const rows = await db.select().from(orders).where(and(eq(orders.tenantId, head.tenantId), eq(orders.groupId, head.groupId)));
  const total = rows.reduce((s, o) => s + o.qty * o.price, 0);
  if (head.pay === 'balance') {
    const [m] = await db.select().from(members).where(eq(members.id, head.sellerId));
    await db.update(members).set({ balance: m!.balance + total }).where(eq(members.id, m!.id));
  } else if (head.pay === 'cash') {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, head.tenantId));
    await db.update(tenants).set({ cash: t!.cash - total }).where(eq(tenants.id, t!.id));
  }
  for (const o of rows) {
    if (o.shipped) {
      const [st] = await db.select().from(depotStock).where(and(eq(depotStock.depotId, o.depotId), eq(depotStock.productId, o.productId)));
      const next = st!.physical + o.qty;
      await db.update(depotStock).set({ physical: next }).where(and(eq(depotStock.depotId, o.depotId), eq(depotStock.productId, o.productId)));
      await db.insert(stockMovements).values({ tenantId: o.tenantId, depotId: o.depotId, productId: o.productId, type: 'return', qty: o.qty, balanceAfter: next, refNo: o.no, note: 'Pembersihan tes', actorName: 'Tes' });
    }
    const eligible = o.pay !== 'unpaid' && o.received && !o.cancelled && !o.returned && !o.buyerId;
    await db.update(orders).set({ returned: true, returnedAt: new Date(), returnReason: 'bersih uji', ...(eligible ? { commission: 'reversed' as const, commissionReversedFrom: o.commission } : {}) }).where(eq(orders.id, o.id));
  }
}
