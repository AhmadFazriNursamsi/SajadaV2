import { Body, Controller, ForbiddenException, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { and, asc, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { COMMISSION_RATES, REPORT_UTC_OFFSET_HOURS, commissionLines, distanceKm, memberOrderSchema, memberSaleSchema, orderCheckSchema, type MemberSaleInput, nearSchema, updateProfileSchema, type MemberOrderInput } from '@sajadah/shared';
import { Database } from '../db/db';
import { depots, members, orders, products, profitReports, users } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { ZodPipe } from '../common/zod.pipe';
import { BusinessError } from '../common/errors';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { OrdersModule, OrdersService, commissionEligible, isSelfOrder, orderStatus, orderTotal } from '../orders/orders.module';

/** Endpoint hak anggota/investor (hanya lihat). Semua dibatasi ke member milik pengguna login. */
@Injectable()
export class MeService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService, private readonly ordersSvc: OrdersService) {}

  private async member(a: Actor) {
    if (!a.mid) throw new ForbiddenException('Akun tidak terhubung ke anggota');
    const [m] = await this.db.select().from(members).where(and(eq(members.id, a.mid), eq(members.tenantId, a.tid)));
    if (!m) throw new ForbiddenException('Anggota tidak ditemukan');
    return m;
  }

  async profile(a: Actor) {
    const m = await this.member(a);
    const [sponsor] = m.sponsorId ? await this.db.select({ name: members.name }).from(members).where(eq(members.id, m.sponsorId)) : [];
    const [u] = await this.db.select({ username: users.username }).from(users).where(and(eq(users.tenantId, a.tid), eq(users.memberId, m.id)));
    return { id: m.id, name: m.name, username: u?.username ?? null, phone: m.phone, address: m.address, memberNo: m.memberNo, familyCode: m.familyCode, area: m.area, balance: m.balance, rewardBalance: m.rewardBalance, coinBalance: m.coinBalance, avatarUrl: m.avatar ? `/api/members/avatar/${m.avatar}` : null, active: m.active, sponsor: sponsor?.name ?? null };
  }

  /** Anggota mengubah profilnya sendiri. Hanya nama, nomor HP, alamat, dan status keluarga; data keanggotaan (nomor, daerah, saldo, sponsor) tidak bisa diubah di sini. */
  async updateProfile(a: Actor, input: z.infer<typeof updateProfileSchema>) {
    const m = await this.member(a);
    await this.db.transaction(async (tx) => {
      const next = { name: input.name ?? m.name, phone: input.phone === undefined ? m.phone : input.phone || null, address: input.address === undefined ? m.address : input.address || null, familyCode: input.familyCode ?? m.familyCode };
      const changes: string[] = [];
      if (next.name !== m.name) changes.push(`nama ${m.name} → ${next.name}`);
      if (next.phone !== m.phone) changes.push('nomor HP');
      if (next.address !== m.address) changes.push('alamat');
      if (next.familyCode !== m.familyCode) changes.push(`status keluarga ${m.familyCode ?? '—'} → ${next.familyCode}`);
      if (!changes.length) throw new BusinessError('Tidak ada yang diubah.');
      if (!next.phone) throw new BusinessError('Nomor HP wajib diisi.');
      await tx.update(members).set(next).where(eq(members.id, m.id));
      if (next.name !== m.name) await tx.update(users).set({ name: next.name }).where(and(eq(users.tenantId, a.tid), eq(users.memberId, m.id)));
      await this.core.audit(tx, a, `Profil diubah oleh anggota ${m.name}: ${changes.join(', ')}`);
    });
    return this.profile(a); // di luar transaksi (PGlite: jangan query lewat this.db di dalam transaksi)
  }

  async orders(a: Actor) {
    const m = await this.member(a);
    const buyerM = alias(members, 'buyer_m');
    const rows = await this.db
      .select({ o: orders, product: products.name, depot: depots.name, buyerName: buyerM.name })
      .from(orders)
      .leftJoin(buyerM, eq(buyerM.id, orders.buyerId))
      .innerJoin(products, eq(products.id, orders.productId))
      .innerJoin(depots, eq(depots.id, orders.depotId))
      .where(and(eq(orders.tenantId, a.tid), or(eq(orders.sellerId, m.id), eq(orders.buyerId, m.id))))
      .orderBy(desc(orders.createdAt));
    const reports = await this.ordersSvc.latestReports(this.db, a.tid, rows.map((r) => r.o.groupId));
    const sales = rows.filter((r) => r.o.sellerId === m.id && !r.o.cancelled && !r.o.returned && !r.o.buyerId); // hanya penjualan ke pelanggan umum
    const pendingCommission = rows
      .filter((r) => commissionEligible(r.o) && r.o.commission === 'pending')
      .reduce((s, r) => s + (commissionLines(r.o.sellerId, r.o.uplines, orderTotal(r.o), r.o.commissionRates).find((l) => l.memberId === m.id)?.amount ?? 0), 0);
    return {
      salesValue: sales.reduce((s, r) => s + orderTotal(r.o), 0),
      pendingCommission,
      orders: rows.map(({ o, product, depot, buyerName }) => ({ id: o.id, no: o.no, groupId: o.groupId, groupNo: o.groupNo, lineNo: o.lineNo, productId: o.productId, price: o.price, pay: o.pay, approvedAt: o.approvedAt, approvedBy: o.approvedBy, shipped: o.shipped, deliveryRef: o.deliveryRef, received: o.received, receivedAt: o.receivedAt, receiverName: o.receiverName, proofRef: o.proofRef, product, depot, createdAt: o.createdAt, cancelReason: o.cancelReason, qty: o.qty, total: orderTotal(o), status: orderStatus(o), role: o.sellerId === m.id ? 'seller' : 'buyer',
        // Pihak lawan: untuk penjualan = pembeli (anggota atau pelanggan umum); untuk belanja = Anda sendiri.
        buyerName: o.buyerId === m.id ? null : (buyerName ?? o.customerName), customerOrder: !o.buyerId,
        canPay: o.sellerId === m.id && orderStatus(o) === 'awaiting_payment',
        report: reports.get(o.groupId) ?? null,
        canCheck: o.sellerId === m.id && o.shipped && !o.cancelled && !o.returned && !reports.has(o.groupId),
        selfOrder: isSelfOrder(o), commissionEligible: commissionEligible(o),
      })),
    };
  }

  /** Produk aktif dan harga jualnya (tanpa harga beli), untuk simulasi pendapatan. */
  async priceList(a: Actor) {
    const ps = await this.db.select().from(products).where(and(eq(products.tenantId, a.tid), eq(products.active, true))).orderBy(asc(products.sku));
    return ps.map((p) => ({ id: p.id, name: p.name, price: p.sellPrice }));
  }

  /**
   * Toko aktif yang bisa dipesan. Bila posisi anggota dikirim (lat, lng), toko diurutkan dari yang terdekat dan
   * diberi jarak; posisi hanya dipakai untuk menghitung dan tidak disimpan.
   */
  async depotList(a: Actor, near?: { lat: number; lng: number }) {
    await this.member(a);
    const ds = await this.db.select().from(depots).where(and(eq(depots.tenantId, a.tid), eq(depots.active, true))).orderBy(asc(depots.createdAt), asc(depots.name));
    const rows = await Promise.all(ds.map(async (d) => {
      const items = await this.catalog(a, d.id);
      const km = near && d.lat != null && d.lng != null ? Math.round(distanceKm(near, { lat: d.lat, lng: d.lng }) * 10) / 10 : null;
      return { id: d.id, name: d.name, address: d.address, productsAvailable: items.filter((i) => i.available > 0).length, distanceKm: km, nearest: false };
    }));
    if (near) {
      rows.sort((x, y) => (x.distanceKm ?? Infinity) - (y.distanceKm ?? Infinity));
      if (rows[0]?.distanceKm != null) rows[0].nearest = true;
    }
    return rows;
  }

  /** Katalog satu toko: harga jual dan stok yang tersedia (fisik dikurangi reservasi) di toko itu. */
  async catalog(a: Actor, depotId: string) {
    await this.member(a);
    const depot = await this.core.depotFor(this.db, a, depotId);
    const [ps, reserved, stock] = await Promise.all([
      this.db.select().from(products).where(and(eq(products.tenantId, a.tid), eq(products.active, true))).orderBy(asc(products.sku)),
      this.core.reservedMap(this.db, a.tid, depot.id),
      this.core.stockMap(this.db, depot.id),
    ]);
    return ps.map((p) => ({ id: p.id, sku: p.sku, name: p.name, price: p.sellPrice, available: Math.max(0, (stock.get(p.id)?.physical ?? 0) - (reserved.get(p.id) ?? 0)) }));
  }

  /**
   * Toko anggota: seluruh produk aktif dengan harga, harga normal (coret), kategori, deskripsi, foto, dan stok tersedia per toko.
   * Toko dipilih saat checkout, jadi katalog menampilkan produk semua toko sekaligus.
   */
  async shop(a: Actor) {
    await this.member(a);
    const [ps, ds] = await Promise.all([
      this.db.select().from(products).where(and(eq(products.tenantId, a.tid), eq(products.active, true))).orderBy(asc(products.name)),
      this.db.select().from(depots).where(and(eq(depots.tenantId, a.tid), eq(depots.active, true))).orderBy(asc(depots.createdAt), asc(depots.name)),
    ]);
    const stocks = await Promise.all(ds.map(async (d) => {
      const [reserved, stock] = await Promise.all([this.core.reservedMap(this.db, a.tid, d.id), this.core.stockMap(this.db, d.id)]);
      return { depot: d, avail: (pid: string) => Math.max(0, (stock.get(pid)?.physical ?? 0) - (reserved.get(pid) ?? 0)) };
    }));
    const items = ps.map((p) => {
      const stock = Object.fromEntries(stocks.map((s) => [s.depot.id, s.avail(p.id)]));
      const discount = p.listPrice > p.sellPrice ? Math.round((1 - p.sellPrice / p.listPrice) * 100) : 0;
      return { id: p.id, sku: p.sku, name: p.name, price: p.sellPrice, listPrice: discount ? p.listPrice : 0, discountPct: discount, category: p.category, description: p.description, coins: p.coins, imageUrl: p.image ? `/api/products/image/${p.image}` : null, stock, available: Object.values(stock).reduce((x, y) => x + y, 0) };
    });
    return {
      categories: [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort(),
      depots: ds.map((d) => ({ id: d.id, name: d.name, address: d.address, lat: d.lat, lng: d.lng })),
      products: items,
    };
  }

  /** Anggota memesan dari toko pilihannya: stok direservasi, lalu menunggu persetujuan toko. */
  async placeOrder(a: Actor, input: MemberOrderInput) {
    const m = await this.member(a);
    return this.db.transaction(async (tx) => {
      const depot = await this.core.depotFor(tx, a, input.depotId);
      const created = await this.ordersSvc.createOrders(tx, a, depot, m.id, { memberId: m.id }, input.items, false);
      return created.map((o) => ({ id: o.id, no: o.no, groupId: o.groupId, groupNo: o.groupNo, lineNo: o.lineNo, productId: o.productId, price: o.price, depot: depot.name, qty: o.qty, total: orderTotal(o), status: orderStatus(o) }));
    });
  }

  /** Anggota membayar pesanannya sendiri dari saldo belanja (setelah disetujui toko). */
  async payOrder(a: Actor, id: string) {
    const m = await this.member(a);
    const [o] = await this.db.select({ sellerId: orders.sellerId }).from(orders).where(and(eq(orders.tenantId, a.tid), eq(orders.id, id)));
    if (!o || o.sellerId !== m.id) throw new BusinessError('Pesanan tidak ditemukan.');
    return this.ordersSvc.payWithBalance(a, id);
  }

  /**
   * Laporan penjualan harian anggota dan saldo komisinya, dihitung otomatis dari pesanan.
   * Penjualan "berhasil" = pesanan lunas yang sudah diterima pembeli (hari konfirmasi penerimaan, waktu WIB), bukan batal/retur/belanja sendiri.
   * Komisi per hari = bagian anggota ini pada pesanan tersebut: 5% untuk penjualannya sendiri dan 3/2/1% dari penjualan downline di bawahnya.
   */
  async salesReport(a: Actor, days: number) {
    const m = await this.member(a);
    const day = (d: Date) => new Date(d.getTime() + REPORT_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
    const rows = await this.db.select().from(orders).where(and(
      eq(orders.tenantId, a.tid),
      or(eq(orders.sellerId, m.id), sql`${orders.uplines} @> ${JSON.stringify([m.id])}::jsonb`),
    ));
    type Day = { date: string; ownOrders: number; ownPacks: number; ownTurnover: number; ownCommission: number; networkOrders: number; networkTurnover: number; networkCommission: number; total: number };
    const empty = (date: string): Day => ({ date, ownOrders: 0, ownPacks: 0, ownTurnover: 0, ownCommission: 0, networkOrders: 0, networkTurnover: 0, networkCommission: 0, total: 0 });
    const byDay = new Map<string, Day>();
    const balance = { pending: 0, approved: 0, paid: 0, clawback: 0 };
    const progress = { orders: 0, potentialCommission: 0 };
    const seen = new Set<string>();
    for (const o of rows) {
      const total = orderTotal(o);
      const mine = commissionLines(o.sellerId, o.uplines, total, o.commissionRates).find((l) => l.memberId === m.id);
      if (!mine) continue; // anggota ini di luar 4 tingkat komisi pesanan itu
      if (o.returned) { if (o.commissionReversedFrom === 'paid') balance.clawback += mine.amount; continue; }
      if (o.cancelled || o.buyerId) continue; // belanja anggota (termasuk legacy antaranggota) bukan penjualan berkomisi
      if (!commissionEligible(o)) { // terjual tetapi belum lunas/diterima: belum menjadi komisi
        if (o.sellerId === m.id) { if (!seen.has(`p|${o.groupId}`)) { seen.add(`p|${o.groupId}`); progress.orders += 1; } progress.potentialCommission += mine.amount; }
        continue;
      }
      if (o.commission === 'pending' || o.commission === 'approved' || o.commission === 'paid') balance[o.commission] += mine.amount;
      const k = day(o.receivedAt ?? o.createdAt);
      const d = byDay.get(k) ?? empty(k);
      const first = !seen.has(`${k}|${o.groupId}|${o.sellerId === m.id}`); seen.add(`${k}|${o.groupId}|${o.sellerId === m.id}`); // satu pesanan (banyak produk) dihitung sekali
      if (o.sellerId === m.id) { if (first) d.ownOrders += 1; d.ownPacks += o.qty; d.ownTurnover += total; d.ownCommission += mine.amount; }
      else { if (first) d.networkOrders += 1; d.networkTurnover += total; d.networkCommission += mine.amount; }
      d.total += mine.amount;
      byDay.set(k, d);
    }
    const list: Day[] = [];
    for (let i = 0; i < days; i++) { const k = day(new Date(Date.now() - i * 86_400_000)); list.push(byDay.get(k) ?? empty(k)); }
    const sum = (f: (d: Day) => number) => list.reduce((s, d) => s + f(d), 0);
    return {
      timezone: `WIB (UTC+${REPORT_UTC_OFFSET_HOURS})`,
      days: list,
      period: { days, ownOrders: sum((d) => d.ownOrders), ownPacks: sum((d) => d.ownPacks), ownTurnover: sum((d) => d.ownTurnover), ownCommission: sum((d) => d.ownCommission), networkCommission: sum((d) => d.networkCommission), total: sum((d) => d.total), activeDays: list.filter((d) => d.ownOrders > 0).length },
      balance: { ...balance, available: balance.pending + balance.approved },
      inProgress: progress,
    };
  }

  /**
   * Anggota mencatat penjualan ke pelanggan umum (bukan ke anggota lain). Ini membuat pesanan sungguhan atas nama anggota sebagai penjual:
   * stok toko direservasi dan pesanan menunggu persetujuan toko; komisi baru terhitung setelah lunas dan diterima pembeli.
   */
  async placeSale(a: Actor, input: MemberSaleInput) {
    const m = await this.member(a);
    return this.db.transaction(async (tx) => {
      const depot = await this.core.depotFor(tx, a, input.depotId);
      const created = await this.ordersSvc.createOrders(tx, a, depot, m.id, { customerName: input.customerName, customerPhone: input.customerPhone }, input.items, false);
      return created.map((o) => ({ id: o.id, no: o.no, groupId: o.groupId, groupNo: o.groupNo, lineNo: o.lineNo, productId: o.productId, price: o.price, depot: depot.name, qty: o.qty, total: orderTotal(o), status: orderStatus(o) }));
    });
  }

  /** Anggota memeriksa barang yang dikirim: sesuai, atau laporkan ke toko bila ada yang kurang/rusak/salah. */
  async checkOrder(a: Actor, id: string, input: z.infer<typeof orderCheckSchema>) {
    const m = await this.member(a);
    return this.ordersSvc.submitCheck(a, m.id, id, input);
  }

  /**
   * Jaringan anggota: kode referal, orang yang diajak (tingkat 1-3 menurut pohon sponsor) beserta penjualan mereka,
   * dan bonus jaringan anggota ini (3/2/1% dari penjualan downline ke pelanggan umum, setelah lunas dan diterima).
   */
  async network(a: Actor) {
    const m = await this.member(a);
    const [all, os] = await Promise.all([
      this.db.select().from(members).where(eq(members.tenantId, a.tid)),
      this.db.select().from(orders).where(and(eq(orders.tenantId, a.tid), eq(orders.cancelled, false), eq(orders.returned, false))),
    ]);
    const kids = (id: string) => all.filter((x) => x.sponsorId === id);
    const level = new Map<string, number>();
    let layer = [m.id];
    for (let lv = 1; lv <= 3; lv++) {
      layer = layer.flatMap((id) => kids(id).map((x) => x.id)).filter((id) => id !== m.id && !level.has(id));
      layer.forEach((id) => level.set(id, lv));
    }
    const rates = await this.core.currentRates(this.db, a.tid);
    const monthKey = (d: Date) => new Date(d.getTime() + REPORT_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 7);
    const thisMonth = monthKey(new Date());
    const settled = os.filter((o) => !o.buyerId && o.pay !== 'unpaid'); // penjualan ke pelanggan umum yang sudah lunas
    const personal = settled.filter((o) => o.sellerId === m.id).reduce((s, o) => s + orderTotal(o), 0);
    const downlineVolume = settled.filter((o) => o.uplines.includes(m.id)).reduce((s, o) => s + orderTotal(o), 0);

    const bonus = { pending: 0, approved: 0, paid: 0, thisMonth: 0 };
    const perLevel = [1, 2, 3].map((lv) => ({ level: lv, percent: rates[lv] ?? 0, members: [...level.values()].filter((x) => x === lv).length, volume: 0, bonus: 0 }));
    const perSeller = new Map<string, { volume: number; bonus: number }>();
    for (const o of os.filter(commissionEligible)) {
      const line = commissionLines(o.sellerId, o.uplines, orderTotal(o), o.commissionRates).find((l) => l.memberId === m.id && l.level >= 1);
      if (!line) continue;
      if (o.commission === 'pending' || o.commission === 'approved' || o.commission === 'paid') bonus[o.commission] += line.amount;
      if (o.receivedAt && monthKey(o.receivedAt) === thisMonth) bonus.thisMonth += line.amount;
      const lv = perLevel[line.level - 1]; if (lv) { lv.volume += orderTotal(o); lv.bonus += line.amount; }
      const ps = perSeller.get(o.sellerId) ?? { volume: 0, bonus: 0 };
      ps.volume += orderTotal(o); ps.bonus += line.amount; perSeller.set(o.sellerId, ps);
    }
    const downline = all.filter((x) => level.has(x.id)).map((x) => ({
      id: x.id, name: x.name, level: level.get(x.id)!, active: x.active, joinedAt: x.createdAt, referrals: kids(x.id).length,
      volume: perSeller.get(x.id)?.volume ?? 0, bonus: perSeller.get(x.id)?.bonus ?? 0,
    })).sort((p, q) => p.level - q.level || q.bonus - p.bonus || p.name.localeCompare(q.name));
    return {
      referralCode: m.referralCode,
      sponsor: all.find((x) => x.id === m.sponsorId)?.name ?? null,
      personal, downlineVolume, group: personal + downlineVolume,
      bonus: { ...bonus, total: bonus.pending + bonus.approved + bonus.paid },
      perLevel, downline,
    };
  }

  async entitlements(a: Actor) {
    const m = await this.member(a);
    const rows = await this.db
      .select({ r: profitReports })
      .from(profitReports)
      .where(and(eq(profitReports.memberId, m.id), eq(profitReports.tenantId, a.tid)))
      .orderBy(desc(profitReports.no));
    return {
      remaining: m.remaining, cumulative: m.cumulative,
      reports: rows.map(({ r }) => ({ no: r.no, period: r.period, profit: r.profit, status: r.status, memberShare: r.memberShare, investorShare: r.investorShare })),
    };
  }
}

@Controller('me')
@Roles('member', 'tenant_admin', 'staff')
class MeController {
  constructor(private readonly svc: MeService) {}
  @Get() profile(@CurrentActor() a: Actor) { return this.svc.profile(a); }
  @Patch() @Roles('member') updateProfile(@CurrentActor() a: Actor, @Body(new ZodPipe(updateProfileSchema)) b: z.infer<typeof updateProfileSchema>) { return this.svc.updateProfile(a, b); }
  @Get('sales-report') salesReport(@CurrentActor() a: Actor, @Query('days') days?: string) {
    const n = Math.floor(Number(days ?? 14));
    return this.svc.salesReport(a, Number.isFinite(n) ? Math.min(90, Math.max(1, n)) : 14);
  }
  @Get('products') products(@CurrentActor() a: Actor) { return this.svc.priceList(a); }
  @Get('shop') shop(@CurrentActor() a: Actor) { return this.svc.shop(a); }
  @Get('depots') depots(@CurrentActor() a: Actor, @Query() q: { lat?: string; lng?: string }) {
    const near = q.lat !== undefined || q.lng !== undefined ? nearSchema.safeParse(q) : null;
    if (near && !near.success) throw new BusinessError('Posisi tidak valid.');
    return this.svc.depotList(a, near?.data);
  }
  @Get('depots/:id/products') catalog(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.catalog(a, id); }
  @Post('sales') @Roles('member') sale(@CurrentActor() a: Actor, @Body(new ZodPipe(memberSaleSchema)) b: MemberSaleInput) { return this.svc.placeSale(a, b); }
  @Post('orders') @Roles('member') place(@CurrentActor() a: Actor, @Body(new ZodPipe(memberOrderSchema)) b: MemberOrderInput) { return this.svc.placeOrder(a, b); }
  @Post('orders/:id/check') @Roles('member') check(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(orderCheckSchema)) b: z.infer<typeof orderCheckSchema>) { return this.svc.checkOrder(a, id, b); }
  @Post('orders/:id/pay') @Roles('member') pay(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.payOrder(a, id); }
  @Get('orders') orders(@CurrentActor() a: Actor) { return this.svc.orders(a); }
  @Get('network') network(@CurrentActor() a: Actor) { return this.svc.network(a); }
  @Get('entitlements') ent(@CurrentActor() a: Actor) { return this.svc.entitlements(a); }
}

@Module({ imports: [OrdersModule], controllers: [MeController], providers: [MeService] })
export class MeModule {}
