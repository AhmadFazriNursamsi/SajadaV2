import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { poReceiveSchema, poScheduleSchema, shouldAutoReplenish } from '@sajadah/shared';
import { Database } from '../db/db';
import { depotStock, depots, products, purchaseOrders, suppliers } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentActor, DEPOT_ONLY, OPS, Roles, STAFF } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

@Injectable()
export class ProcurementService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) {}

  suppliers(tid: string) {
    return this.db.select().from(suppliers).where(eq(suppliers.tenantId, tid)).orderBy(asc(suppliers.name));
  }

  async list(a: Actor) {
    const rows = await this.db
      .select({ po: purchaseOrders, product: products.name, supplier: suppliers.name, depot: depots.name })
      .from(purchaseOrders)
      .innerJoin(products, eq(products.id, purchaseOrders.productId))
      .innerJoin(depots, eq(depots.id, purchaseOrders.depotId))
      .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(and(eq(purchaseOrders.tenantId, a.tid), a.did ? eq(purchaseOrders.depotId, a.did) : undefined))
      .orderBy(desc(purchaseOrders.no));
    return rows.map((r) => ({ ...r.po, product: r.product, supplier: r.supplier, depot: r.depot, remaining: r.po.qty - r.po.accepted }));
  }

  /** Evaluasi aturan safety stock per toko → draf PO baru. PO berjalan ikut diperhitungkan sehingga tidak ganda. */
  async evaluate(a: Actor) {
    return this.db.transaction(async (tx) => {
      const prods = await tx.select().from(products).where(eq(products.tenantId, a.tid)).orderBy(asc(products.sku)).for('update');
      const [sup] = await tx.select().from(suppliers).where(and(eq(suppliers.tenantId, a.tid), eq(suppliers.active, true))).orderBy(asc(suppliers.name)).limit(1);
      const ds = await tx.select().from(depots).where(and(eq(depots.tenantId, a.tid), eq(depots.active, true), a.did ? eq(depots.id, a.did) : undefined)).orderBy(asc(depots.createdAt));
      const created: string[] = [];
      for (const d of ds) {
        const reserved = await this.core.reservedMap(tx, a.tid, d.id);
        const open = new Map(await this.core.openPoMap(tx, a.tid, d.id));
        const stock = await this.core.stockMap(tx, d.id);
        for (const p of prods) {
          const qty = shouldAutoReplenish({ ...p, ...(stock.get(p.id) ?? { physical: 0, inTransit: 0 }) }, reserved.get(p.id) ?? 0, open.get(p.id) ?? 0);
          if (qty <= 0) continue;
          const no = await this.core.docNo(tx, a.tid, 'PO');
          await tx.insert(purchaseOrders).values({ tenantId: a.tid, depotId: d.id, no, productId: p.id, supplierId: sup?.id ?? null, qty });
          open.set(p.id, (open.get(p.id) ?? 0) + qty);
          created.push(no);
        }
      }
      if (created.length) await this.core.audit(tx, a, `${created.length} draf PO dibuat: ${created.join(', ')}`);
      return { created };
    });
  }

  private async lock(q: Database, tid: string, id: string) {
    const [po] = await q.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tid), eq(purchaseOrders.id, id))).for('update');
    if (!po) throw new BusinessError('PO tidak ditemukan');
    return po;
  }

  async approve(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const po = await this.lock(tx, a.tid, id);
      this.core.assertDepot(a, po.depotId);
      if (po.status !== 'draft') throw new BusinessError('Hanya draf PO yang dapat disetujui.');
      await tx.update(purchaseOrders).set({ status: 'approved' }).where(eq(purchaseOrders.id, id));
      await this.core.audit(tx, a, `${po.no} disetujui (belum dikirim ke pemasok)`);
      return { ok: true };
    });
  }

  async schedule(a: Actor, id: string, date: string) {
    return this.db.transaction(async (tx) => {
      const po = await this.lock(tx, a.tid, id);
      this.core.assertDepot(a, po.depotId);
      if (po.status === 'draft' || po.status === 'done') throw new BusinessError('Jadwal hanya untuk PO yang disetujui dan belum selesai.');
      await tx.update(purchaseOrders).set({ promisedDate: date }).where(eq(purchaseOrders.id, id));
      await this.core.audit(tx, a, `Jadwal pemasok ${po.no} dicatat: ${date}`);
      return { ok: true };
    });
  }

  /** Terima barang: hanya kuantitas layak menambah stok; PO ditutup saat seluruh kuantitas layak diterima. */
  async receive(a: Actor, id: string, accepted: number, rejected: number) {
    return this.db.transaction(async (tx) => {
      const po = await this.lock(tx, a.tid, id);
      this.core.assertDepot(a, po.depotId);
      if (po.status === 'draft' || po.status === 'done') throw new BusinessError('PO belum disetujui atau sudah selesai.');
      if (accepted + rejected < 1) throw new BusinessError('Isi jumlah layak atau ditolak.');
      const remaining = po.qty - po.accepted;
      if (accepted > remaining) throw new BusinessError(`Jumlah layak melebihi sisa PO (${remaining}).`);
      if (accepted > 0) await this.core.moveStock(tx, a, { depotId: po.depotId, productId: po.productId, delta: accepted, type: 'po_receipt', refNo: po.no, note: `Penerimaan PO (layak ${accepted}, ditolak ${rejected})` });
      const nowAccepted = po.accepted + accepted;
      await tx.update(purchaseOrders).set({ accepted: nowAccepted, rejected: po.rejected + rejected, status: nowAccepted >= po.qty ? 'done' : 'partial' }).where(eq(purchaseOrders.id, id));
      await this.core.audit(tx, a, `${po.no}: diterima layak ${accepted}, ditolak ${rejected}; stok +${accepted}`);
      return { ok: true };
    });
  }
}

@Controller()
@Roles(...STAFF)
class ProcurementController {
  constructor(private readonly svc: ProcurementService) {}
  @Get('suppliers') suppliers(@CurrentActor() a: Actor) { return this.svc.suppliers(a.tid); }
  @Get('purchase-orders') list(@CurrentActor() a: Actor) { return this.svc.list(a); }
  @Post('replenishment/evaluate') @Roles(...OPS) evaluate(@CurrentActor() a: Actor) { return this.svc.evaluate(a); }
  @Post('purchase-orders/:id/approve') @Roles('tenant_admin') approve(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.approve(a, id); }
  @Post('purchase-orders/:id/schedule') @Roles(...OPS) schedule(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(poScheduleSchema)) b: any) { return this.svc.schedule(a, id, b.date); }
  @Post('purchase-orders/:id/receive') @Roles(...DEPOT_ONLY) receive(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(poReceiveSchema)) b: any) { return this.svc.receive(a, id, b.accepted, b.rejected); }
}

@Module({ controllers: [ProcurementController], providers: [ProcurementService], exports: [ProcurementService] })
export class ProcurementModule {}
