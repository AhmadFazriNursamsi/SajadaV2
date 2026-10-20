import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { apPaymentSchema } from '@sajadah/shared';
import { Database } from '../db/db';
import { apPayments, members, orders, payables, products, purchaseOrders, suppliers, tenants } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError, isUniqueViolation } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentActor, FINANCE, Roles } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);

@Injectable()
export class FinanceService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) {}

  async receivables(tid: string) {
    const rows = await this.db
      .select({ id: orders.id, no: orders.no, seller: members.name, total: sql<number>`${orders.qty} * ${orders.price}`.mapWith(Number) })
      .from(orders)
      .innerJoin(members, eq(members.id, orders.sellerId))
      .where(and(eq(orders.tenantId, tid), eq(orders.cancelled, false), eq(orders.pay, 'unpaid')))
      .orderBy(asc(orders.no));
    return rows;
  }

  async payablesList(tid: string) {
    const rows = await this.db
      .select({ p: payables, supplier: suppliers.name, po: purchaseOrders.no })
      .from(payables)
      .leftJoin(suppliers, eq(suppliers.id, payables.supplierId))
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, payables.poId))
      .where(eq(payables.tenantId, tid))
      .orderBy(asc(payables.dueDate));
    const t = today();
    return rows.map(({ p, supplier, po }) => {
      const outstanding = p.amount - p.paid;
      return { ...p, supplier, poNo: po, outstanding, status: outstanding <= 0 ? 'paid' : p.dueDate < t ? 'overdue' : 'open' };
    });
  }

  async unbilledReceipts(tid: string) {
    const rows = await this.db
      .select({ po: purchaseOrders, product: products.name, buyPrice: products.buyPrice, supplier: suppliers.name })
      .from(purchaseOrders)
      .innerJoin(products, eq(products.id, purchaseOrders.productId))
      .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(and(eq(purchaseOrders.tenantId, tid), eq(purchaseOrders.invoiced, false), sql`${purchaseOrders.accepted} > 0`));
    return rows.map((r) => ({ id: r.po.id, no: r.po.no, product: r.product, supplier: r.supplier, accepted: r.po.accepted, amount: r.po.accepted * r.buyPrice }));
  }

  /** Invoice dibuat dari kuantitas layak saja (barang ditolak tidak ditagihkan). */
  async invoicePo(a: Actor, poId: string) {
    return this.db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, a.tid), eq(purchaseOrders.id, poId))).for('update');
      if (!po) throw new BusinessError('PO tidak ditemukan');
      if (po.invoiced) throw new BusinessError('PO sudah ditagihkan.');
      if (po.accepted < 1) throw new BusinessError('Belum ada penerimaan layak.');
      if (po.status !== 'done') throw new BusinessError('Tagihkan setelah seluruh kuantitas PO diterima layak.');
      const [p] = await tx.select().from(products).where(eq(products.id, po.productId));
      const no = await this.core.docNo(tx, a.tid, 'INV', 'inv', 4);
      await tx.insert(payables).values({ tenantId: a.tid, no, supplierId: po.supplierId, poId: po.id, dueDate: addDays(today(), 30), amount: po.accepted * p!.buyPrice });
      await tx.update(purchaseOrders).set({ invoiced: true }).where(eq(purchaseOrders.id, po.id));
      await this.core.audit(tx, a, `Invoice ${no} dicatat dari ${po.no}`);
      return { no };
    });
  }

  /** Bayar utang pemasok: tidak boleh melebihi sisa utang atau kas, referensi tidak boleh ganda. */
  async payPayable(a: Actor, id: string, amount: number, ref: string) {
    try {
      return await this.db.transaction(async (tx) => {
        const [p] = await tx.select().from(payables).where(and(eq(payables.tenantId, a.tid), eq(payables.id, id))).for('update');
        if (!p) throw new BusinessError('Invoice tidak ditemukan');
        if (amount > p.amount - p.paid) throw new BusinessError('Pembayaran ditolak: melebihi sisa utang.');
        const [t] = await tx.select().from(tenants).where(eq(tenants.id, a.tid)).for('update');
        if (amount > t!.cash) throw new BusinessError('Pembayaran ditolak: kas tercatat tidak cukup.');
        await tx.insert(apPayments).values({ tenantId: a.tid, payableId: id, ref, amount });
        await tx.update(payables).set({ paid: p.paid + amount }).where(eq(payables.id, id));
        await tx.update(tenants).set({ cash: t!.cash - amount }).where(eq(tenants.id, a.tid));
        await this.core.audit(tx, a, `Pembayaran ${amount.toLocaleString('id-ID')} untuk ${p.no} dicatat (${ref})`);
        return { ok: true };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BusinessError('Referensi pembayaran ganda ditolak.');
      throw e;
    }
  }

  async summary(tid: string) {
    const [[t], ar, ap, bal] = await Promise.all([
      this.db.select().from(tenants).where(eq(tenants.id, tid)),
      this.receivables(tid),
      this.payablesList(tid),
      this.db.select({ v: sql<number>`coalesce(sum(${members.balance}),0)`.mapWith(Number) }).from(members).where(eq(members.tenantId, tid)),
    ]);
    const open = ap.filter((x) => x.outstanding > 0);
    return {
      cash: t!.cash,
      receivable: ar.reduce((s, r) => s + r.total, 0),
      receivableCount: ar.length,
      payable: open.reduce((s, x) => s + x.outstanding, 0),
      payableOverdue: open.filter((x) => x.status === 'overdue').reduce((s, x) => s + x.outstanding, 0),
      payableCurrent: open.filter((x) => x.status === 'open').reduce((s, x) => s + x.outstanding, 0),
      memberBalanceLiability: bal[0]!.v, // akun 2210
    };
  }
}

@Controller('finance')
@Roles(...FINANCE)
class FinanceController {
  constructor(private readonly svc: FinanceService) {}
  @Get('summary') summary(@CurrentActor() a: Actor) { return this.svc.summary(a.tid); }
  @Get('receivables') ar(@CurrentActor() a: Actor) { return this.svc.receivables(a.tid); }
  @Get('payables') ap(@CurrentActor() a: Actor) { return this.svc.payablesList(a.tid); }
  @Get('unbilled-receipts') unbilled(@CurrentActor() a: Actor) { return this.svc.unbilledReceipts(a.tid); }
  @Post('purchase-orders/:id/invoice') invoice(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.invoicePo(a, id); }
  @Post('payables/:id/payments') pay(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(apPaymentSchema)) b: any) { return this.svc.payPayable(a, id, b.amount, b.ref); }
}

@Module({ controllers: [FinanceController], providers: [FinanceService], exports: [FinanceService] })
export class FinanceModule {}
