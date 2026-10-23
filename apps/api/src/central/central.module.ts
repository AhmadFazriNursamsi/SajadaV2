import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { REWARD_PERCENT, SHIPMENT_ISSUES, type ShipmentIssue, cancelShipmentSchema, centralReceiptSchema, createProductSchema, createShipmentSchema, createStockRequestSchema, fulfillStockRequestSchema, receiveShipmentSchema, rejectStockRequestSchema, updateProductSchema } from '@sajadah/shared';
import type { z } from 'zod';
import { Database } from '../db/db';
import { centralMovements, centralStock, depotStock, depots, products, shipmentLines, shipments, stockRequestLines, stockRequests } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { ADMIN, CurrentActor, DEPOT_ONLY, Roles, STAFF } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

type Q = Database;

/**
 * Pengurus: master produk (buat/ubah), stok gudang pusat, dan pengiriman pusat → toko.
 * Pengiriman mengurangi stok pusat dan menambah "dalam perjalanan" di toko; stok toko baru bertambah saat
 * petugas/pengurus toko menekan Terima.
 */
@Injectable()
export class CentralService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) {}

  // ───────────── Produk ─────────────
  private async nextSku(q: Q, tid: string): Promise<string> {
    const rows = await q.select({ sku: products.sku }).from(products).where(eq(products.tenantId, tid));
    const n = rows.reduce((m, r) => Math.max(m, Number(/^[A-Z]+-(\d+)$/.exec(r.sku)?.[1] ?? 0)), 0) + 1;
    return `PRD-${String(n).padStart(2, '0')}`;
  }

  async createProduct(a: Actor, input: z.infer<typeof createProductSchema>) {
    return this.db.transaction(async (tx) => {
      const sku = input.sku ?? (await this.nextSku(tx, a.tid));
      const [dupSku] = await tx.select({ id: products.id }).from(products).where(and(eq(products.tenantId, a.tid), eq(products.sku, sku)));
      if (dupSku) throw new BusinessError(`SKU ${sku} sudah dipakai produk lain.`);
      const [dupName] = await tx.select({ id: products.id }).from(products).where(and(eq(products.tenantId, a.tid), sql`lower(${products.name}) = lower(${input.name})`));
      if (dupName) throw new BusinessError(`Produk bernama “${input.name}” sudah ada.`);
      const [p] = await tx.insert(products).values({ tenantId: a.tid, sku, name: input.name, buyPrice: input.buyPrice, sellPrice: input.sellPrice, safety: input.safety, target: input.target, category: input.category || null, description: input.description || null, coins: input.coins ?? 0, rewardPercent: input.rewardPercent ?? REWARD_PERCENT }).returning();
      await this.core.audit(tx, a, `Produk baru ${p!.name} (${sku}): harga jual Rp${input.sellPrice.toLocaleString('id-ID')}`);
      return p!;
    });
  }

  async updateProduct(a: Actor, id: string, input: z.infer<typeof updateProductSchema>) {
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(products).where(and(eq(products.tenantId, a.tid), eq(products.id, id))).for('update');
      if (!p) throw new BusinessError('Produk tidak ditemukan.');
      const next = { name: input.name ?? p.name, buyPrice: input.buyPrice ?? p.buyPrice, sellPrice: input.sellPrice ?? p.sellPrice, safety: input.safety ?? p.safety, target: input.target ?? p.target,
        category: input.category === undefined ? p.category : input.category || null, description: input.description === undefined ? p.description : input.description || null, coins: input.coins ?? p.coins, rewardPercent: input.rewardPercent ?? p.rewardPercent };
      if (next.target < next.safety) throw new BusinessError('Target stok tidak boleh di bawah stok aman.');
      if (next.name.toLowerCase() !== p.name.toLowerCase()) {
        const [dup] = await tx.select({ id: products.id }).from(products).where(and(eq(products.tenantId, a.tid), sql`lower(${products.name}) = lower(${next.name})`));
        if (dup) throw new BusinessError(`Produk bernama “${next.name}” sudah ada.`);
      }
      const changes: string[] = [];
      if (next.name !== p.name) changes.push(`nama ${p.name} → ${next.name}`);
      if (next.sellPrice !== p.sellPrice) changes.push(`harga ${p.sellPrice} → ${next.sellPrice}`);
      if (next.safety !== p.safety) changes.push(`stok aman ${p.safety} → ${next.safety}`);
      if (next.target !== p.target) changes.push(`target ${p.target} → ${next.target}`);
      if (next.category !== p.category) changes.push('kategori');
      if (next.description !== p.description) changes.push('deskripsi');
      if (next.coins !== p.coins) changes.push(`koin ${p.coins} → ${next.coins}`);
      if (next.rewardPercent !== p.rewardPercent) changes.push(`imbalan saldo penarikan ${p.rewardPercent}% → ${next.rewardPercent}%`);
      if (!changes.length) throw new BusinessError('Tidak ada yang diubah.');
      const [u] = await tx.update(products).set(next).where(eq(products.id, id)).returning();
      await this.core.audit(tx, a, `Produk ${p.sku} diubah: ${changes.join('; ')} (pesanan lama tetap memakai harga saat dibuat)`);
      return u!;
    });
  }

  // ───────────── Stok gudang pusat ─────────────
  /** Produk + stok pusat + yang sedang dalam perjalanan ke toko + total stok di semua toko (hanya baca). */
  async stock(a: Actor) {
    const [ps, cs, onWay, atDepots, perDepot] = await Promise.all([
      this.db.select().from(products).where(eq(products.tenantId, a.tid)).orderBy(asc(products.sku)),
      this.db.select().from(centralStock).where(eq(centralStock.tenantId, a.tid)),
      this.db.select({ productId: shipmentLines.productId, qty: sql<number>`coalesce(sum(${shipmentLines.qty}), 0)`.mapWith(Number) }).from(shipmentLines).innerJoin(shipments, eq(shipments.id, shipmentLines.shipmentId)).where(and(eq(shipments.tenantId, a.tid), eq(shipments.status, 'in_transit'))).groupBy(shipmentLines.productId),
      this.db.select({ productId: depotStock.productId, qty: sql<number>`coalesce(sum(${depotStock.physical}), 0)`.mapWith(Number) }).from(depotStock).innerJoin(depots, eq(depots.id, depotStock.depotId)).where(eq(depots.tenantId, a.tid)).groupBy(depotStock.productId),
      this.db.select({ depotId: depotStock.depotId, productId: depotStock.productId, physical: depotStock.physical, inTransit: depotStock.inTransit }).from(depotStock).innerJoin(depots, eq(depots.id, depotStock.depotId)).where(eq(depots.tenantId, a.tid)),
    ]);
    return ps.map((p) => ({
      ...p, central: cs.find((c) => c.productId === p.id)?.physical ?? 0, onTheWay: onWay.find((o) => o.productId === p.id)?.qty ?? 0, atDepots: atDepots.find((d) => d.productId === p.id)?.qty ?? 0,
      /** Stok tiap toko untuk produk ini (toko tanpa baris = 0). */
      byDepot: Object.fromEntries(perDepot.filter((x) => x.productId === p.id).map((x) => [x.depotId, { physical: x.physical, inTransit: x.inTransit }])),
    }));
  }

  private async lockCentral(q: Q, tid: string, productId: string) {
    await q.insert(centralStock).values({ tenantId: tid, productId }).onConflictDoNothing();
    const [r] = await q.select().from(centralStock).where(and(eq(centralStock.tenantId, tid), eq(centralStock.productId, productId))).for('update');
    return r!;
  }

  private async moveCentral(q: Q, a: Actor, m: { productId: string; delta: number; type: typeof centralMovements.$inferInsert['type']; refNo?: string | null; note?: string | null }): Promise<number> {
    const st = await this.lockCentral(q, a.tid, m.productId);
    const next = st.physical + m.delta;
    if (next < 0) throw new BusinessError('Stok pusat tidak mencukupi.');
    await q.update(centralStock).set({ physical: next }).where(and(eq(centralStock.tenantId, a.tid), eq(centralStock.productId, m.productId)));
    await q.insert(centralMovements).values({ tenantId: a.tid, productId: m.productId, type: m.type, qty: m.delta, balanceAfter: next, refNo: m.refNo ?? null, note: m.note ?? null, actorName: a.name });
    return next;
  }

  async receiveCentral(a: Actor, input: z.infer<typeof centralReceiptSchema>) {
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(products).where(and(eq(products.tenantId, a.tid), eq(products.id, input.productId)));
      if (!p) throw new BusinessError('Produk tidak ditemukan.');
      const physical = await this.moveCentral(tx, a, { productId: p.id, delta: input.qty, type: 'receipt', note: input.note || 'Barang masuk gudang pusat' });
      await this.core.audit(tx, a, `Barang masuk gudang pusat: ${input.qty} ${p.name}`);
      return { physical };
    });
  }

  async centralMovementsOf(a: Actor, productId: string, limit: number) {
    const rows = await this.db.select().from(centralMovements).where(and(eq(centralMovements.tenantId, a.tid), eq(centralMovements.productId, productId))).orderBy(desc(centralMovements.createdAt), desc(centralMovements.id)).limit(limit);
    return rows.map((r) => ({ id: r.id, at: r.createdAt, type: r.type, qty: r.qty, balanceAfter: r.balanceAfter, refNo: r.refNo, note: r.note, actor: r.actorName }));
  }

  // ───────────── Pengiriman pusat → toko ─────────────
  async ship(a: Actor, input: z.infer<typeof createShipmentSchema>) {
    return this.db.transaction((tx) => this.shipTx(tx, a, input));
  }

  /** Buat kiriman di dalam transaksi pemanggil (dipakai juga saat memproses permintaan stok). */
  private async shipTx(tx: Q, a: Actor, input: z.infer<typeof createShipmentSchema>, extraAudit = '') {
    {
      const depot = await this.core.depotFor(tx, a, input.depotId);
      const items = [...input.items].sort((x, y) => x.productId.localeCompare(y.productId)); // urutan tetap → tanpa deadlock
      const ps = await tx.select().from(products).where(and(eq(products.tenantId, a.tid), inArray(products.id, items.map((i) => i.productId))));
      if (ps.length !== items.length) throw new BusinessError('Ada produk yang tidak ditemukan.');
      const off = ps.find((p) => !p.active);
      if (off) throw new BusinessError(`Produk ${off.name} nonaktif; aktifkan dulu sebelum dikirim.`);
      const no = await this.core.docNo(tx, a.tid, 'KRM');
      const [sh] = await tx.insert(shipments).values({ tenantId: a.tid, no, depotId: depot.id, note: input.note || null, createdByName: a.name }).returning();
      for (const it of items) {
        const p = ps.find((x) => x.id === it.productId)!;
        const st = await this.lockCentral(tx, a.tid, it.productId);
        if (st.physical < it.qty) throw new BusinessError(`Stok pusat ${p.name} hanya ${st.physical} (diminta ${it.qty}).`);
        await this.moveCentral(tx, a, { productId: it.productId, delta: -it.qty, type: 'shipment', refNo: no, note: `Dikirim ke ${depot.name}` });
        await this.core.lockStock(tx, depot.id, it.productId);
        await tx.update(depotStock).set({ inTransit: sql`${depotStock.inTransit} + ${it.qty}` }).where(and(eq(depotStock.depotId, depot.id), eq(depotStock.productId, it.productId)));
        await tx.insert(shipmentLines).values({ shipmentId: sh!.id, productId: it.productId, qty: it.qty });
      }
      const total = items.reduce((s, i) => s + i.qty, 0);
      await this.core.audit(tx, a, `Pengiriman ${no} ke ${depot.name}: ${items.map((i) => `${i.qty} ${ps.find((p) => p.id === i.productId)!.name}`).join(', ')} (total ${total})${extraAudit}`);
      await this.core.notifyDepotStaff(tx, { tenantId: a.tid, depotId: depot.id, tab: 'info', cat: 'Kiriman', title: 'Kiriman barang dari pusat', body: `${no}: ${total} barang menuju ${depot.name}. Periksa saat tiba.`, route: 'staff-receive', refId: sh!.id });
      return { id: sh!.id, no, depotName: depot.name };
    }
  }

  /** Daftar pengiriman terbaru. Petugas toko hanya melihat kiriman ke tokonya. */
  async shipments(a: Actor, q: { depotId?: string; status?: string }) {
    const status = q.status === 'in_transit' || q.status === 'received' || q.status === 'cancelled' ? q.status : undefined;
    const depotId = a.did ?? q.depotId;
    const rows = await this.db.select({ s: shipments, depot: depots.name }).from(shipments).innerJoin(depots, eq(depots.id, shipments.depotId))
      .where(and(eq(shipments.tenantId, a.tid), depotId ? eq(shipments.depotId, depotId) : undefined, status ? eq(shipments.status, status) : undefined))
      .orderBy(desc(shipments.createdAt), desc(shipments.id)).limit(100);
    const lines = rows.length ? await this.db.select({ l: shipmentLines, name: products.name, sku: products.sku }).from(shipmentLines).innerJoin(products, eq(products.id, shipmentLines.productId)).where(inArray(shipmentLines.shipmentId, rows.map((r) => r.s.id))) : [];
    // Permintaan yang dijawab kiriman ini (bila ada): supaya toko melihat apa yang diminta dan apa yang akhirnya dikirim.
    const reqs = rows.length ? await this.db.select({ r: stockRequests, l: stockRequestLines }).from(stockRequests).innerJoin(stockRequestLines, eq(stockRequestLines.requestId, stockRequests.id)).where(inArray(stockRequests.shipmentId, rows.map((r) => r.s.id))) : [];
    return rows.map(({ s, depot }) => {
      const rq = reqs.filter((x) => x.r.shipmentId === s.id);
      const request = rq.length ? { no: rq[0]!.r.no, note: rq[0]!.r.note, lines: rq.map((x) => ({ productId: x.l.productId, qty: x.l.qty, qtySent: x.l.qtySent })) } : null;
      const ls = lines.filter((x) => x.l.shipmentId === s.id).map((x) => ({ productId: x.l.productId, name: x.name, sku: x.sku, qty: x.l.qty, qtyReceived: x.l.qtyReceived, issue: x.l.issue, issueNote: x.l.issueNote }));
      return { ...s, depotName: depot, lines: ls, totalQty: ls.reduce((n, l) => n + l.qty, 0), hasIssue: ls.some((l) => l.qtyReceived != null && l.qtyReceived !== l.qty), request };
    });
  }

  private async lockShipment(tx: Q, a: Actor, id: string) {
    const [s] = await tx.select().from(shipments).where(and(eq(shipments.tenantId, a.tid), eq(shipments.id, id))).for('update');
    if (!s) throw new BusinessError('Pengiriman tidak ditemukan.');
    return s;
  }

  /** Toko menerima kiriman: stok toko bertambah, "dalam perjalanan" berkurang, tercatat di kartu stok toko. */
  async receiveShipment(a: Actor, id: string, input: z.infer<typeof receiveShipmentSchema>) {
    return this.db.transaction(async (tx) => {
      const s = await this.lockShipment(tx, a, id);
      this.core.assertDepot(a, s.depotId);
      if (s.status !== 'in_transit') throw new BusinessError(s.status === 'received' ? 'Pengiriman ini sudah diterima.' : 'Pengiriman ini sudah dibatalkan.');
      const ls = await tx.select({ l: shipmentLines, name: products.name }).from(shipmentLines).innerJoin(products, eq(products.id, shipmentLines.productId)).where(eq(shipmentLines.shipmentId, id)).orderBy(asc(shipmentLines.productId));
      const checks = new Map((input.items ?? []).map((i) => [i.productId, i]));
      for (const i of input.items ?? []) if (!ls.some(({ l }) => l.productId === i.productId)) throw new BusinessError('Ada produk yang tidak ada di kiriman ini.');
      if ((input.items ?? []).length !== checks.size) throw new BusinessError('Produk yang sama tidak boleh dua kali.');
      // Validasi pemeriksaan: tidak boleh lebih dari dikirim; selisih wajib beralasan.
      const diffs: string[] = [];
      for (const { l, name } of ls) {
        const c = checks.get(l.productId);
        const got = c ? c.qty : l.qty;
        if (got > l.qty) {
          // Kelebihan fisik: tetap diterima (barangnya memang ada), tetapi wajib dijelaskan agar pengurus bisa menelusuri.
          if (!c?.note?.trim()) throw new BusinessError(`${name}: diterima ${got}, lebih dari ${l.qty} dikirim. Jelaskan kelebihannya di catatan.`);
          diffs.push(`${name} ${got}/${l.qty} (${SHIPMENT_ISSUES.lebih}: ${c.note.trim()})`);
        } else if (got < l.qty) {
          if (!c?.issue) throw new BusinessError(`${name}: jumlah diterima ${got} dari ${l.qty} dikirim. Pilih alasan selisihnya.`);
          if (c.issue === 'lebih') throw new BusinessError(`${name}: alasan “lebih” hanya untuk jumlah yang melebihi kiriman.`);
          if (c.issue === 'lainnya' && !c.note?.trim()) throw new BusinessError(`${name}: alasan “Lainnya” perlu dijelaskan di catatan.`);
          diffs.push(`${name} ${got}/${l.qty} (${SHIPMENT_ISSUES[c.issue as ShipmentIssue] ?? c.issue}${c.note ? `: ${c.note}` : ''})`);
        }
      }
      for (const { l } of ls) {
        const c = checks.get(l.productId);
        const got = c ? c.qty : l.qty;
        if (got > 0) await this.core.moveStock(tx, a, { depotId: s.depotId, productId: l.productId, delta: got, type: 'transfer_in', refNo: s.no, note: got < l.qty ? `Kiriman dari pusat diterima sebagian (${got} dari ${l.qty})` : got > l.qty ? `Kiriman dari pusat diterima lebih (${got} dari ${l.qty} dikirim)` : 'Kiriman dari pusat diterima', transitDelta: -l.qty });
        else {
          const st = await this.core.lockStock(tx, s.depotId, l.productId);
          if (st.inTransit < l.qty) throw new BusinessError('Data perjalanan toko tidak cocok; hubungi pengurus.');
          await tx.update(depotStock).set({ inTransit: st.inTransit - l.qty }).where(and(eq(depotStock.depotId, s.depotId), eq(depotStock.productId, l.productId)));
        }
        await tx.update(shipmentLines).set({ qtyReceived: got, issue: got < l.qty ? c!.issue! : got > l.qty ? 'lebih' : null, issueNote: got !== l.qty ? c!.note?.trim() || null : null }).where(eq(shipmentLines.id, l.id));
      }
      await tx.update(shipments).set({ status: 'received', receivedAt: new Date(), receivedByName: a.name, receiveNote: input.note || null }).where(eq(shipments.id, id));
      await this.core.audit(tx, a, `Pengiriman ${s.no} diterima di toko: ${ls.map(({ l, name }) => `${checks.get(l.productId)?.qty ?? l.qty} ${name}`).join(', ')}${diffs.length ? `; SELISIH: ${diffs.join('; ')}` : ' (sesuai kiriman)'}`);
      return { id, status: 'received' };
    });
  }

  /** Batalkan kiriman yang belum diterima: stok kembali ke pusat dan angka perjalanan toko dikurangi. */
  async cancelShipment(a: Actor, id: string, input: z.infer<typeof cancelShipmentSchema>) {
    return this.db.transaction(async (tx) => {
      const s = await this.lockShipment(tx, a, id);
      if (s.status !== 'in_transit') throw new BusinessError(s.status === 'received' ? 'Kiriman sudah diterima toko; tidak bisa dibatalkan.' : 'Pengiriman ini sudah dibatalkan.');
      const ls = await tx.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, id)).orderBy(asc(shipmentLines.productId));
      for (const l of ls) {
        await this.moveCentral(tx, a, { productId: l.productId, delta: l.qty, type: 'shipment_cancel', refNo: s.no, note: `Dibatalkan: ${input.reason}` });
        const st = await this.core.lockStock(tx, s.depotId, l.productId);
        if (st.inTransit < l.qty) throw new BusinessError('Data perjalanan toko tidak cocok; hubungi pengurus.');
        await tx.update(depotStock).set({ inTransit: st.inTransit - l.qty }).where(and(eq(depotStock.depotId, s.depotId), eq(depotStock.productId, l.productId)));
      }
      await tx.update(shipments).set({ status: 'cancelled', cancelledAt: new Date(), cancelledByName: a.name, cancelReason: input.reason }).where(eq(shipments.id, id));
      await this.core.audit(tx, a, `Pengiriman ${s.no} dibatalkan: ${input.reason}`);
      return { id, status: 'cancelled' };
    });
  }

  // ───────────── Permintaan stok toko → pusat ─────────────
  async createRequest(a: Actor, input: z.infer<typeof createStockRequestSchema>) {
    return this.db.transaction(async (tx) => {
      const depot = await this.core.depotFor(tx, a, input.depotId);
      const ps = await tx.select().from(products).where(and(eq(products.tenantId, a.tid), inArray(products.id, input.items.map((i) => i.productId))));
      if (ps.length !== input.items.length) throw new BusinessError('Ada produk yang tidak ditemukan.');
      const off = ps.find((p) => !p.active);
      if (off) throw new BusinessError(`Produk ${off.name} nonaktif; tidak bisa diminta.`);
      const no = await this.core.docNo(tx, a.tid, 'REQ');
      const invoiceNo = await this.core.docNo(tx, a.tid, 'INV');
      const [r] = await tx.insert(stockRequests).values({ tenantId: a.tid, no, invoiceNo, depotId: depot.id, note: input.note || null, createdById: a.sub, createdByName: a.name }).returning();
      await tx.insert(stockRequestLines).values(input.items.map((i) => ({ requestId: r!.id, productId: i.productId, qty: i.qty, unitPrice: ps.find((p) => p.id === i.productId)!.sellPrice })));
      await this.core.audit(tx, a, `Permintaan stok ${no} (invoice ${invoiceNo}) dari ${depot.name}: ${input.items.map((i) => `${i.qty} ${ps.find((p) => p.id === i.productId)!.name}`).join(', ')}`);
      return { id: r!.id, no };
    });
  }

  /** Daftar permintaan. Petugas hanya melihat tokonya dan tidak melihat stok pusat; pengurus melihat stok pusat saat ini per baris. */
  async requests(a: Actor, q: { depotId?: string; status?: string }) {
    const status = q.status === 'pending' || q.status === 'sent' || q.status === 'rejected' || q.status === 'cancelled' ? q.status : undefined;
    const depotId = a.did ?? q.depotId;
    const rows = await this.db.select({ r: stockRequests, depot: depots.name }).from(stockRequests).innerJoin(depots, eq(depots.id, stockRequests.depotId))
      .where(and(eq(stockRequests.tenantId, a.tid), depotId ? eq(stockRequests.depotId, depotId) : undefined, status ? eq(stockRequests.status, status) : undefined))
      .orderBy(desc(stockRequests.createdAt), desc(stockRequests.id)).limit(100);
    const ids = rows.map((x) => x.r.id);
    const shipIds = rows.map((x) => x.r.shipmentId).filter((x): x is string => !!x);
    const [lines, central, ships] = await Promise.all([
      ids.length ? this.db.select({ l: stockRequestLines, name: products.name, sku: products.sku }).from(stockRequestLines).innerJoin(products, eq(products.id, stockRequestLines.productId)).where(inArray(stockRequestLines.requestId, ids)).orderBy(asc(products.sku)) : Promise.resolve([]),
      a.role === 'tenant_admin' ? this.db.select().from(centralStock).where(eq(centralStock.tenantId, a.tid)) : Promise.resolve([]),
      shipIds.length ? this.db.select({ id: shipments.id, no: shipments.no, status: shipments.status }).from(shipments).where(inArray(shipments.id, shipIds)) : Promise.resolve([]),
    ]);
    return rows.map(({ r, depot }) => {
      const ls = lines.filter((x) => x.l.requestId === r.id).map((x) => ({ productId: x.l.productId, name: x.name, sku: x.sku, qty: x.l.qty, qtySent: x.l.qtySent, ...(a.role === 'tenant_admin' ? { central: central.find((c) => c.productId === x.l.productId)?.physical ?? 0 } : {}) }));
      const sh = ships.find((x) => x.id === r.shipmentId);
      return { ...r, depotName: depot, lines: ls, totalQty: ls.reduce((n, l) => n + l.qty, 0), totalSent: ls.reduce((n, l) => n + l.qtySent, 0), shipmentNo: sh?.no ?? null, shipmentStatus: sh?.status ?? null };
    });
  }

  private async lockRequest(tx: Q, a: Actor, id: string) {
    const [r] = await tx.select().from(stockRequests).where(and(eq(stockRequests.tenantId, a.tid), eq(stockRequests.id, id))).for('update');
    if (!r) throw new BusinessError('Permintaan tidak ditemukan.');
    return r;
  }
  private pendingOnly(r: typeof stockRequests.$inferSelect) {
    if (r.status !== 'pending') throw new BusinessError(r.status === 'sent' ? 'Permintaan ini sudah diproses dan dikirim.' : r.status === 'rejected' ? 'Permintaan ini sudah ditolak.' : 'Permintaan ini sudah dibatalkan.');
  }

  /** Pengurus memproses: kirim penuh atau sebagian (jumlah ≤ diminta dan ≤ stok pusat); sisanya dianggap tidak dikirim. */
  async fulfillRequest(a: Actor, id: string, input: z.infer<typeof fulfillStockRequestSchema>) {
    return this.db.transaction(async (tx) => {
      const r = await this.lockRequest(tx, a, id);
      this.pendingOnly(r);
      const ls = await tx.select({ l: stockRequestLines, name: products.name }).from(stockRequestLines).innerJoin(products, eq(products.id, stockRequestLines.productId)).where(eq(stockRequestLines.requestId, id));
      const send = new Map<string, number>();
      for (const it of input.items) {
        const line = ls.find((x) => x.l.productId === it.productId);
        if (!line) throw new BusinessError('Ada produk yang tidak ada di permintaan ini.');
        if (send.has(it.productId)) throw new BusinessError('Produk yang sama tidak boleh dua kali.');
        if (it.qty > line.l.qty) throw new BusinessError(`${line.name}: jumlah kirim (${it.qty}) melebihi yang diminta (${line.l.qty}).`);
        send.set(it.productId, it.qty);
      }
      const items = [...send].filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty }));
      if (!items.length) throw new BusinessError('Isi jumlah kirim minimal pada satu produk, atau tolak permintaan ini.');
      const sh = await this.shipTx(tx, a, { depotId: r.depotId, note: `Permintaan ${r.no}${input.note ? ` — ${input.note}` : ''}`, items }, ` untuk permintaan ${r.no}`);
      for (const { l } of ls) await tx.update(stockRequestLines).set({ qtySent: send.get(l.productId) ?? 0 }).where(eq(stockRequestLines.id, l.id));
      await tx.update(stockRequests).set({ status: 'sent', decidedAt: new Date(), decidedByName: a.name, decisionNote: input.note || null, shipmentId: sh.id }).where(eq(stockRequests.id, id));
      const short = ls.filter(({ l }) => (send.get(l.productId) ?? 0) < l.qty);
      await this.core.audit(tx, a, `Permintaan ${r.no} diproses → kiriman ${sh.no}${short.length ? `; kurang: ${short.map(({ l, name }) => `${name} ${(send.get(l.productId) ?? 0)}/${l.qty}`).join(', ')}` : ' (penuh)'}`);
      return { id, status: 'sent', shipmentNo: sh.no };
    });
  }

  async rejectRequest(a: Actor, id: string, input: z.infer<typeof rejectStockRequestSchema>) {
    return this.db.transaction(async (tx) => {
      const r = await this.lockRequest(tx, a, id);
      this.pendingOnly(r);
      await tx.update(stockRequests).set({ status: 'rejected', decidedAt: new Date(), decidedByName: a.name, decisionNote: input.reason }).where(eq(stockRequests.id, id));
      await this.core.audit(tx, a, `Permintaan ${r.no} ditolak: ${input.reason}`);
      return { id, status: 'rejected' };
    });
  }

  /** Peminta (petugas toko itu atau pengurus) membatalkan permintaan yang belum diproses. */
  async cancelRequest(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const r = await this.lockRequest(tx, a, id);
      this.core.assertDepot(a, r.depotId);
      this.pendingOnly(r);
      await tx.update(stockRequests).set({ status: 'cancelled', decidedAt: new Date(), decidedByName: a.name }).where(eq(stockRequests.id, id));
      await this.core.audit(tx, a, `Permintaan ${r.no} dibatalkan oleh peminta`);
      return { id, status: 'cancelled' };
    });
  }

  /** Cek konsistensi: kartu stok pusat = stok pusat; "dalam perjalanan" toko = jumlah kiriman terbuka. */
  async consistency(tid: string) {
    const [stock, cards, transit, open] = await Promise.all([
      this.db.select().from(centralStock).where(eq(centralStock.tenantId, tid)),
      this.db.select({ productId: centralMovements.productId, sum: sql<number>`coalesce(sum(${centralMovements.qty}), 0)`.mapWith(Number) }).from(centralMovements).where(eq(centralMovements.tenantId, tid)).groupBy(centralMovements.productId),
      this.db.select({ depotId: depotStock.depotId, productId: depotStock.productId, n: depotStock.inTransit }).from(depotStock).innerJoin(depots, eq(depots.id, depotStock.depotId)).where(eq(depots.tenantId, tid)),
      this.db.select({ depotId: shipments.depotId, productId: shipmentLines.productId, n: sql<number>`coalesce(sum(${shipmentLines.qty}), 0)`.mapWith(Number) }).from(shipmentLines).innerJoin(shipments, eq(shipments.id, shipmentLines.shipmentId)).where(and(eq(shipments.tenantId, tid), eq(shipments.status, 'in_transit'))).groupBy(shipments.depotId, shipmentLines.productId),
    ]);
    const cardOk = stock.every((s) => (cards.find((c) => c.productId === s.productId)?.sum ?? 0) === s.physical) && cards.every((c) => stock.some((s) => s.productId === c.productId));
    const transitOk = transit.every((t) => t.n === (open.find((o) => o.depotId === t.depotId && o.productId === t.productId)?.n ?? 0));
    return [
      { name: 'Kartu stok pusat = stok gudang pusat', ok: cardOk },
      { name: 'Dalam perjalanan di toko = kiriman pusat yang belum diterima', ok: transitOk },
    ];
  }
}

@Controller('central')
@Roles(...ADMIN) // pengurus mengurus pusat; petugas hanya meminta/menerima (lihat @Roles per rute)
class CentralController {
  constructor(private readonly svc: CentralService) {}
  @Get('stock') stock(@CurrentActor() a: Actor) { return this.svc.stock(a); }
  @Post('products') createProduct(@CurrentActor() a: Actor, @Body(new ZodPipe(createProductSchema)) b: z.infer<typeof createProductSchema>) { return this.svc.createProduct(a, b); }
  @Patch('products/:id') updateProduct(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateProductSchema)) b: z.infer<typeof updateProductSchema>) { return this.svc.updateProduct(a, id, b); }
  @Post('receipts') receipt(@CurrentActor() a: Actor, @Body(new ZodPipe(centralReceiptSchema)) b: z.infer<typeof centralReceiptSchema>) { return this.svc.receiveCentral(a, b); }
  @Get('products/:id/movements') movements(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query('limit') limit?: string) { return this.svc.centralMovementsOf(a, id, Math.min(200, Math.max(1, Math.floor(Number(limit ?? 50)) || 50))); }
  @Post('shipments') ship(@CurrentActor() a: Actor, @Body(new ZodPipe(createShipmentSchema)) b: z.infer<typeof createShipmentSchema>) { return this.svc.ship(a, b); }
  @Get('shipments') @Roles(...STAFF) shipments(@CurrentActor() a: Actor, @Query('depotId') depotId?: string, @Query('status') status?: string) { return this.svc.shipments(a, { depotId, status }); }
  @Post('shipments/:id/receive') @Roles(...DEPOT_ONLY) receive(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(receiveShipmentSchema)) b: z.infer<typeof receiveShipmentSchema>) { return this.svc.receiveShipment(a, id, b); }
  @Get('requests') @Roles(...STAFF) requests(@CurrentActor() a: Actor, @Query('depotId') depotId?: string, @Query('status') status?: string) { return this.svc.requests(a, { depotId, status }); }
  @Post('requests') @Roles(...DEPOT_ONLY) createRequest(@CurrentActor() a: Actor, @Body(new ZodPipe(createStockRequestSchema)) b: z.infer<typeof createStockRequestSchema>) { return this.svc.createRequest(a, b); }
  @Post('requests/:id/fulfill') fulfill(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(fulfillStockRequestSchema)) b: z.infer<typeof fulfillStockRequestSchema>) { return this.svc.fulfillRequest(a, id, b); }
  @Post('requests/:id/reject') reject(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectStockRequestSchema)) b: z.infer<typeof rejectStockRequestSchema>) { return this.svc.rejectRequest(a, id, b); }
  @Post('requests/:id/cancel') @Roles(...DEPOT_ONLY) cancelRequest(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.cancelRequest(a, id); }
  @Post('shipments/:id/cancel') cancel(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelShipmentSchema)) b: z.infer<typeof cancelShipmentSchema>) { return this.svc.cancelShipment(a, id, b); }
}

@Module({ controllers: [CentralController], providers: [CentralService], exports: [CentralService] })
export class CentralModule {}
