import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { REWARD_PERCENT, SHIPMENT_ISSUES, planInstallment, cancelSchema, checkoutSchema, orderCheckSchema, rejectSchema, resolveReportSchema, commissionLines, receiveOrderSchema, shipSchema, uplineChain, type CheckoutInput } from '@sajadah/shared';
import { Database } from '../db/db';
import { coinEntries, installmentEntries, depotStock, depots, members, orderReportLines, orderReports, orders, products, rewardEntries, tenants } from '../db/schema';
import type { Order } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentActor, FINANCE, OPS, Roles, STAFF } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import type { z } from 'zod';

/** Pembeli pesanan: anggota atau pelanggan umum (dibayar tunai). */
export type BuyerRef = { memberId: string } | { customerName: string; customerPhone?: string };
export const orderTotal = (o: Pick<Order, 'qty' | 'price'>) => o.qty * o.price;
export const groupTotal = (rows: Pick<Order, 'qty' | 'price'>[]) => rows.reduce((s, o) => s + orderTotal(o), 0);
export const orderStatus = (o: Order) =>
  o.cancelled ? 'cancelled' : o.returned ? 'returned' : !o.approvedAt ? 'awaiting_approval' : o.pay === 'unpaid' ? 'awaiting_payment' : !o.shipped ? 'paid' : !o.received ? 'shipped' : 'received';
/**
 * Layak komisi: berbayar + bukti terima + tidak dibatalkan + tidak diretur, dan pembelinya pelanggan umum.
 * Anggota tidak menjual ke anggota lain, dan belanja anggota untuk dirinya sendiri tidak berkomisi: komisi hanya dari penjualan ke konsumen akhir.
 */
export const commissionEligible = (o: Order) => o.pay !== 'unpaid' && o.received && !o.cancelled && !o.returned && !o.buyerId;
export const isSelfOrder = (o: Pick<Order, 'sellerId' | 'buyerId'>) => o.sellerId === o.buyerId;

@Injectable()
export class OrdersService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) {}

  async list(a: Actor) {
    const rows = await this.db
      .select({ o: orders, depot: depots.name })
      .from(orders)
      .innerJoin(depots, eq(depots.id, orders.depotId))
      .where(and(eq(orders.tenantId, a.tid), a.did ? eq(orders.depotId, a.did) : undefined))
      .orderBy(desc(orders.createdAt), desc(orders.no));
    const reports = await this.latestReports(this.db, a.tid, rows.map((r) => r.o.groupId));
    const ids = [...new Set(rows.flatMap((r) => [r.o.sellerId, r.o.buyerId].filter((x): x is string => !!x)))];
    const names = new Map((ids.length ? await this.db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, ids)) : []).map((m) => [m.id, m.name]));
    return rows.map(({ o, depot }) => ({ ...o, sellerName: names.get(o.sellerId) ?? null, buyerName: o.buyerId ? names.get(o.buyerId) ?? null : null, depotName: depot, total: orderTotal(o), status: orderStatus(o), commissionEligible: commissionEligible(o), report: reports.get(o.groupId) ?? null }));
  }

  /**
   * Buat pesanan (satu baris per produk) dan reservasi stok di satu toko. Dipakai petugas (langsung disetujui)
   * dan anggota lewat aplikasi (menunggu persetujuan toko).
   */
  async createOrders(tx: Database, a: Actor, depot: { id: string; name: string }, sellerId: string, buyerRef: BuyerRef, items: CheckoutInput['items'], approved: boolean) {
    const ms = await tx.select().from(members).where(eq(members.tenantId, a.tid));
    const byId = new Map(ms.map((m) => [m.id, m]));
    const seller = byId.get(sellerId);
    const buyer = 'memberId' in buyerRef ? byId.get(buyerRef.memberId) : null;
    if (!seller || ('memberId' in buyerRef && !buyer)) throw new BusinessError('Penjual atau pembeli tidak valid.');
    if (seller.deactivatedAt || (buyer && buyer.deactivatedAt)) throw new BusinessError('Anggota nonaktif tidak dapat memesan atau menjual.');
    // Anggota hanya boleh membeli untuk dirinya sendiri (belanja) atau menjual ke pelanggan umum; tidak ada penjualan antaranggota.
    if (buyer && buyer.id !== seller.id) throw new BusinessError('Anggota tidak dapat menjual ke anggota lain. Catat penjualan ke pelanggan umum, atau pesan untuk diri sendiri.');
    const buyerCols = buyer ? { buyerId: buyer.id } : { buyerId: null, customerName: (buyerRef as { customerName: string }).customerName, customerPhone: (buyerRef as { customerPhone?: string }).customerPhone || null };
    const merged = new Map<string, number>();
    for (const it of items) merged.set(it.productId, (merged.get(it.productId) ?? 0) + it.qty);
    const prods = await tx.select().from(products).where(and(eq(products.tenantId, a.tid), inArray(products.id, [...merged.keys()]))).orderBy(asc(products.id)).for('update');
    if (prods.length !== merged.size) throw new BusinessError('Produk tidak ditemukan.');
    const reserved = await this.core.reservedMap(tx, a.tid, depot.id);
    const created: Order[] = [];
    const rates = await this.core.currentRates(tx, a.tid); // dibekukan pada pesanan
    const uplines = uplineChain(seller.id, (id) => byId.get(id)?.sponsorId);
    for (const p of prods) {
      const st = await this.core.lockStock(tx, depot.id, p.id);
      if (!p.active) throw new BusinessError(`Pesanan ditolak: ${p.name} nonaktif.`);
      if (merged.get(p.id)! > st.physical - (reserved.get(p.id) ?? 0)) throw new BusinessError(`Pesanan ditolak: ${p.name} melebihi stok tersedia di ${depot.name}.`);
    }
    // Satu checkout = satu pesanan: baris-baris produk berbagi groupId dan satu nomor (groupNo) dari penghitung.
    const groupId = randomUUID();
    const groupNo = await this.core.docNo(tx, a.tid, 'SO');
    const lines = [...merged.keys()].map((pid) => prods.find((p) => p.id === pid)!);
    for (const [i, p] of lines.entries()) {
      const no = lines.length === 1 ? groupNo : `${groupNo}-${i + 1}`;
      const [o] = await tx.insert(orders).values({
        tenantId: a.tid, no, groupId, groupNo, lineNo: i + 1, depotId: depot.id, sellerId: seller.id, ...buyerCols, productId: p.id, qty: merged.get(p.id)!, price: p.sellPrice, uplines, commissionRates: rates,
        ...(approved ? { approvedAt: new Date(), approvedBy: a.name } : {}),
      }).returning();
      created.push(o!);
    }
    await this.core.audit(tx, a, `Pesanan dibuat di ${depot.name}${buyer ? '' : ` untuk pelanggan ${buyerCols.customerName}`} dan stok direservasi (${groupNo}, ${created.length} produk)${approved ? '' : '; menunggu persetujuan toko'}`);
    return created;
  }

  async checkout(a: Actor, input: CheckoutInput) {
    return this.db.transaction(async (tx) => {
      const depot = await this.core.depotFor(tx, a, input.depotId);
      return this.createOrders(tx, a, depot, input.sellerId, input.buyerId ? { memberId: input.buyerId } : { customerName: input.customerName!, customerPhone: input.customerPhone }, input.items, true);
    });
  }

  /**
   * Kunci seluruh baris satu pesanan (semua produk dalam satu checkout). Semua tindakan berlaku atas pesanan utuh:
   * baris-barisnya selalu berstatus sama, jadi petugas tidak perlu memproses produk satu per satu.
   */
  private async lockGroup(q: Database, actor: Actor, id: string): Promise<Order[]> {
    const [head] = await q.select().from(orders).where(and(eq(orders.tenantId, actor.tid), eq(orders.id, id)));
    if (!head) throw new BusinessError('Pesanan tidak ditemukan');
    this.core.assertDepot(actor, head.depotId);
    const rows = await q.select().from(orders).where(and(eq(orders.tenantId, actor.tid), eq(orders.groupId, head.groupId))).orderBy(asc(orders.lineNo)).for('update');
    if (rows.every((o) => o.cancelled)) throw new BusinessError('Pesanan sudah dibatalkan.');
    return rows;
  }
  /** Belanja sendiri yang sudah diterima: 20% dari nilai masuk ke saldo penarikan anggota (sekali saja per pesanan). */
  private async creditReward(tx: Database, rows: Order[]) {
    const head = rows[0]!;
    if (!isSelfOrder(head) || rows.some((o) => o.reward > 0)) return 0;
    const per = rows.map((o) => ({ o, r: Math.floor((orderTotal(o) * REWARD_PERCENT) / 100) }));
    const total = per.reduce((s, x) => s + x.r, 0);
    if (total <= 0) return 0;
    for (const x of per) await tx.update(orders).set({ reward: x.r }).where(eq(orders.id, x.o.id));
    const [m] = await tx.select().from(members).where(eq(members.id, head.sellerId)).for('update');
    await tx.update(members).set({ rewardBalance: m!.rewardBalance + total }).where(eq(members.id, m!.id));
    await tx.insert(rewardEntries).values({ tenantId: head.tenantId, memberId: m!.id, kind: 'earn', amount: total, refNo: head.groupNo, note: `${REWARD_PERCENT}% dari belanja ${head.groupNo}` });
    await this.core.notify(tx, { tenantId: head.tenantId, memberId: m!.id, tab: 'info', cat: 'Saldo', title: 'Saldo penarikan bertambah', body: `Kamu mendapat Rp${total.toLocaleString('id-ID')} dari belanja #${head.groupNo}.`, route: 'reward' });
    return total;
  }

  /** Belanja sendiri yang sudah diterima: tiap produk memberi koin sebesar koin per satuan × jumlah (sekali saja per pesanan). */
  private async creditCoins(tx: Database, rows: Order[]) {
    const head = rows[0]!;
    if (!isSelfOrder(head) || rows.some((o) => o.coins > 0)) return 0;
    const ps = await tx.select({ id: products.id, coins: products.coins }).from(products).where(inArray(products.id, rows.map((o) => o.productId)));
    const per = rows.map((o) => ({ o, c: (ps.find((p) => p.id === o.productId)?.coins ?? 0) * o.qty }));
    const total = per.reduce((s, x) => s + x.c, 0);
    if (total <= 0) return 0;
    for (const x of per) if (x.c > 0) await tx.update(orders).set({ coins: x.c }).where(eq(orders.id, x.o.id));
    const [m] = await tx.select().from(members).where(eq(members.id, head.sellerId)).for('update');
    await tx.update(members).set({ coinBalance: m!.coinBalance + total }).where(eq(members.id, m!.id));
    await tx.insert(coinEntries).values({ tenantId: head.tenantId, memberId: m!.id, kind: 'earn', amount: total, refNo: head.groupNo, note: `Koin dari belanja ${head.groupNo}` });
    await this.core.notify(tx, { tenantId: head.tenantId, memberId: m!.id, tab: 'info', cat: 'Koin', title: 'Koin bertambah', body: `Kamu mendapat ${total.toLocaleString('id-ID')} koin dari belanja #${head.groupNo}.`, route: 'coins' });
    return total;
  }

  /**
   * Tagihan harian: pada hari aktif (belanja sendiri diterima) potong Rp30.000 (+ tunggakan) dari saldo penarikan, sekali per hari (WIB).
   * Dipanggil setelah imbalan dikreditkan supaya imbalan hari itu ikut tersedia untuk dipotong.
   */
  private async chargeInstallment(tx: Database, rows: Order[]) {
    const head = rows[0]!;
    if (!isSelfOrder(head)) return null;
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const [m] = await tx.select().from(members).where(eq(members.id, head.sellerId)).for('update');
    if (!m) return null;
    const [done] = await tx.select({ id: installmentEntries.id }).from(installmentEntries).where(and(eq(installmentEntries.memberId, m.id), eq(installmentEntries.day, day)));
    if (done) return null;
    const plan = planInstallment({ balance: m.rewardBalance, arrears: m.installmentArrears, daysCounted: m.installmentDays });
    if (plan.due <= 0) return null;
    const seq = plan.counted ? m.installmentDays + 1 : 0;
    await tx.update(members).set({ rewardBalance: m.rewardBalance - plan.paid, installmentDays: m.installmentDays + (plan.counted ? 1 : 0), installmentArrears: plan.arrears }).where(eq(members.id, m.id));
    await tx.insert(installmentEntries).values({ tenantId: head.tenantId, memberId: m.id, day, seq, due: plan.due, paid: plan.paid, arrearsAfter: plan.arrears, refNo: head.groupNo });
    if (plan.paid > 0) await tx.insert(rewardEntries).values({ tenantId: head.tenantId, memberId: m.id, kind: 'installment', amount: -plan.paid, refNo: head.groupNo, note: seq ? `Setoran tagihan harian ke-${seq}` : 'Pelunasan tunggakan tagihan' });
    return { seq, ...plan };
  }

  /** Ubah semua baris satu pesanan; perubahan status penting dikabarkan ke anggota pemesan (kecuali bila ia sendiri pelakunya: `quiet`). */
  private async setAll(tx: Database, rows: Order[], values: Partial<typeof orders.$inferInsert>, quiet = false) {
    await tx.update(orders).set(values).where(inArray(orders.id, rows.map((o) => o.id)));
    if (quiet) return;
    const head = rows[0]!;
    const v = values;
    let ev: [string, string, string] | null = null; // [kategori, judul, isi]
    if (v.cancelled) ev = ['Dibatalkan', 'Pesanan dibatalkan', v.cancelReason ?? 'Pesanan ini dibatalkan.'];
    else if (v.received) ev = ['Selesai', 'Pesanan selesai', 'Terima kasih sudah belanja!'];
    else if (v.shipped) ev = ['Berjalan', 'Pesanan dalam pengiriman', 'Pesananmu sedang dikirim. Konfirmasi saat barang diterima.'];
    else if (v.approvedAt) ev = ['Berjalan', 'Pesanan disetujui', 'Toko menyetujui pesananmu dan sedang menyiapkannya.'];
    else if (v.pay === 'balance' || v.pay === 'cash') ev = ['Berjalan', 'Pembayaran diterima', 'Pembayaran pesananmu sudah diterima.'];
    if (!ev) return;
    const total = groupTotal(rows);
    await this.core.notify(tx, { tenantId: head.tenantId, memberId: head.sellerId, tab: 'trx', cat: ev[0], title: ev[1], body: `#${head.groupNo} · Rp${total.toLocaleString('id-ID')}. ${ev[2]}`, route: 'orders', refId: head.groupId });
  }

  private needApproved(rows: Order[]) {
    if (rows.some((o) => !o.approvedAt)) throw new BusinessError('Pesanan belum disetujui toko.');
  }

  /**
   * Setujui pesanan. Pesanan anggota (belanja sendiri MAUPUN penjualan ke pelanggan umum) langsung dibayar dari saldo belanja
   * anggota penjual pada saat yang sama (total semua produk dipotong sekali): anggota "membeli" barang dari koperasi dengan
   * saldonya, sedangkan pelanggan membayar tunai langsung kepada anggota (di luar sistem). Bila saldo tidak cukup atau belum
   * aktif, persetujuan ditolak dengan alasan jelas (pesanan tetap menunggu; petugas dapat menolaknya).
   */
  async approve(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const rows = await this.lockGroup(tx, a, id);
      if (rows.some((o) => o.approvedAt)) throw new BusinessError('Pesanan sudah disetujui.');
      const head = rows[0]!;
      const payerName = await this.debitBalance(tx, head.sellerId, groupTotal(rows), 'persetujuan');
      await this.setAll(tx, rows, { approvedAt: new Date(), approvedBy: a.name, pay: 'balance' as const });
      await this.core.audit(tx, a, `${head.groupNo} disetujui toko; saldo belanja ${payerName} terpotong Rp${groupTotal(rows).toLocaleString('id-ID')}`);
      return { ok: true, paid: true };
    });
  }

  /** Potong saldo belanja anggota penjual sebesar total; menolak bila saldo belum aktif/tidak cukup. Mengembalikan nama anggota. */
  private async debitBalance(tx: Database, buyerId: string, total: number, konteks: 'persetujuan' | 'pembayaran'): Promise<string> {
    const [buyer] = await tx.select().from(members).where(eq(members.id, buyerId)).for('update');
    const awal = konteks === 'persetujuan' ? 'Tidak bisa disetujui: ' : 'Pembayaran ditolak: ';
    if (!buyer!.active) throw new BusinessError(`${awal}saldo belanja ${buyer!.name} belum aktif. Aktifkan anggota lebih dulu, atau tolak pesanan ini.`);
    if (buyer!.balance < total) throw new BusinessError(`${awal}saldo belanja ${buyer!.name} tidak cukup (saldo Rp${buyer!.balance.toLocaleString('id-ID')}, pesanan Rp${total.toLocaleString('id-ID')}). Tolak pesanan ini atau minta anggota mengurangi jumlah.`);
    await tx.update(members).set({ balance: buyer!.balance - total }).where(eq(members.id, buyer!.id));
    return buyer!.name;
  }

  /** Tolak pesanan yang belum disetujui: seluruh pesanan dibatalkan dan reservasi stok dilepas (belum ada pembayaran). */
  async reject(a: Actor, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const rows = await this.lockGroup(tx, a, id);
      if (rows.some((o) => o.approvedAt)) throw new BusinessError('Pesanan sudah disetujui; gunakan pembatalan.');
      await this.setAll(tx, rows, { cancelled: true, cancelReason: `Ditolak toko: ${reason}` });
      await this.core.audit(tx, a, `${rows[0]!.groupNo} ditolak toko: ${reason}`);
      return { ok: true };
    });
  }

  async payWithBalance(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const rows = await this.lockGroup(tx, a, id);
      this.needApproved(rows);
      const head = rows[0]!;
      if (rows.some((o) => o.pay !== 'unpaid')) throw new BusinessError('Pesanan sudah dibayar.');
      const name = await this.debitBalance(tx, head.sellerId, groupTotal(rows), 'pembayaran');
      await this.setAll(tx, rows, { pay: 'balance' });
      await this.core.audit(tx, a, `${head.groupNo} dibayar dari saldo belanja ${name}`);
      return { ok: true };
    });
  }

  // ───────────── Pemeriksaan barang oleh anggota ─────────────
  /** Laporan terbaru per pesanan (groupId), tanpa rincian baris. */
  async latestReports(q: Database, tid: string, groupIds: string[]) {
    const out = new Map<string, { id: string; status: string; note: string | null; createdAt: Date; resolution: string | null; resolvedByName: string | null; resolvedAt: Date | null }>();
    const ids = [...new Set(groupIds)];
    if (!ids.length) return out;
    const rows = await q.select().from(orderReports).where(and(eq(orderReports.tenantId, tid), inArray(orderReports.groupId, ids))).orderBy(desc(orderReports.createdAt));
    for (const r of rows) if (!out.has(r.groupId)) out.set(r.groupId, { id: r.id, status: r.status, note: r.note, createdAt: r.createdAt, resolution: r.resolution, resolvedByName: r.resolvedByName, resolvedAt: r.resolvedAt });
    return out;
  }

  /**
   * Anggota (penjual/pemesan) memeriksa barang yang dikirim untuk pesanannya. Semua sesuai → tercatat "sesuai".
   * Ada yang kurang/rusak/salah → laporan terbuka untuk toko (muncul di Pesanan petugas) sampai ditanggapi.
   */
  async submitCheck(a: Actor, memberId: string, id: string, input: z.infer<typeof orderCheckSchema>) {
    return this.db.transaction(async (tx) => {
      const rows = await this.lockGroup(tx, { ...a, did: null }, id);
      const head = rows[0]!;
      if (head.sellerId !== memberId) throw new BusinessError('Pesanan tidak ditemukan.');
      if (rows.some((o) => o.cancelled || o.returned)) throw new BusinessError('Pesanan ini sudah dibatalkan atau diretur.');
      if (rows.some((o) => !o.shipped)) throw new BusinessError('Barang belum dikirim, belum bisa diperiksa.');
      // Pemeriksaan hanya SEKALI per pesanan (sesuai atau dilaporkan); tindak lanjut selisih lewat tanggapan toko.
      const [done] = await tx.select({ id: orderReports.id, status: orderReports.status }).from(orderReports).where(and(eq(orderReports.tenantId, a.tid), eq(orderReports.groupId, head.groupId))).limit(1);
      if (done) throw new BusinessError(done.status === 'open' ? 'Barang pesanan ini sudah Anda laporkan; tunggu tanggapan toko.' : 'Barang pesanan ini sudah diperiksa. Pemeriksaan hanya bisa dilakukan sekali.');
      const prods = await tx.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, rows.map((o) => o.productId)));
      const name = (pid: string) => prods.find((p) => p.id === pid)?.name ?? 'Produk';
      const checks = new Map((input.items ?? []).map((i) => [i.productId, i]));
      for (const i of input.items ?? []) if (!rows.some((o) => o.productId === i.productId)) throw new BusinessError('Ada produk yang tidak ada di pesanan ini.');
      if ((input.items ?? []).length !== checks.size) throw new BusinessError('Produk yang sama tidak boleh dua kali.');
      const lines = rows.map((o) => {
        const c = checks.get(o.productId);
        const got = c ? c.qty : o.qty;
        if (got > o.qty) throw new BusinessError(`${name(o.productId)}: jumlah diterima (${got}) melebihi yang dipesan (${o.qty}).`);
        if (got < o.qty && !c?.issue) throw new BusinessError(`${name(o.productId)}: diterima ${got} dari ${o.qty} dipesan. Pilih alasan selisihnya.`);
        if (c?.issue === 'lainnya' && !c.note?.trim()) throw new BusinessError(`${name(o.productId)}: alasan “Lainnya” perlu dijelaskan di catatan.`);
        return { o, got, issue: got < o.qty || c?.issue ? c?.issue ?? null : null, note: c?.note?.trim() || null };
      });
      const bad = lines.filter((l) => l.got < l.o.qty || l.issue);
      const status = bad.length ? 'open' : 'ok';
      const [r] = await tx.insert(orderReports).values({ tenantId: a.tid, groupId: head.groupId, groupNo: head.groupNo, depotId: head.depotId, memberId, status, note: input.note || null }).returning();
      // Pemeriksaan anggota sekaligus konfirmasi barang sudah diterima: petugas tidak perlu mengonfirmasi lagi.
      let autoReceived = false;
      if (rows.some((o) => !o.received)) {
        const [mem] = await tx.select({ name: members.name }).from(members).where(eq(members.id, memberId));
        await this.setAll(tx, rows, { received: true, receivedAt: new Date(), proofRef: `CEK-${head.groupNo}`, receiverName: mem?.name ?? 'Anggota' }, true);
        autoReceived = true;
        const earned = await this.creditReward(tx, rows);
        if (earned) await this.core.audit(tx, a, `${head.groupNo}: saldo penarikan anggota bertambah Rp${earned.toLocaleString('id-ID')} (${REWARD_PERCENT}%)`);
        const coins = await this.creditCoins(tx, rows);
        if (coins) await this.core.audit(tx, a, `${head.groupNo}: koin anggota bertambah ${coins}`);
        const inst = await this.chargeInstallment(tx, rows);
        if (inst) await this.core.audit(tx, a, `${head.groupNo}: tagihan harian ${inst.seq ? `ke-${inst.seq}` : '(tunggakan)'} dipotong Rp${inst.paid.toLocaleString('id-ID')} dari saldo penarikan${inst.arrears ? `; tunggakan Rp${inst.arrears.toLocaleString('id-ID')}` : ''}`);
      }
      await tx.insert(orderReportLines).values(lines.map((l) => ({ reportId: r!.id, productId: l.o.productId, qtyOrdered: l.o.qty, qtyReceived: l.got, issue: l.issue, note: l.note })));
      await this.core.audit(tx, a, bad.length
        ? `${head.groupNo}: anggota melaporkan barang TIDAK SESUAI: ${bad.map((l) => `${name(l.o.productId)} ${l.got}/${l.o.qty} (${SHIPMENT_ISSUES[(l.issue ?? 'kurang') as keyof typeof SHIPMENT_ISSUES]}${l.note ? `: ${l.note}` : ''})`).join('; ')}`
        : `${head.groupNo}: anggota memeriksa barang, semua sesuai`);
      if (autoReceived) await this.core.audit(tx, a, `Penerimaan ${head.groupNo} terkonfirmasi otomatis dari pemeriksaan anggota`);
      return { id: r!.id, status };
    });
  }

  /** Laporan terbaru satu pesanan beserta rincian per produk (untuk petugas toko). */
  async reportOf(a: Actor, id: string) {
    const [head] = await this.db.select().from(orders).where(and(eq(orders.tenantId, a.tid), eq(orders.id, id)));
    if (!head) throw new BusinessError('Pesanan tidak ditemukan');
    this.core.assertDepot(a, head.depotId);
    const [r] = await this.db.select().from(orderReports).where(and(eq(orderReports.tenantId, a.tid), eq(orderReports.groupId, head.groupId))).orderBy(desc(orderReports.createdAt)).limit(1);
    if (!r) return null;
    const [ls, [m]] = await Promise.all([
      this.db.select({ l: orderReportLines, name: products.name, sku: products.sku }).from(orderReportLines).innerJoin(products, eq(products.id, orderReportLines.productId)).where(eq(orderReportLines.reportId, r.id)),
      this.db.select({ name: members.name }).from(members).where(eq(members.id, r.memberId)),
    ]);
    return { id: r.id, groupNo: r.groupNo, status: r.status, note: r.note, memberName: m?.name ?? '—', createdAt: r.createdAt, resolution: r.resolution, resolvedByName: r.resolvedByName, resolvedAt: r.resolvedAt,
      lines: ls.map(({ l, name, sku }) => ({ productId: l.productId, name, sku, qtyOrdered: l.qtyOrdered, qtyReceived: l.qtyReceived, issue: l.issue, note: l.note })) };
  }

  /** Petugas toko menanggapi laporan anggota dan menandainya selesai. */
  async resolveReport(a: Actor, id: string, input: z.infer<typeof resolveReportSchema>) {
    return this.db.transaction(async (tx) => {
      const rows = await this.lockGroup(tx, a, id);
      const head = rows[0]!;
      const [r] = await tx.select().from(orderReports).where(and(eq(orderReports.tenantId, a.tid), eq(orderReports.groupId, head.groupId), eq(orderReports.status, 'open'))).orderBy(desc(orderReports.createdAt)).limit(1).for('update');
      if (!r) throw new BusinessError('Tidak ada laporan anggota yang menunggu tanggapan.');
      await tx.update(orderReports).set({ status: 'resolved', resolution: input.note, resolvedByName: a.name, resolvedAt: new Date() }).where(eq(orderReports.id, r.id));
      await this.core.audit(tx, a, `Laporan anggota ${head.groupNo} ditanggapi: ${input.note}`);
      return { ok: true };
    });
  }

  /** Penerimaan kas pelanggan umum (bukan untuk pesanan yang sudah dibayar saldo): dicatat petugas toko saat uang diterima, atau pengurus. */
  async payWithCash(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const rows = await this.lockGroup(tx, a, id);
      this.needApproved(rows);
      if (rows.some((o) => o.pay !== 'unpaid')) throw new BusinessError('Pesanan sudah dibayar; jangan catat kas lagi.');
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, a.tid)).for('update');
      await tx.update(tenants).set({ cash: t!.cash + groupTotal(rows) }).where(eq(tenants.id, a.tid));
      await this.setAll(tx, rows, { pay: 'cash' });
      await this.core.audit(tx, a, `Penerimaan kas untuk ${rows[0]!.groupNo}`);
      return { ok: true };
    });
  }

  async ship(a: Actor, id: string, deliveryRef: string) {
    return this.db.transaction(async (tx) => {
      const rows = await this.lockGroup(tx, a, id);
      if (rows.some((o) => o.pay === 'unpaid')) throw new BusinessError('Pesanan harus dibayar penuh sebelum dikirim.');
      if (rows.some((o) => o.shipped)) throw new BusinessError('Pesanan sudah dikirim.');
      for (const o of rows) {
        const st = await this.core.lockStock(tx, o.depotId, o.productId);
        if (o.qty > st.physical) throw new BusinessError('Stok fisik tidak cukup.');
        await this.core.moveStock(tx, a, { depotId: o.depotId, productId: o.productId, delta: -o.qty, type: 'shipment', refNo: o.no, note: 'Pengiriman pesanan' });
      }
      await this.setAll(tx, rows, { shipped: true, deliveryRef });
      await this.core.audit(tx, a, `${rows[0]!.groupNo} dikirim (${deliveryRef}); fisik dan reservasi berkurang`);
      return { ok: true };
    });
  }

  async receive(a: Actor, id: string, proofRef: string, receiverName: string) {
    return this.db.transaction(async (tx) => {
      const rows = await this.lockGroup(tx, a, id);
      if (rows.some((o) => !o.shipped)) throw new BusinessError('Pesanan belum dikirim.');
      if (rows.some((o) => o.received)) throw new BusinessError('Penerimaan sudah dikonfirmasi.');
      await this.setAll(tx, rows, { received: true, receivedAt: new Date(), proofRef, receiverName });
      await this.core.audit(tx, a, `Penerimaan ${rows[0]!.groupNo} dikonfirmasi: ${receiverName}`);
      const earned = await this.creditReward(tx, rows);
      if (earned) await this.core.audit(tx, a, `${rows[0]!.groupNo}: saldo penarikan anggota bertambah Rp${earned.toLocaleString('id-ID')} (${REWARD_PERCENT}%)`);
      const coins = await this.creditCoins(tx, rows);
      if (coins) await this.core.audit(tx, a, `${rows[0]!.groupNo}: koin anggota bertambah ${coins}`);
      const inst = await this.chargeInstallment(tx, rows);
      if (inst) await this.core.audit(tx, a, `${rows[0]!.groupNo}: tagihan harian ${inst.seq ? `ke-${inst.seq}` : '(tunggakan)'} dipotong Rp${inst.paid.toLocaleString('id-ID')} dari saldo penarikan${inst.arrears ? `; tunggakan Rp${inst.arrears.toLocaleString('id-ID')}` : ''}`);
      return { ok: true };
    });
  }

  /** Batal: hanya sebelum pengiriman. Refund penuh ke saldo belanja bila dibayar dengan saldo; kas pelanggan tidak di-refund otomatis. */
  async cancel(a: Actor, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const rows = await this.lockGroup(tx, a, id);
      const head = rows[0]!;
      if (rows.some((o) => o.shipped)) throw new BusinessError('Pesanan yang sudah dikirim tidak dapat dibatalkan.');
      if (rows.some((o) => o.pay === 'cash')) throw new BusinessError('Pesanan dibayar kas: pengembalian dana dilakukan di luar sistem.');
      const refund = rows.some((o) => o.pay === 'balance');
      if (refund) {
        const [payer] = await tx.select().from(members).where(eq(members.id, head.sellerId)).for('update');
        await tx.update(members).set({ balance: payer!.balance + groupTotal(rows) }).where(eq(members.id, payer!.id));
      }
      await this.setAll(tx, rows, { cancelled: true, cancelReason: reason });
      await this.core.audit(tx, a, `${head.groupNo} dibatalkan: ${reason}${refund ? '; saldo dikembalikan penuh' : ''}`);
      return { ok: true };
    });
  }

  /** Komisi disetujui/dibayar per pesanan utuh (semua baris produknya sekaligus). */
  async setCommission(a: Actor, id: string, to: 'approved' | 'paid') {
    return this.db.transaction(async (tx) => {
      const rows = await this.lockGroup(tx, a, id);
      const head = rows[0]!;
      if (rows.some((o) => !commissionEligible(o))) throw new BusinessError(head.buyerId ? 'Komisi hanya untuk penjualan ke pelanggan umum; belanja anggota tidak berkomisi.' : 'Pesanan belum layak komisi (lunas + bukti terima, belum diretur).');
      if (to === 'approved' && rows.some((o) => o.commission !== 'pending')) throw new BusinessError('Komisi bukan berstatus pending.');
      if (to === 'paid' && rows.some((o) => o.commission !== 'approved')) throw new BusinessError('Komisi harus disetujui lebih dulu.');
      await this.setAll(tx, rows, to === 'approved'
        ? { commission: 'approved' as const, commissionApprovedById: a.sub, commissionApprovedBy: a.name, commissionApprovedAt: new Date() }
        : { commission: 'paid' as const, commissionPaidBy: a.name, commissionPaidAt: new Date() });
      await this.core.audit(tx, a, to === 'approved' ? `Komisi ${head.groupNo} disetujui` : `Pembayaran komisi ${head.groupNo} dicatat (bukan transfer bank); disetujui oleh ${head.commissionApprovedBy ?? '—'}`);
      return { ok: true };
    });
  }

  /** Komisi per baris penerima. Pesanan yang diretur tetap tampil berstatus "reversed"; yang sudah dibayar ditandai perlu ditagihkan kembali. */
  async commissions(tid: string) {
    const rows = (await this.db.select().from(orders).where(eq(orders.tenantId, tid)).orderBy(desc(orders.createdAt))).filter((o) => commissionEligible(o) || (o.returned && o.commissionReversedFrom));
    return rows.flatMap((o) => commissionLines(o.sellerId, o.uplines, orderTotal(o), o.commissionRates).map((l) => ({
      orderId: o.id, orderNo: o.no, status: o.commission, approvedBy: o.commissionApprovedBy, paidBy: o.commissionPaidBy, reversedFrom: o.commissionReversedFrom, clawback: o.commissionReversedFrom === 'paid', ...l,
    })));
  }
}

@Controller('orders')
@Roles(...STAFF)
class OrdersController {
  constructor(private readonly svc: OrdersService) {}
  @Get() list(@CurrentActor() a: Actor) { return this.svc.list(a); }
  @Get('commissions') @Roles(...FINANCE) commissions(@CurrentActor() a: Actor) { return this.svc.commissions(a.tid); }
  @Post() @Roles(...OPS) checkout(@CurrentActor() a: Actor, @Body(new ZodPipe(checkoutSchema)) b: CheckoutInput) { return this.svc.checkout(a, b); }
  @Post(':id/approve') @Roles(...OPS) approveOrder(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.approve(a, id); }
  @Post(':id/reject') @Roles(...OPS) reject(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectSchema)) b: any) { return this.svc.reject(a, id, b.reason); }
  @Post(':id/pay-balance') @Roles(...OPS) pay(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.payWithBalance(a, id); }
  @Post(':id/pay-cash') @Roles(...OPS) cash(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.payWithCash(a, id); }
  @Post(':id/ship') @Roles(...OPS) ship(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(shipSchema)) b: any) { return this.svc.ship(a, id, b.deliveryRef); }
  @Post(':id/receive') @Roles(...OPS) receive(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(receiveOrderSchema)) b: any) { return this.svc.receive(a, id, b.proofRef, b.receiverName); }
  @Get(':id/report') reportOf(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.reportOf(a, id); }
  @Post(':id/report/resolve') @Roles(...OPS) resolveReport(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(resolveReportSchema)) b: z.infer<typeof resolveReportSchema>) { return this.svc.resolveReport(a, id, b); }
  @Post(':id/cancel') @Roles(...OPS) cancel(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelSchema)) b: any) { return this.svc.cancel(a, id, b.reason); }
  @Post(':id/commission/approve') @Roles(...FINANCE) approve(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setCommission(a, id, 'approved'); }
  @Post(':id/commission/pay') @Roles(...FINANCE) payC(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setCommission(a, id, 'paid'); }
}

@Module({ controllers: [OrdersController], providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {}
