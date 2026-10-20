import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/db';
import { COMMISSION_RATES } from '@sajadah/shared';
import { auditLog, commissionPlans, counters, depotStock, depots, orders, purchaseOrders, stockMovements } from '../db/schema';
import { BusinessError } from '../common/errors';
import type { Actor } from '../auth/auth.types';

type Q = Database; // Tx kompatibel secara struktural dengan Database

@Injectable()
export class CoreService {
  /** Nomor urut atomik per tenant+kunci (upsert increment). */
  async next(q: Q, tenantId: string, key: string): Promise<number> {
    const [r] = await q
      .insert(counters)
      .values({ tenantId, key, value: 1 })
      .onConflictDoUpdate({ target: [counters.tenantId, counters.key], set: { value: sql`${counters.value} + 1` } })
      .returning({ v: counters.value });
    return r!.v;
  }

  async docNo(q: Q, tenantId: string, prefix: string, key = prefix, width = 4): Promise<string> {
    return `${prefix}-${String(await this.next(q, tenantId, key)).padStart(width, '0')}`;
  }

  async audit(q: Q, actor: Actor, message: string): Promise<void> {
    await q.insert(auditLog).values({ tenantId: actor.tid, actorId: actor.sub, actorName: actor.name, message });
  }

  /**
   * Toko yang dipakai sebuah tindakan. Petugas toko terkunci ke tokonya; pengurus harus memilih
   * (bila kosong: toko aktif tertua = toko utama).
   */
  async depotFor(q: Q, a: Actor, requested?: string | null): Promise<{ id: string; name: string }> {
    if (a.did && requested && requested !== a.did) throw new ForbiddenException('Anda hanya dapat bekerja di toko Anda sendiri.');
    const want = a.did ?? requested ?? null;
    const rows = await q.select({ id: depots.id, name: depots.name, active: depots.active }).from(depots)
      .where(want ? and(eq(depots.tenantId, a.tid), eq(depots.id, want)) : and(eq(depots.tenantId, a.tid), eq(depots.active, true)))
      .orderBy(asc(depots.createdAt), asc(depots.name)).limit(1);
    const d = rows[0];
    if (!d) throw new BusinessError(want ? 'Toko tidak ditemukan.' : 'Belum ada toko aktif. Tambahkan toko lebih dulu.');
    if (!d.active) throw new BusinessError(`Toko ${d.name} nonaktif.`);
    return { id: d.id, name: d.name };
  }

  /** Tarif komisi yang berlaku sekarang (baris terbaru riwayat tarif; bawaan bila belum ada). */
  async currentRates(q: Q, tenantId: string): Promise<number[]> {
    const [p] = await q.select({ rates: commissionPlans.rates }).from(commissionPlans).where(eq(commissionPlans.tenantId, tenantId)).orderBy(desc(commissionPlans.createdAt)).limit(1);
    return p?.rates ?? [...COMMISSION_RATES];
  }

  /** Petugas toko tidak boleh menyentuh data toko lain. */
  assertDepot(a: Actor, depotId: string): void {
    if (a.did && a.did !== depotId) throw new ForbiddenException('Data ini milik toko lain.');
  }

  /** Baris stok (toko, produk) terkunci; dibuat 0 bila belum ada. */
  async lockStock(q: Q, depotId: string, productId: string) {
    await q.insert(depotStock).values({ depotId, productId }).onConflictDoNothing();
    const [row] = await q.select().from(depotStock).where(and(eq(depotStock.depotId, depotId), eq(depotStock.productId, productId))).for('update');
    return row!;
  }

  /**
   * Satu-satunya jalan mengubah stok fisik: mengunci baris stok, menolak saldo negatif, lalu mencatat mutasi di kartu stok
   * (jumlah +/-, saldo sesudahnya, referensi dokumen, pelaku). `transitDelta` (negatif) mengurangi angka "dalam perjalanan" saat kiriman dari pusat diterima.
   */
  async moveStock(q: Q, a: Actor, m: { depotId: string; productId: string; delta: number; type: typeof stockMovements.$inferInsert['type']; refNo?: string | null; note?: string | null; transitDelta?: number }): Promise<number> {
    const st = await this.lockStock(q, m.depotId, m.productId);
    const next = st.physical + m.delta;
    if (next < 0) throw new BusinessError('Stok fisik tidak boleh negatif.');
    const transit = st.inTransit + (m.transitDelta ?? 0);
    if (transit < 0) throw new BusinessError('Angka dalam perjalanan tidak boleh negatif.');
    await q.update(depotStock).set({ physical: next, inTransit: transit }).where(and(eq(depotStock.depotId, m.depotId), eq(depotStock.productId, m.productId)));
    await q.insert(stockMovements).values({ tenantId: a.tid, depotId: m.depotId, productId: m.productId, type: m.type, qty: m.delta, balanceAfter: next, refNo: m.refNo ?? null, note: m.note ?? null, actorName: a.name });
    return next;
  }

  /** Reservasi = pesanan belum dibatalkan dan belum dikirim, per produk (opsional dibatasi satu toko). */
  async reservedMap(q: Q, tenantId: string, depotId?: string): Promise<Map<string, number>> {
    const rows = await q
      .select({ productId: orders.productId, qty: sql<number>`coalesce(sum(${orders.qty}), 0)`.mapWith(Number) })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.cancelled, false), eq(orders.shipped, false), depotId ? eq(orders.depotId, depotId) : undefined))
      .groupBy(orders.productId);
    return new Map(rows.map((r) => [r.productId, r.qty]));
  }

  /** Sisa PO berjalan (draf/disetujui/sebagian) per produk = jumlah - diterima layak. */
  async openPoMap(q: Q, tenantId: string, depotId?: string): Promise<Map<string, number>> {
    const rows = await q
      .select({ productId: purchaseOrders.productId, qty: sql<number>`coalesce(sum(${purchaseOrders.qty} - ${purchaseOrders.accepted}), 0)`.mapWith(Number) })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, tenantId), inArray(purchaseOrders.status, ['draft', 'approved', 'partial']), depotId ? eq(purchaseOrders.depotId, depotId) : undefined))
      .groupBy(purchaseOrders.productId);
    return new Map(rows.map((r) => [r.productId, r.qty]));
  }

  /** Stok per produk di satu toko (produk tanpa baris = 0). */
  async stockMap(q: Q, depotId: string): Promise<Map<string, { physical: number; inTransit: number }>> {
    const rows = await q.select().from(depotStock).where(eq(depotStock.depotId, depotId));
    return new Map(rows.map((r) => [r.productId, { physical: r.physical, inTransit: r.inTransit }]));
  }
}
