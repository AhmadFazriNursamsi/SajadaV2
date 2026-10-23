import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { Database } from '../db/db';
import { auditLog, voucherRedemptions, withdrawals, depotStock, depots, orderReports, stockMovements, stockRequests, members, orders, payables, products, profitReports, purchaseOrders, tenants } from '../db/schema';
import { CentralModule, CentralService } from '../central/central.module';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { ADMIN, CurrentActor, Roles, STAFF } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { commissionLines } from '@sajadah/shared';
import { commissionEligible, orderTotal } from '../orders/orders.module';

/** Jumlah pesanan (bukan jumlah baris produk): satu checkout dengan banyak produk dihitung satu. */
const grp = (rs: { groupId: string }[]) => new Set(rs.map((o) => o.groupId)).size;

@Injectable()
export class OverviewService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService, private readonly central: CentralService) {}

  async overview(tid: string) {
    const [[tenant], ms, prods, os, pos, log, reserved, ds, stock, [reqs], [wd], [vc]] = await Promise.all([
      this.db.select().from(tenants).where(eq(tenants.id, tid)),
      this.db.select().from(members).where(eq(members.tenantId, tid)),
      this.db.select().from(products).where(eq(products.tenantId, tid)),
      this.db.select().from(orders).where(eq(orders.tenantId, tid)),
      this.db.select().from(purchaseOrders).where(eq(purchaseOrders.tenantId, tid)),
      this.db.select().from(auditLog).where(eq(auditLog.tenantId, tid)).orderBy(desc(auditLog.createdAt)).limit(6),
      this.db.select({ id: orders.depotId, depotId: orders.depotId, productId: orders.productId, qty: sql<number>`coalesce(sum(${orders.qty}), 0)`.mapWith(Number) }).from(orders).where(and(eq(orders.tenantId, tid), eq(orders.cancelled, false), eq(orders.shipped, false))).groupBy(orders.depotId, orders.productId),
      this.db.select().from(depots).where(and(eq(depots.tenantId, tid), eq(depots.active, true))),
      this.db.select({ s: depotStock }).from(depotStock).innerJoin(depots, eq(depots.id, depotStock.depotId)).where(eq(depots.tenantId, tid)),
      this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(stockRequests).where(and(eq(stockRequests.tenantId, tid), eq(stockRequests.status, 'pending'))),
      this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(withdrawals).where(and(eq(withdrawals.tenantId, tid), eq(withdrawals.status, 'pending'))),
      this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(voucherRedemptions).where(and(eq(voucherRedemptions.tenantId, tid), eq(voucherRedemptions.status, 'pending'))),
    ]);
    const live = os.filter((o) => !o.cancelled && !o.returned);
    // Ketersediaan dihitung per pasangan (toko, produk): stok toko A tidak menutup kekurangan toko B.
    const resKey = new Map(reserved.map((r) => [`${r.depotId}:${r.productId}`, r.qty]));
    const cells = stock.map(({ s: x }) => ({ productId: x.productId, avail: x.physical - (resKey.get(`${x.depotId}:${x.productId}`) ?? 0), safety: prods.find((p) => p.id === x.productId)?.safety ?? 0 }));
    const eligible = os.filter(commissionEligible);
    const pendingCommission = eligible.filter((o) => o.commission === 'pending');

    const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); return d; });
    const sales7 = days.map((d) => {
      const next = new Date(d.getTime() + 86_400_000);
      return { date: d.toISOString().slice(0, 10), packs: live.filter((o) => o.createdAt >= d && o.createdAt < next).reduce((s, o) => s + o.qty, 0) };
    });

    return {
      tenant: { name: tenant!.name, slug: tenant!.slug, depots: ds.map((d) => ({ id: d.id, name: d.name })) },
      kpis: {
        memberBalance: ms.reduce((s, m) => s + m.balance, 0),
        rewardBalance: ms.reduce((s, m) => s + m.rewardBalance, 0),
        coinBalance: ms.reduce((s, m) => s + m.coinBalance, 0),
        activeMembers: ms.filter((m) => m.active).length,
        availableStock: cells.reduce((s, c) => s + c.avail, 0),
        lowStockProducts: cells.filter((c) => c.avail <= c.safety).length,
        salesValue: live.reduce((s, o) => s + orderTotal(o), 0),
        orderCount: new Set(live.map((o) => o.groupId)).size,
        // Jumlah komisi sebenarnya dari baris per penerima (bergantung panjang rantai sponsor), bukan tarif maksimum tetap.
        pendingCommission: pendingCommission.reduce((s, o) => s + commissionLines(o.sellerId, o.uplines, orderTotal(o), o.commissionRates).reduce((t, l) => t + l.amount, 0), 0),
        pendingCommissionCount: pendingCommission.length,
      },
      actions: {
        draftPo: pos.filter((p) => p.status === 'draft').length,
        awaitingApproval: grp(live.filter((o) => !o.approvedAt)),
        paidNotShipped: grp(live.filter((o) => !!o.approvedAt && o.pay !== 'unpaid' && !o.shipped)),
        commissionsToApprove: pendingCommission.length,
        stockRequests: reqs?.n ?? 0,
        withdrawalsPending: wd?.n ?? 0,
        redemptionsPending: vc?.n ?? 0,
      },
      sales7,
      activity: log.map((l) => ({ at: l.createdAt, actor: l.actorName, message: l.message })),
    };
  }

  async depotTasks(a: Actor) {
    const own = a.did ? eq(orders.depotId, a.did) : undefined;
    const poOwn = a.did ? eq(purchaseOrders.depotId, a.did) : undefined;
    const [[tenant], os, pos, ds, [reqs], [reps], [ver]] = await Promise.all([
      this.db.select().from(tenants).where(eq(tenants.id, a.tid)),
      this.db.select().from(orders).where(and(eq(orders.tenantId, a.tid), own)),
      this.db.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, a.tid), poOwn)),
      this.db.select().from(depots).where(and(eq(depots.tenantId, a.tid), a.did ? eq(depots.id, a.did) : undefined)),
      this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(stockRequests).where(and(eq(stockRequests.tenantId, a.tid), eq(stockRequests.status, 'pending'), a.did ? eq(stockRequests.depotId, a.did) : undefined)),
      this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(orderReports).where(and(eq(orderReports.tenantId, a.tid), eq(orderReports.status, 'open'), a.did ? eq(orderReports.depotId, a.did) : undefined)),
      this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(orderReports).where(and(eq(orderReports.tenantId, a.tid), eq(orderReports.verifyStatus, 'pending'), a.did ? eq(orderReports.depotId, a.did) : undefined)),
    ]);
    const live = os.filter((o) => !o.cancelled && !o.returned);
    // Kewajiban stok opname bulanan: petugas melihat status tokonya; pengurus melihat toko mana yang sedang dikunci.
    const opname = a.did ? await this.core.opnameStatus(this.db, a.did) : null;
    const opnameLocked = a.did ? [] : (await Promise.all(ds.filter((d) => d.active).map(async (d) => ({ name: d.name, s: await this.core.opnameStatus(this.db, d.id) })))).filter((x) => x.s.state === 'locked').map((x) => ({ name: x.name, month: x.s.month }));
    return {
      opname, opnameLocked,
      tenant: { name: tenant!.name, depotName: a.did ? ds[0]?.name ?? '' : 'Semua toko' },
      actions: {
        awaitingApproval: grp(live.filter((o) => !o.approvedAt)),
        paidNotShipped: grp(live.filter((o) => !!o.approvedAt && o.pay !== 'unpaid' && !o.shipped)),
        draftPo: pos.filter((p) => p.status === 'draft').length,
        stockRequestsPending: reqs?.n ?? 0,
        memberReports: reps?.n ?? 0,
        pendingVerification: ver?.n ?? 0,
      },
    };
  }

  async consistency(tid: string) {
    const [stock, ms, ap, reserved, [t], dup] = await Promise.all([
      this.db.select({ s: depotStock }).from(depotStock).innerJoin(depots, eq(depots.id, depotStock.depotId)).where(eq(depots.tenantId, tid)),
      this.db.select().from(members).where(eq(members.tenantId, tid)),
      this.db.select().from(payables).where(eq(payables.tenantId, tid)),
      this.db.select({ depotId: orders.depotId, productId: orders.productId, qty: sql<number>`coalesce(sum(${orders.qty}), 0)`.mapWith(Number) }).from(orders).where(and(eq(orders.tenantId, tid), eq(orders.cancelled, false), eq(orders.shipped, false))).groupBy(orders.depotId, orders.productId),
      this.db.select().from(tenants).where(eq(tenants.id, tid)),
      this.db.select({ n: sql<number>`count(*) - count(distinct ${members.memberNo})`.mapWith(Number) }).from(members).where(and(eq(members.tenantId, tid), sql`${members.memberNo} is not null`)),
    ]);
    const cardSums = await this.db.select({ depotId: stockMovements.depotId, productId: stockMovements.productId, sum: sql<number>`coalesce(sum(${stockMovements.qty}), 0)`.mapWith(Number) }).from(stockMovements).where(eq(stockMovements.tenantId, tid)).groupBy(stockMovements.depotId, stockMovements.productId);
    const cardOk = stock.every(({ s: x }) => (cardSums.find((c) => c.depotId === x.depotId && c.productId === x.productId)?.sum ?? 0) === x.physical);
    const checks = [
      { name: 'Stok fisik ≥ reservasi (per toko)', ok: reserved.every((r) => (stock.find(({ s: x }) => x.depotId === r.depotId && x.productId === r.productId)?.s.physical ?? 0) >= r.qty) },
      { name: 'Stok tidak negatif', ok: stock.every(({ s: x }) => x.physical >= 0 && x.inTransit >= 0) },
      { name: 'Kartu stok = stok fisik (semua toko)', ok: cardOk },
      { name: 'Saldo belanja tidak negatif', ok: ms.every((m) => m.balance >= 0) },
      { name: 'Pembayaran AP ≤ tagihan', ok: ap.every((p) => p.paid <= p.amount) },
      { name: 'Kas tercatat tidak negatif', ok: t!.cash >= 0 },
      { name: 'Nomor anggota unik', ok: dup[0]!.n === 0 },
    ];
    const all = [...checks, ...(await this.central.consistency(tid))];
    return { ok: all.every((c) => c.ok), checks: all };
  }
}

@Controller()
@Roles(...ADMIN) // ringkasan keuangan koperasi hanya untuk pengurus
class OverviewController {
  constructor(private readonly svc: OverviewService) {}
  @Get('overview') overview(@CurrentActor() a: Actor) { return this.svc.overview(a.tid); }
  /** Tugas toko untuk aplikasi petugas: hanya angka pekerjaan (terkunci ke toko petugas), tanpa data keuangan. */
  @Get('overview/depot-tasks') @Roles(...STAFF) depotTasks(@CurrentActor() a: Actor) { return this.svc.depotTasks(a); }
  @Get('system/consistency') consistency(@CurrentActor() a: Actor) { return this.svc.consistency(a.tid); }
}

@Module({ imports: [CentralModule], controllers: [OverviewController], providers: [OverviewService] })
export class OverviewModule {}
