import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { createInvestorSchema, profitReportSchema, scenarioSchema, splitProfit, type ProfitReportInput } from '@sajadah/shared';
import { Database } from '../db/db';
import { fundingAllocations, investors, members, profitReports } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError, isUniqueViolation, parse } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { ADMIN, CurrentActor, FINANCE, Roles, STAFF } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

@Injectable()
export class ReportsService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) {}

  async list(tid: string) {
    const rows = await this.db
      .select({ r: profitReports, member: members.name })
      .from(profitReports)
      .innerJoin(members, eq(members.id, profitReports.memberId))
      .where(eq(profitReports.tenantId, tid))
      .orderBy(desc(profitReports.no));
    return rows.map(({ r, member }) => ({ ...r, member }));
  }

  async create(a: Actor, input: ProfitReportInput) {
    return this.db.transaction(async (tx) => {
      const [m] = await tx.select().from(members).where(and(eq(members.tenantId, a.tid), eq(members.id, input.memberId))).for('update');
      if (!m) throw new BusinessError('Anggota tidak ditemukan');
      if (!m.active) throw new BusinessError('Laporan hanya untuk anggota aktif.');
      if (m.activatedAt && input.period < m.activatedAt.slice(0, 7)) throw new BusinessError(`Periode tidak boleh sebelum aktivasi penyertaan (${m.activatedAt.slice(0, 7)}).`);
      const [draft] = await tx.select({ id: profitReports.id }).from(profitReports).where(and(eq(profitReports.memberId, m.id), eq(profitReports.status, 'draft')));
      if (draft) throw new BusinessError('Selesaikan draf sebelumnya terlebih dahulu.');
      const no = await this.core.docNo(tx, a.tid, 'LB');
      const [r] = await tx.insert(profitReports).values({ tenantId: a.tid, no, memberId: m.id, period: input.period, ref: input.ref, revenue: input.revenue, cost: input.cost, profit: input.revenue - input.cost, createdBy: a.sub }).returning();
      await this.core.audit(tx, a, `Draf laporan ${no} disimpan untuk ${m.name}`);
      return r!;
    });
  }

  /** Settle mengubah sisa penyertaan & laba pasca pemulihan; draf tidak pernah masuk hasil investor. */
  async settle(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(profitReports).where(and(eq(profitReports.tenantId, a.tid), eq(profitReports.id, id))).for('update');
      if (!r) throw new BusinessError('Laporan tidak ditemukan');
      if (r.status !== 'draft') throw new BusinessError('Laporan sudah settled.');
      const [m] = await tx.select().from(members).where(eq(members.id, r.memberId)).for('update');
      const sp = splitProfit(m!.remaining, m!.cumulative, r.profit);
      await tx.update(members).set({ remaining: sp.remainingAfter, cumulative: sp.cumulativeAfter }).where(eq(members.id, m!.id));
      await tx.update(profitReports).set({ status: 'settled', memberShare: sp.member, investorShare: sp.investor, settledBy: a.sub, settledAt: new Date() }).where(eq(profitReports.id, id));
      await this.core.audit(tx, a, `Settled ${r.no}: anggota ${sp.member.toLocaleString('id-ID')}, investor ${sp.investor.toLocaleString('id-ID')}`);
      return sp;
    });
  }

  scenario(q: unknown) {
    const v = parse(scenarioSchema, q);
    return splitProfit(v.remaining, v.cumulative, v.profit);
  }

  /** Master investor + alokasi penyertaan per anggota (nilai nyata dari tabel alokasi). */
  async funding(tid: string) {
    const [inv, ms, allocs] = await Promise.all([
      this.db.select().from(investors).where(eq(investors.tenantId, tid)).orderBy(investors.code),
      this.db.select().from(members).where(eq(members.tenantId, tid)),
      this.db.select().from(fundingAllocations).where(eq(fundingAllocations.tenantId, tid)),
    ]);
    const code = new Map(inv.map((i) => [i.id, i.code]));
    return {
      investors: inv.map((i) => ({ ...i, allocated: allocs.filter((x) => x.investorId === i.id).reduce((n, x) => n + x.amount, 0), members: allocs.filter((x) => x.investorId === i.id).length })),
      members: ms.map((m) => ({
        id: m.id, name: m.name, funded: m.funded, fundingRef: m.fundingRef, fundedAt: m.fundedAt,
        total: allocs.filter((x) => x.memberId === m.id).reduce((n, x) => n + x.amount, 0),
        perInvestor: allocs.filter((x) => x.memberId === m.id).map((x) => ({ code: code.get(x.investorId) ?? '?', amount: x.amount })),
      })),
    };
  }

  async createInvestor(a: Actor, input: { code: string; name: string; sharePercent: number }) {
    try {
      return await this.db.transaction(async (tx) => {
        const [i] = await tx.insert(investors).values({ tenantId: a.tid, ...input }).returning();
        await this.core.audit(tx, a, `Investor ditambahkan: ${input.name} (${input.code}, porsi ${input.sharePercent}%)`);
        return i!;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BusinessError(`Kode investor ${input.code} sudah dipakai.`);
      throw e;
    }
  }

  async removeInvestor(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const [i] = await tx.select().from(investors).where(and(eq(investors.tenantId, a.tid), eq(investors.id, id)));
      if (!i) throw new BusinessError('Investor tidak ditemukan.');
      const [used] = await tx.select({ id: fundingAllocations.id }).from(fundingAllocations).where(eq(fundingAllocations.investorId, id)).limit(1);
      if (used) throw new BusinessError('Investor sudah memiliki alokasi penyertaan dan tidak dapat dihapus.');
      await tx.delete(investors).where(eq(investors.id, id));
      await this.core.audit(tx, a, `Investor dihapus: ${i.name}`);
      return { ok: true };
    });
  }
}

@Controller()
@Roles(...ADMIN)
class ReportsController {
  constructor(private readonly svc: ReportsService) {}
  @Get('profit-reports') list(@CurrentActor() a: Actor) { return this.svc.list(a.tid); }
  @Post('profit-reports') @Roles(...FINANCE) create(@CurrentActor() a: Actor, @Body(new ZodPipe(profitReportSchema)) b: ProfitReportInput) { return this.svc.create(a, b); }
  @Post('profit-reports/:id/settle') @Roles(...FINANCE) settle(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.settle(a, id); }
  @Get('investors/scenario') scenario(@Query() q: Record<string, string>) { return this.svc.scenario(q); }
  @Get('investors/funding') funding(@CurrentActor() a: Actor) { return this.svc.funding(a.tid); }
  @Post('investors') @Roles(...ADMIN) createInvestor(@CurrentActor() a: Actor, @Body(new ZodPipe(createInvestorSchema)) b: any) { return this.svc.createInvestor(a, b); }
  @Delete('investors/:id') @Roles(...ADMIN) removeInvestor(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.removeInvestor(a, id); }
}

@Module({ controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
