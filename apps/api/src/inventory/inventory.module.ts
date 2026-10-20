import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { stockQtySchema, replenishmentNeed, suggestOrderQty } from '@sajadah/shared';
import { Database } from '../db/db';
import { products, stockMovements } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { ADMIN, CurrentActor, DEPOT_ONLY, OPS, Roles, STAFF } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

@Injectable()
export class InventoryService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) {}

  /** Kartu stok satu toko: fisik, reservasi, tersedia, transit, kebutuhan & usulan beli. */
  async list(a: Actor, depotId?: string) {
    const depot = await this.core.depotFor(this.db, a, depotId);
    const [rows, reserved, openPo, stock] = await Promise.all([
      this.db.select().from(products).where(eq(products.tenantId, a.tid)).orderBy(asc(products.sku)),
      this.core.reservedMap(this.db, a.tid, depot.id),
      this.core.openPoMap(this.db, a.tid, depot.id),
      this.core.stockMap(this.db, depot.id),
    ]);
    return rows.map((p) => {
      const st = stock.get(p.id) ?? { physical: 0, inTransit: 0 };
      const res = reserved.get(p.id) ?? 0;
      const open = openPo.get(p.id) ?? 0;
      const need = replenishmentNeed({ ...p, ...st }, res, open);
      return { ...p, ...st, depotId: depot.id, location: depot.name, reserved: res, available: st.physical - res, openPo: open, need, suggestion: suggestOrderQty(need, p.moq, p.multiple) };
    });
  }

  private async lock(q: Database, tid: string, id: string) {
    const [p] = await q.select().from(products).where(and(eq(products.tenantId, tid), eq(products.id, id))).for('update');
    if (!p) throw new BusinessError('Produk tidak ditemukan');
    return p;
  }

  async toggle(a: Actor, id: string, field: 'active' | 'autoReplenish') {
    return this.db.transaction(async (tx) => {
      const p = await this.lock(tx, a.tid, id);
      const value = !p[field];
      await tx.update(products).set({ [field]: value }).where(eq(products.id, id));
      await this.core.audit(tx, a, `${field === 'active' ? 'Status' : 'Aturan'} ${p.name}: ${value ? 'aktif' : 'nonaktif'}`);
      return { [field]: value };
    });
  }

  /** Barang masuk di toko (petugas toko itu): menambah stok fisik dan tercatat di kartu stok. */
  async receive(a: Actor, id: string, qty: number, depotId?: string) {
    return this.db.transaction(async (tx) => {
      const p = await this.lock(tx, a.tid, id);
      const depot = await this.core.depotFor(tx, a, depotId);
      const physical = await this.core.moveStock(tx, a, { depotId: depot.id, productId: id, delta: qty, type: 'receipt', note: 'Barang masuk' });
      await this.core.audit(tx, a, `Barang masuk ${qty} ${p.name} tercatat di ${depot.name}`);
      return { physical };
    });
  }

  /** Kartu stok: mutasi terbaru satu produk di satu toko (terbaru di atas). */
  async movements(a: Actor, id: string, depotId: string | undefined, limit: number) {
    const depot = await this.core.depotFor(this.db, a, depotId);
    const rows = await this.db.select().from(stockMovements)
      .where(and(eq(stockMovements.tenantId, a.tid), eq(stockMovements.depotId, depot.id), eq(stockMovements.productId, id)))
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id)).limit(limit);
    return rows.map((r) => ({ id: r.id, at: r.createdAt, type: r.type, qty: r.qty, balanceAfter: r.balanceAfter, refNo: r.refNo, note: r.note, actor: r.actorName }));
  }
}

@Controller('products')
@Roles(...STAFF)
class InventoryController {
  constructor(private readonly svc: InventoryService) {}
  @Get() list(@CurrentActor() a: Actor, @Query('depotId') depotId?: string) { return this.svc.list(a, depotId); }
  @Patch(':id/active') @Roles(...ADMIN) active(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.toggle(a, id, 'active'); }
  @Patch(':id/auto') @Roles(...OPS) auto(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.toggle(a, id, 'autoReplenish'); }
  @Post(':id/receipts') @Roles(...DEPOT_ONLY) receive(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(stockQtySchema)) b: any) { return this.svc.receive(a, id, b.qty, b.depotId); }
  @Get(':id/movements') movements(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query('depotId') depotId?: string, @Query('limit') limit?: string) { return this.svc.movements(a, id, depotId, Math.min(200, Math.max(1, Math.floor(Number(limit ?? 50)) || 50))); }
}

@Module({ controllers: [InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
