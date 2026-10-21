import { Body, Controller, ForbiddenException, Get, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { and, desc, eq, or, gt, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { INSTALLMENT_AMOUNT, INSTALLMENT_DAYS, REWARD_PERCENT, rejectSchema, rewardTransferSchema, withdrawalSchema } from '@sajadah/shared';
import { Database } from '../db/db';
import { coinEntries, installmentEntries, members, orders, rewardEntries, voucherRedemptions, withdrawals } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { orderTotal } from '../orders/orders.module';
import { CurrentActor, FINANCE, Roles } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

/**
 * Saldo penarikan anggota: 20% dari belanja sendiri yang sudah diterima (dikreditkan oleh OrdersService).
 * Anggota bisa memindahkannya ke saldo belanja atau mengajukan penarikan ke rekening; pengurus menyetujui dan mentransfer di luar aplikasi.
 */
@Injectable()
export class RewardsService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) {}

  private async lockMember(tx: Database, a: Actor) {
    if (!a.mid) throw new ForbiddenException('Akun tidak terhubung ke anggota');
    const [m] = await tx.select().from(members).where(and(eq(members.id, a.mid), eq(members.tenantId, a.tid))).for('update');
    if (!m) throw new ForbiddenException('Anggota tidak ditemukan');
    if (m.deactivatedAt) throw new BusinessError('Anggota sudah nonaktif.');
    return m;
  }

  async mine(a: Actor) {
    if (!a.mid) throw new ForbiddenException('Akun tidak terhubung ke anggota');
    const [m] = await this.db.select({ rewardBalance: members.rewardBalance }).from(members).where(and(eq(members.id, a.mid), eq(members.tenantId, a.tid)));
    const [entries, ws] = await Promise.all([
      this.db.select().from(rewardEntries).where(eq(rewardEntries.memberId, a.mid)).orderBy(desc(rewardEntries.createdAt)).limit(50),
      this.db.select().from(withdrawals).where(eq(withdrawals.memberId, a.mid)).orderBy(desc(withdrawals.createdAt)).limit(20),
    ]);
    return {
      percent: REWARD_PERCENT, balance: m?.rewardBalance ?? 0,
      entries: entries.map((e) => ({ id: e.id, kind: e.kind, amount: e.amount, refNo: e.refNo, note: e.note, createdAt: e.createdAt })),
      withdrawals: ws.map((w) => ({ id: w.id, no: w.no, amount: w.amount, bank: w.bank, accountNo: w.accountNo, accountName: w.accountName, status: w.status, reason: w.reason, createdAt: w.createdAt })),
    };
  }

  /** Pindahkan sebagian/seluruh saldo penarikan menjadi saldo belanja. */
  async transfer(a: Actor, input: z.infer<typeof rewardTransferSchema>) {
    return this.db.transaction(async (tx) => {
      const m = await this.lockMember(tx, a);
      if (input.amount > m.rewardBalance) throw new BusinessError(`Saldo penarikan hanya ${rp(m.rewardBalance)}.`);
      await tx.update(members).set({ rewardBalance: m.rewardBalance - input.amount, balance: m.balance + input.amount }).where(eq(members.id, m.id));
      await tx.insert(rewardEntries).values({ tenantId: a.tid, memberId: m.id, kind: 'transfer', amount: -input.amount, note: 'Dipindah ke saldo belanja' });
      await this.core.audit(tx, a, `${m.name} memindahkan ${rp(input.amount)} dari saldo penarikan ke saldo belanja`);
      return { rewardBalance: m.rewardBalance - input.amount, balance: m.balance + input.amount };
    });
  }

  /** Ajukan penarikan ke rekening: saldo langsung ditahan (dikurangi) sampai pengurus memutuskan. */
  async request(a: Actor, input: z.infer<typeof withdrawalSchema>) {
    return this.db.transaction(async (tx) => {
      const m = await this.lockMember(tx, a);
      if (input.amount > m.rewardBalance) throw new BusinessError(`Saldo penarikan hanya ${rp(m.rewardBalance)}.`);
      const no = await this.core.docNo(tx, a.tid, 'WD');
      await tx.update(members).set({ rewardBalance: m.rewardBalance - input.amount }).where(eq(members.id, m.id));
      const [w] = await tx.insert(withdrawals).values({ tenantId: a.tid, memberId: m.id, no, amount: input.amount, bank: input.bank, accountNo: input.accountNo, accountName: input.accountName }).returning();
      await tx.insert(rewardEntries).values({ tenantId: a.tid, memberId: m.id, kind: 'withdraw', amount: -input.amount, refNo: no, note: `Penarikan ke ${input.bank} ${input.accountNo}` });
      await this.core.audit(tx, a, `${no}: ${m.name} mengajukan penarikan ${rp(input.amount)} ke ${input.bank} ${input.accountNo} a.n. ${input.accountName}`);
      return { id: w!.id, no, status: w!.status, rewardBalance: m.rewardBalance - input.amount };
    });
  }

  async list(a: Actor) {
    const rows = await this.db.select({ w: withdrawals, memberName: members.name, memberNo: members.memberNo }).from(withdrawals)
      .innerJoin(members, eq(members.id, withdrawals.memberId)).where(eq(withdrawals.tenantId, a.tid)).orderBy(desc(withdrawals.createdAt));
    return rows.map(({ w, memberName, memberNo }) => ({ id: w.id, no: w.no, memberId: w.memberId, memberName, memberNo, amount: w.amount, bank: w.bank, accountNo: w.accountNo, accountName: w.accountName, status: w.status, reason: w.reason, decidedAt: w.decidedAt, decidedByName: w.decidedByName, createdAt: w.createdAt }));
  }

  /** Tagihan harian milik anggota: kemajuan hari aktif, tunggakan, dan riwayat potongan. */
  async installments(a: Actor) {
    if (!a.mid) throw new ForbiddenException('Akun tidak terhubung ke anggota');
    const [m] = await this.db.select().from(members).where(and(eq(members.id, a.mid), eq(members.tenantId, a.tid)));
    const entries = await this.db.select().from(installmentEntries).where(eq(installmentEntries.memberId, a.mid)).orderBy(desc(installmentEntries.day)).limit(60);
    const counted = await this.db.select({ day: installmentEntries.day }).from(installmentEntries).where(and(eq(installmentEntries.memberId, a.mid), gt(installmentEntries.seq, 0))).orderBy(installmentEntries.day);
    const paidDates = [...new Set(counted.map((e) => e.day))];
    const days = m?.installmentDays ?? 0, arrears = m?.installmentArrears ?? 0;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const remainingDays = Math.max(0, INSTALLMENT_DAYS - days);
    return {
      amount: INSTALLMENT_AMOUNT, totalDays: INSTALLMENT_DAYS, paidDays: days, remainingDays, arrears,
      remainingAmount: remainingDays * INSTALLMENT_AMOUNT + arrears,
      status: days === 0 && arrears === 0 ? 'belum_mulai' : remainingDays === 0 && arrears === 0 ? 'lunas' : 'berjalan',
      chargedToday: entries.some((e) => e.day === today),
      today, startDay: paidDates[0] ?? null, paidDates,
      entries: entries.map((e) => ({ id: e.id, day: e.day, seq: e.seq, due: e.due, paid: e.paid, arrearsAfter: e.arrearsAfter, refNo: e.refNo })),
    };
  }

  /** Ringkasan tagihan harian semua anggota untuk pengurus. */
  async installmentsSummary(a: Actor) {
    const ms = await this.db.select().from(members).where(eq(members.tenantId, a.tid)).orderBy(desc(members.installmentDays));
    const [tot] = await this.db.select({ paid: sql<number>`coalesce(sum(${installmentEntries.paid}), 0)`.mapWith(Number) }).from(installmentEntries).where(eq(installmentEntries.tenantId, a.tid));
    const rows = ms.map((m) => ({ id: m.id, name: m.name, memberNo: m.memberNo, paidDays: m.installmentDays, arrears: m.installmentArrears, rewardBalance: m.rewardBalance, remainingDays: Math.max(0, INSTALLMENT_DAYS - m.installmentDays), status: m.installmentDays === 0 && m.installmentArrears === 0 ? 'belum_mulai' : m.installmentDays >= INSTALLMENT_DAYS && m.installmentArrears === 0 ? 'lunas' : 'berjalan' }));
    return {
      amount: INSTALLMENT_AMOUNT, totalDays: INSTALLMENT_DAYS,
      kpis: { collected: tot?.paid ?? 0, arrears: rows.reduce((s, r) => s + r.arrears, 0), running: rows.filter((r) => r.status === 'berjalan').length, settled: rows.filter((r) => r.status === 'lunas').length, notStarted: rows.filter((r) => r.status === 'belum_mulai').length },
      members: rows,
    };
  }

  /** Ringkasan imbalan untuk pengurus: saldo penarikan dan koin yang beredar, imbalan per pesanan, dan saldo per anggota. */
  async summary(a: Actor) {
    const sum = (col: any) => sql<number>`coalesce(sum(${col}), 0)`.mapWith(Number);
    const [[bal], [earned], [paid], [coinsEarned], [coinsRedeemed], [wdPending], [vcPending], rows, ms] = await Promise.all([
      this.db.select({ reward: sum(members.rewardBalance), coins: sum(members.coinBalance) }).from(members).where(eq(members.tenantId, a.tid)),
      this.db.select({ v: sum(rewardEntries.amount) }).from(rewardEntries).where(and(eq(rewardEntries.tenantId, a.tid), eq(rewardEntries.kind, 'earn'))),
      this.db.select({ v: sum(withdrawals.amount) }).from(withdrawals).where(and(eq(withdrawals.tenantId, a.tid), eq(withdrawals.status, 'paid'))),
      this.db.select({ v: sum(coinEntries.amount) }).from(coinEntries).where(and(eq(coinEntries.tenantId, a.tid), eq(coinEntries.kind, 'earn'))),
      this.db.select({ v: sum(voucherRedemptions.coins) }).from(voucherRedemptions).where(and(eq(voucherRedemptions.tenantId, a.tid), sql`${voucherRedemptions.status} <> 'rejected'`)),
      this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(withdrawals).where(and(eq(withdrawals.tenantId, a.tid), eq(withdrawals.status, 'pending'))),
      this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(voucherRedemptions).where(and(eq(voucherRedemptions.tenantId, a.tid), eq(voucherRedemptions.status, 'pending'))),
      this.db.select({ o: orders, memberName: members.name, memberNo: members.memberNo }).from(orders).innerJoin(members, eq(members.id, orders.sellerId))
        .where(and(eq(orders.tenantId, a.tid), or(gt(orders.reward, 0), gt(orders.coins, 0)))).orderBy(desc(orders.createdAt)),
      this.db.select().from(members).where(and(eq(members.tenantId, a.tid), or(gt(members.rewardBalance, 0), gt(members.coinBalance, 0)))).orderBy(desc(members.rewardBalance)),
    ]);
    const g = new Map<string, { no: string; at: Date; memberName: string; memberNo: string | null; total: number; reward: number; coins: number }>();
    for (const { o, memberName, memberNo } of rows) {
      const x = g.get(o.groupId) ?? { no: o.groupNo, at: o.createdAt, memberName, memberNo, total: 0, reward: 0, coins: 0 };
      x.total += orderTotal(o); x.reward += o.reward; x.coins += o.coins;
      g.set(o.groupId, x);
    }
    return {
      percent: REWARD_PERCENT,
      kpis: { rewardBalance: bal?.reward ?? 0, rewardEarned: earned?.v ?? 0, withdrawnPaid: paid?.v ?? 0, coinBalance: bal?.coins ?? 0, coinsEarned: coinsEarned?.v ?? 0, coinsRedeemed: coinsRedeemed?.v ?? 0, withdrawalsPending: wdPending?.n ?? 0, redemptionsPending: vcPending?.n ?? 0 },
      orders: [...g.entries()].map(([id, x]) => ({ id, ...x })),
      members: ms.map((m) => ({ id: m.id, name: m.name, memberNo: m.memberNo, balance: m.balance, rewardBalance: m.rewardBalance, coinBalance: m.coinBalance })),
    };
  }

  private async decide(a: Actor, id: string, to: 'paid' | 'rejected', reason?: string) {
    return this.db.transaction(async (tx) => {
      const [w] = await tx.select().from(withdrawals).where(and(eq(withdrawals.tenantId, a.tid), eq(withdrawals.id, id))).for('update');
      if (!w) throw new BusinessError('Pengajuan tidak ditemukan.');
      if (w.status !== 'pending') throw new BusinessError('Pengajuan ini sudah diputuskan.');
      await tx.update(withdrawals).set({ status: to, reason: reason ?? null, decidedAt: new Date(), decidedByName: a.name }).where(eq(withdrawals.id, id));
      if (to === 'rejected') {
        const [m] = await tx.select().from(members).where(eq(members.id, w.memberId)).for('update');
        await tx.update(members).set({ rewardBalance: m!.rewardBalance + w.amount }).where(eq(members.id, m!.id));
        await tx.insert(rewardEntries).values({ tenantId: a.tid, memberId: w.memberId, kind: 'refund', amount: w.amount, refNo: w.no, note: `Penarikan ditolak: ${reason}` });
      }
      await this.core.notify(tx, { tenantId: a.tid, memberId: w.memberId, tab: 'info', cat: 'Saldo', title: to === 'paid' ? 'Penarikan sudah ditransfer' : 'Penarikan ditolak', body: to === 'paid' ? `${w.no}: ${rp(w.amount)} sudah ditransfer ke ${w.bank} ${w.accountNo}.` : `${w.no}: ${rp(w.amount)} ditolak (${reason}). Saldo dikembalikan.`, route: 'reward' });
      await this.core.audit(tx, a, to === 'paid' ? `${w.no}: penarikan ${rp(w.amount)} ditandai sudah ditransfer ke ${w.bank} ${w.accountNo}` : `${w.no}: penarikan ${rp(w.amount)} ditolak (${reason}); saldo dikembalikan`);
      return { ok: true };
    });
  }
  pay(a: Actor, id: string) { return this.decide(a, id, 'paid'); }
  reject(a: Actor, id: string, reason: string) { return this.decide(a, id, 'rejected', reason); }
}

@Controller()
class RewardsController {
  constructor(private readonly svc: RewardsService) {}
  @Get('me/rewards') @Roles('member') mine(@CurrentActor() a: Actor) { return this.svc.mine(a); }
  @Post('me/rewards/transfer') @Roles('member') transfer(@CurrentActor() a: Actor, @Body(new ZodPipe(rewardTransferSchema)) b: z.infer<typeof rewardTransferSchema>) { return this.svc.transfer(a, b); }
  @Post('me/withdrawals') @Roles('member') request(@CurrentActor() a: Actor, @Body(new ZodPipe(withdrawalSchema)) b: z.infer<typeof withdrawalSchema>) { return this.svc.request(a, b); }
  @Get('me/installments') @Roles('member') installments(@CurrentActor() a: Actor) { return this.svc.installments(a); }
  @Get('installments/summary') @Roles(...FINANCE) installmentsSummary(@CurrentActor() a: Actor) { return this.svc.installmentsSummary(a); }
  @Get('rewards/summary') @Roles(...FINANCE) summary(@CurrentActor() a: Actor) { return this.svc.summary(a); }
  @Get('withdrawals') @Roles(...FINANCE) list(@CurrentActor() a: Actor) { return this.svc.list(a); }
  @Post('withdrawals/:id/pay') @Roles(...FINANCE) pay(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.pay(a, id); }
  @Post('withdrawals/:id/reject') @Roles(...FINANCE) reject(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectSchema)) b: z.infer<typeof rejectSchema>) { return this.svc.reject(a, id, b.reason); }
}

@Module({ controllers: [RewardsController], providers: [RewardsService] })
export class RewardsModule {}
