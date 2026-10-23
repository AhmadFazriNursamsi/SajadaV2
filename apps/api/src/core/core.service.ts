import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Database } from '../db/db';
import { COMMISSION_RATES, OPNAME_WINDOW_DAYS } from '@sajadah/shared';
import { auditLog, commissionPlans, counters, depotStock, depots, notifications, orders, purchaseOrders, stockCounts, stockMovements, users } from '../db/schema';
import { BusinessError } from '../common/errors';
import type { Actor } from '../auth/auth.types';

type Q = Database; // Tx kompatibel secara struktural dengan Database

export type NotifyRoute = 'orders' | 'reward' | 'coins' | 'staff-orders' | 'staff-receive';
export interface NotifyInput { tenantId: string; memberId: string; tab: 'info' | 'trx'; cat: string; title: string; body: string; route: NotifyRoute; refId?: string }
export type StaffNotifyInput = Omit<NotifyInput, 'memberId'> & { depotId: string };

@Injectable()
export class CoreService {
  /** Catat notifikasi untuk anggota di dalam transaksi yang sama dengan kejadiannya; pengiriman push dilakukan terpisah (PushService). */
  async notify(q: Q, n: NotifyInput) {
    await q.insert(notifications).values({ tenantId: n.tenantId, memberId: n.memberId, tab: n.tab, cat: n.cat, title: n.title, body: n.body, route: n.route, refId: n.refId ?? null });
  }

  /** Kabari petugas yang bertugas di toko itu, serta pengurus (admin memantau semua toko). */
  async notifyDepotStaff(q: Q, n: StaffNotifyInput) {
    const staff = await q.select({ id: users.id }).from(users).where(and(eq(users.tenantId, n.tenantId), or(eq(users.role, 'tenant_admin'), and(eq(users.role, 'staff'), eq(users.depotId, n.depotId)))));
    if (!staff.length) return;
    await q.insert(notifications).values(staff.map((u) => ({ tenantId: n.tenantId, userId: u.id, tab: n.tab, cat: n.cat, title: n.title, body: n.body, route: n.route, refId: n.refId ?? null })));
  }

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
  /**
   * Kewajiban stok opname bulanan satu toko (zona WIB). Opname bulan P dianggap dipenuhi bila ada opname berstatus diajukan/disetujui
   * yang diajukan paling cepat OPNAME_WINDOW_DAYS hari sebelum P berakhir (juga bila diajukan terlambat setelahnya).
   *  - 'locked': bulan lalu terlewat tanpa opname → transaksi toko dikunci sampai opname diajukan.
   *  - 'due'    : bulan ini sudah masuk jendela opname dan belum diajukan (peringatan, belum dikunci).
   * Toko yang baru dibuka setelah jendela bulan lalu dimulai tidak diwajibkan untuk bulan itu.
   */
  async opnameStatus(q: Q, depotId: string, now = new Date()): Promise<{ state: 'ok' | 'due' | 'locked'; month: string; dueDate: string | null; daysLeft: number | null }> {
    const wib = 7 * 3_600_000, day = 86_400_000;
    const w = new Date(now.getTime() + wib);
    const y = w.getUTCFullYear(), m = w.getUTCMonth();
    const startOf = (yy: number, mm: number) => Date.UTC(yy, mm, 1) - wib; // awal bulan WIB (ms epoch); mm boleh di luar 0–11
    const startCur = startOf(y, m), endCur = startOf(y, m + 1);
    const lastDay = (endMs: number) => new Date(endMs - 1 + wib).toISOString().slice(0, 10);
    const label = (mm: number) => ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][((mm % 12) + 12) % 12]!;
    const [[d], [last]] = await Promise.all([
      q.select({ createdAt: depots.createdAt }).from(depots).where(eq(depots.id, depotId)),
      q.select({ at: sql<Date | null>`max(${stockCounts.submittedAt})` }).from(stockCounts).where(and(eq(stockCounts.depotId, depotId), inArray(stockCounts.status, ['submitted', 'approved']))),
    ]);
    const lastMs = last?.at ? new Date(last.at).getTime() : 0;
    const prevWindowStart = startCur - OPNAME_WINDOW_DAYS * day;
    if (d && d.createdAt.getTime() < prevWindowStart && lastMs < prevWindowStart) return { state: 'locked', month: label(m - 1), dueDate: lastDay(startCur), daysLeft: null };
    const windowStart = endCur - OPNAME_WINDOW_DAYS * day;
    if (now.getTime() >= windowStart && lastMs < windowStart) return { state: 'due', month: label(m), dueDate: lastDay(endCur), daysLeft: Math.max(0, Math.ceil((endCur - now.getTime()) / day)) };
    return { state: 'ok', month: label(m), dueDate: null, daysLeft: null };
  }

  /** Transaksi toko (stok, pesanan) ditolak bila opname bulanan terlewat. Opname sendiri selalu boleh. */
  async assertDepotOpen(q: Q, depotId: string, forMember = false): Promise<void> {
    if (process.env.OPNAME_LOCK === 'off') return; // saklar darurat operator; tes non-opname mematikannya agar tidak bergantung pada tanggal
    const s = await this.opnameStatus(q, depotId);
    if (s.state !== 'locked') return;
    throw new BusinessError(forMember
      ? 'Toko ini sementara belum dapat melayani pesanan. Silakan pilih toko lain atau coba lagi nanti.'
      : `Transaksi toko dikunci: stok opname bulan ${s.month} belum diajukan. Lakukan stok opname dulu, setelah diajukan transaksi bisa dilanjutkan.`);
  }

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
    if (m.type !== 'opname' && m.type !== 'opening') await this.assertDepotOpen(q, m.depotId);
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
