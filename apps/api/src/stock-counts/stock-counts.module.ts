import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { OPNAME_REASONS, countReasonSchema, createCountSchema, opnamePolicySchema, saveCountLinesSchema, type OpnameReason } from '@sajadah/shared';
import { Database } from '../db/db';
import { depots, products, stockCountLines, stockCounts, tenants, users } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { ADMIN, CurrentActor, DEPOT_ONLY, FINANCE, Roles, STAFF } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

const rupiahText = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID');
interface Policy { tolerancePct: number; toleranceValue: number }

/** Selisih melebihi toleransi bila ada produk dengan |selisih| > persen dari stok sistem, atau total nilai |selisih| > ambang nilai. */
function exceedance(lines: { systemQty: number; countedQty: number | null; unitCost: number; name: string }[], p: Policy): { exceeds: boolean; reason: string | null } {
  const reasons: string[] = [];
  let total = 0;
  for (const l of lines) {
    if (l.countedQty == null) continue;
    const v = l.countedQty - l.systemQty;
    if (v === 0) continue;
    total += Math.abs(v) * l.unitCost;
    const pct = l.systemQty === 0 ? 100 : (Math.abs(v) / l.systemQty) * 100;
    if (pct > p.tolerancePct) reasons.push(`${l.name} ${v > 0 ? '+' : '−'}${Math.abs(v)} (${pct.toFixed(pct >= 10 ? 0 : 1)}% > ${p.tolerancePct}%)`);
  }
  if (total > p.toleranceValue) reasons.push(`nilai selisih ${rupiahText(total)} > ${rupiahText(p.toleranceValue)}`);
  return { exceeds: reasons.length > 0, reason: reasons.length ? reasons.join('; ') : null };
}

const reasonLabel = (r: string | null) => (r && r in OPNAME_REASONS ? OPNAME_REASONS[r as OpnameReason] : r ?? '—');

/**
 * Stok opname per toko, mengikuti praktik umum:
 *  1. Petugas toko membuka dokumen (OPN-xxxx): sistem membekukan snapshot stok sistem dan harga beli per produk.
 *  2. Petugas mengisi hasil hitung fisik; setiap selisih wajib beralasan (rusak, kedaluwarsa, hilang, salah catat, lainnya).
 *  3. Diajukan → disetujui pengurus (boleh juga mengembalikan untuk hitung ulang). Selisih di atas toleransi diberi tanda peringatan.
 *  4. Saat disetujui, selisih diposting sebagai penyesuaian ke kartu stok. Penyesuaian = hitung − snapshot, diterapkan ke stok saat itu,
 *     sehingga transaksi yang terjadi selama penghitungan tidak hilang. Stok tidak boleh turun di bawah jumlah yang sudah dipesan.
 *  Hanya satu opname berjalan (draf/diajukan) per toko.
 */
@Injectable()
export class StockCountsService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) {}

  async policy(tid: string, q: Database = this.db): Promise<Policy> {
    const [t] = await q.select({ pct: tenants.opnameTolerancePct, value: tenants.opnameToleranceValue }).from(tenants).where(eq(tenants.id, tid));
    return { tolerancePct: t?.pct ?? 5, toleranceValue: t?.value ?? 500_000 };
  }

  async updatePolicy(a: Actor, input: Policy) {
    return this.db.transaction(async (tx) => {
      const cur = await this.policy(a.tid, tx);
      if (cur.tolerancePct === input.tolerancePct && cur.toleranceValue === input.toleranceValue) throw new BusinessError('Toleransi sama dengan yang berlaku sekarang.');
      await tx.update(tenants).set({ opnameTolerancePct: input.tolerancePct, opnameToleranceValue: input.toleranceValue }).where(eq(tenants.id, a.tid));
      await this.core.audit(tx, a, `Toleransi selisih opname diubah: ${cur.tolerancePct}% / ${rupiahText(cur.toleranceValue)} → ${input.tolerancePct}% / ${rupiahText(input.toleranceValue)} (berlaku untuk opname yang diajukan sesudahnya)`);
      return input;
    });
  }

  private async lockCount(q: Database, a: Actor, id: string) {
    const [c] = await q.select().from(stockCounts).where(and(eq(stockCounts.tenantId, a.tid), eq(stockCounts.id, id))).for('update');
    if (!c) throw new BusinessError('Dokumen opname tidak ditemukan.');
    this.core.assertDepot(a, c.depotId);
    return c;
  }

  async list(a: Actor, depotId?: string) {
    const rows = await this.db
      .select({
        c: stockCounts, depot: depots.name,
        lines: sql<number>`count(${stockCountLines.id})`.mapWith(Number),
        counted: sql<number>`count(${stockCountLines.countedQty})`.mapWith(Number),
        qty: sql<number>`coalesce(sum(case when ${stockCountLines.countedQty} is not null then ${stockCountLines.countedQty} - ${stockCountLines.systemQty} else 0 end), 0)`.mapWith(Number),
        value: sql<number>`coalesce(sum(case when ${stockCountLines.countedQty} is not null then (${stockCountLines.countedQty} - ${stockCountLines.systemQty}) * ${stockCountLines.unitCost} else 0 end), 0)`.mapWith(Number),
      })
      .from(stockCounts)
      .innerJoin(depots, eq(depots.id, stockCounts.depotId))
      .leftJoin(stockCountLines, eq(stockCountLines.countId, stockCounts.id))
      .where(and(eq(stockCounts.tenantId, a.tid), a.did ? eq(stockCounts.depotId, a.did) : undefined, depotId ? eq(stockCounts.depotId, depotId) : undefined))
      .groupBy(stockCounts.id, depots.name)
      .orderBy(desc(stockCounts.createdAt), desc(stockCounts.no))
      .limit(100);
    return rows.map((r) => ({ ...r.c, depotName: r.depot, lineCount: r.lines, countedCount: r.counted, varianceQty: r.qty, varianceValue: r.value }));
  }

  async get(a: Actor, id: string) {
    const [c] = await this.db.select({ c: stockCounts, depot: depots.name }).from(stockCounts).innerJoin(depots, eq(depots.id, stockCounts.depotId)).where(and(eq(stockCounts.tenantId, a.tid), eq(stockCounts.id, id)));
    if (!c) throw new BusinessError('Dokumen opname tidak ditemukan.');
    this.core.assertDepot(a, c.c.depotId);
    const [ls, stock, reserved] = await Promise.all([
      this.db.select({ l: stockCountLines, sku: products.sku, name: products.name }).from(stockCountLines).innerJoin(products, eq(products.id, stockCountLines.productId)).where(eq(stockCountLines.countId, id)).orderBy(asc(products.sku)),
      this.core.stockMap(this.db, c.c.depotId),
      this.core.reservedMap(this.db, a.tid, c.c.depotId),
    ]);
    const lines = ls.map(({ l, sku, name }) => {
      const variance = l.countedQty == null ? null : l.countedQty - l.systemQty;
      const current = stock.get(l.productId)?.physical ?? 0;
      return {
        id: l.id, productId: l.productId, sku, name, systemQty: l.systemQty, countedQty: l.countedQty, reason: l.reason, note: l.note, unitCost: l.unitCost,
        variance, value: variance == null ? null : variance * l.unitCost, reserved: reserved.get(l.productId) ?? 0, current, moved: current - l.systemQty, postedDelta: l.postedDelta,
      };
    });
    const counted = lines.filter((l) => l.variance != null);
    const totals = {
      lines: lines.length, counted: counted.length,
      varianceQty: counted.reduce((s, l) => s + l.variance!, 0), varianceValue: counted.reduce((s, l) => s + l.value!, 0),
      gain: counted.filter((l) => l.variance! > 0).reduce((s, l) => s + l.value!, 0), loss: counted.filter((l) => l.variance! < 0).reduce((s, l) => s + l.value!, 0),
    };
    const policy = await this.policy(a.tid);
    const live = exceedance(lines.map((l) => ({ systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost, name: l.name })), policy);
    const frozen = c.c.status === 'draft' || c.c.status === 'cancelled';
    const canApprove = c.c.status === 'submitted' && a.role === 'tenant_admin';
    return {
      ...c.c, depotName: c.depot, lines, totals, policy, needsAdmin: frozen ? live.exceeds : c.c.needsAdmin, exceedReason: frozen ? live.reason : c.c.exceedReason,
      /** Hanya pengurus yang menyetujui/mengembalikan dokumen yang sudah diajukan. */
      canApprove,
    };
  }

  async create(a: Actor, input: { depotId?: string; note?: string }) {
    return this.db.transaction(async (tx) => {
      const depot = await this.core.depotFor(tx, a, input.depotId);
      const [open] = await tx.select({ no: stockCounts.no }).from(stockCounts).where(and(eq(stockCounts.depotId, depot.id), inArray(stockCounts.status, ['draft', 'submitted'])));
      if (open) throw new BusinessError(`Masih ada opname yang berjalan di ${depot.name} (${open.no}). Selesaikan atau batalkan dulu.`);
      const stock = await this.core.stockMap(tx, depot.id);
      const ps = await tx.select().from(products).where(eq(products.tenantId, a.tid)).orderBy(asc(products.sku));
      const rows = ps.filter((p) => p.active || (stock.get(p.id)?.physical ?? 0) !== 0);
      if (!rows.length) throw new BusinessError('Belum ada produk untuk dihitung.');
      const no = await this.core.docNo(tx, a.tid, 'OPN');
      const [c] = await tx.insert(stockCounts).values({ tenantId: a.tid, depotId: depot.id, no, note: input.note || null, createdById: a.sub, createdByName: a.name }).returning();
      await tx.insert(stockCountLines).values(rows.map((p) => ({ countId: c!.id, productId: p.id, systemQty: stock.get(p.id)?.physical ?? 0, unitCost: p.buyPrice })));
      await this.core.audit(tx, a, `Opname ${no} dimulai di ${depot.name} (${rows.length} produk)`);
      return { id: c!.id, no };
    });
  }

  /** Simpan hasil hitung per baris (draf saja). countedQty null = kosongkan hitungan. */
  async saveLines(a: Actor, id: string, input: { lines: { lineId: string; countedQty: number | null; reason?: string | null; note?: string | null }[] }) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockCount(tx, a, id);
      if (c.status !== 'draft') throw new BusinessError('Hitungan hanya bisa diubah saat opname berstatus draf.');
      const ls = await tx.select().from(stockCountLines).where(eq(stockCountLines.countId, id));
      const byId = new Map(ls.map((l) => [l.id, l]));
      for (const x of input.lines) {
        if (!byId.has(x.lineId)) throw new BusinessError('Baris opname tidak dikenal.');
        const l = byId.get(x.lineId)!;
        const diff = x.countedQty != null && x.countedQty !== l.systemQty;
        await tx.update(stockCountLines).set({ countedQty: x.countedQty, reason: diff ? x.reason ?? null : null, note: x.note?.trim() || null }).where(eq(stockCountLines.id, x.lineId));
      }
      return { ok: true, saved: input.lines.length };
    });
  }

  async submit(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockCount(tx, a, id);
      if (c.status !== 'draft') throw new BusinessError('Hanya opname berstatus draf yang dapat diajukan.');
      const ls = await tx.select({ l: stockCountLines, name: products.name }).from(stockCountLines).innerJoin(products, eq(products.id, stockCountLines.productId)).where(eq(stockCountLines.countId, id));
      const counted = ls.filter((x) => x.l.countedQty != null);
      if (!counted.length) throw new BusinessError('Belum ada hasil hitung. Isi hitungan fisik minimal satu produk.');
      const reserved = await this.core.reservedMap(tx, a.tid, c.depotId);
      const noReason = counted.filter((x) => x.l.countedQty !== x.l.systemQty && !x.l.reason);
      if (noReason.length) throw new BusinessError(`Isi alasan selisih untuk: ${noReason.map((x) => x.name).join(', ')}.`);
      const noNote = counted.filter((x) => x.l.reason === 'lainnya' && !x.l.note?.trim());
      if (noNote.length) throw new BusinessError(`Alasan "Lainnya" perlu catatan: ${noNote.map((x) => x.name).join(', ')}.`);
      const low = counted.filter((x) => x.l.countedQty! < (reserved.get(x.l.productId) ?? 0));
      if (low.length) throw new BusinessError(`Hasil hitung tidak boleh kurang dari jumlah yang sudah dipesan: ${low.map((x) => `${x.name} (dipesan ${reserved.get(x.l.productId)})`).join(', ')}.`);
      const ex = exceedance(counted.map((x) => ({ systemQty: x.l.systemQty, countedQty: x.l.countedQty, unitCost: x.l.unitCost, name: x.name })), await this.policy(a.tid, tx));
      await tx.update(stockCounts).set({ status: 'submitted', submittedById: a.sub, submittedByName: a.name, submittedAt: new Date(), returnNote: null, needsAdmin: ex.exceeds, exceedReason: ex.reason }).where(eq(stockCounts.id, id));
      await this.core.audit(tx, a, `Opname ${c.no} diajukan untuk persetujuan (${counted.length} produk dihitung)${ex.exceeds ? `; melebihi toleransi, periksa teliti sebelum disetujui: ${ex.reason}` : ''}`);
      return { ok: true };
    });
  }

  /** Setujui dan posting penyesuaian ke kartu stok. */
  async approve(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockCount(tx, a, id);
      if (c.status !== 'submitted') throw new BusinessError('Hanya opname yang sudah diajukan yang dapat disetujui.');
      const ls = await tx.select({ l: stockCountLines, name: products.name }).from(stockCountLines).innerJoin(products, eq(products.id, stockCountLines.productId)).where(eq(stockCountLines.countId, id)).orderBy(asc(stockCountLines.productId));
      const reserved = await this.core.reservedMap(tx, a.tid, c.depotId);
      let qty = 0, value = 0, adjusted = 0;
      for (const { l, name } of ls) {
        if (l.countedQty == null) continue;
        const delta = l.countedQty - l.systemQty;
        if (delta === 0) { await tx.update(stockCountLines).set({ postedDelta: 0 }).where(eq(stockCountLines.id, l.id)); continue; }
        const st = await this.core.lockStock(tx, c.depotId, l.productId);
        if (st.physical + delta < (reserved.get(l.productId) ?? 0)) throw new BusinessError(`Penyesuaian ${name} akan membuat stok (${st.physical + delta}) di bawah jumlah yang sudah dipesan (${reserved.get(l.productId) ?? 0}). Kembalikan opname untuk dihitung ulang.`);
        await this.core.moveStock(tx, a, { depotId: c.depotId, productId: l.productId, delta, type: 'opname', refNo: c.no, note: `${reasonLabel(l.reason)}${l.note ? ` — ${l.note}` : ''}` });
        await tx.update(stockCountLines).set({ postedDelta: delta }).where(eq(stockCountLines.id, l.id));
        qty += delta; value += delta * l.unitCost; adjusted += 1;
      }
      await tx.update(stockCounts).set({ status: 'approved', approvedById: a.sub, approvedByName: a.name, approvedAt: new Date() }).where(eq(stockCounts.id, id));
      await this.core.audit(tx, a, `Opname ${c.no} disetujui dan diposting: ${adjusted} produk disesuaikan, selisih ${qty > 0 ? '+' : ''}${qty} (nilai ${value > 0 ? '+' : ''}${value})`);
      return { ok: true, adjusted, varianceQty: qty, varianceValue: value };
    });
  }

  /** Penyetuju mengembalikan ke draf agar dihitung ulang (alasan wajib). */
  async reject(a: Actor, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockCount(tx, a, id);
      if (c.status !== 'submitted') throw new BusinessError('Hanya opname yang sudah diajukan yang dapat dikembalikan.');
      await tx.update(stockCounts).set({ status: 'draft', returnNote: reason, submittedById: null, submittedByName: null, submittedAt: null }).where(eq(stockCounts.id, id));
      await this.core.audit(tx, a, `Opname ${c.no} dikembalikan untuk dihitung ulang: ${reason}`);
      return { ok: true };
    });
  }

  async cancel(a: Actor, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.lockCount(tx, a, id);
      if (c.status !== 'draft' && c.status !== 'submitted') throw new BusinessError('Opname yang sudah disetujui atau dibatalkan tidak dapat dibatalkan.');
      await tx.update(stockCounts).set({ status: 'cancelled', cancelReason: reason }).where(eq(stockCounts.id, id));
      await this.core.audit(tx, a, `Opname ${c.no} dibatalkan: ${reason}`);
      return { ok: true };
    });
  }
}

@Controller('stock-counts')
@Roles(...STAFF)
class StockCountsController {
  constructor(private readonly svc: StockCountsService) {}
  @Get() list(@CurrentActor() a: Actor, @Query('depotId') depotId?: string) { return this.svc.list(a, depotId); }
  @Get('policy') policy(@CurrentActor() a: Actor) { return this.svc.policy(a.tid); }
  @Put('policy') @Roles(...ADMIN) setPolicy(@CurrentActor() a: Actor, @Body(new ZodPipe(opnamePolicySchema)) b: any) { return this.svc.updatePolicy(a, b); }
  @Get(':id') get(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(a, id); }
  @Post() @Roles(...DEPOT_ONLY) create(@CurrentActor() a: Actor, @Body(new ZodPipe(createCountSchema)) b: any) { return this.svc.create(a, b); }
  @Put(':id/lines') @Roles(...DEPOT_ONLY) save(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(saveCountLinesSchema)) b: any) { return this.svc.saveLines(a, id, b); }
  @Post(':id/submit') @Roles(...DEPOT_ONLY) submit(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.submit(a, id); }
  @Post(':id/approve') @Roles(...FINANCE) approve(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.approve(a, id); }
  @Post(':id/reject') @Roles(...FINANCE) reject(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(countReasonSchema)) b: any) { return this.svc.reject(a, id, b.reason); }
  @Post(':id/cancel') @Roles(...DEPOT_ONLY) cancel(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(countReasonSchema)) b: any) { return this.svc.cancel(a, id, b.reason); }
}

@Module({ controllers: [StockCountsController], providers: [StockCountsService] })
export class StockCountsModule {}
