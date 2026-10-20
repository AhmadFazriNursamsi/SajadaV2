import { Body, Controller, Get, Injectable, Module, Put } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { COMMISSION_RATES, commissionPlanSchema } from '@sajadah/shared';
import { Database } from '../db/db';
import { commissionPlans } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { ADMIN, CurrentActor, FINANCE, Roles } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

/**
 * Tarif komisi per tenant dengan riwayat perubahan. Tarif baru hanya berlaku untuk pesanan yang dibuat sesudahnya:
 * setiap pesanan membekukan tarif saat dibuat, sama seperti rantai sponsornya.
 */
@Injectable()
export class CommissionPlanService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) {}

  async current(tid: string) {
    const [p] = await this.db.select().from(commissionPlans).where(eq(commissionPlans.tenantId, tid)).orderBy(desc(commissionPlans.createdAt)).limit(1);
    return p
      ? { rates: p.rates, since: p.createdAt, by: p.createdByName, reason: p.reason }
      : { rates: [...COMMISSION_RATES], since: null, by: null, reason: 'Tarif bawaan' };
  }

  history(tid: string) {
    return this.db.select().from(commissionPlans).where(eq(commissionPlans.tenantId, tid)).orderBy(desc(commissionPlans.createdAt)).limit(100);
  }

  async update(a: Actor, input: { rates: number[]; reason: string }) {
    return this.db.transaction(async (tx) => {
      const cur = await this.core.currentRates(tx, a.tid);
      if (cur.length === input.rates.length && cur.every((r, i) => r === input.rates[i])) throw new BusinessError('Tarif sama dengan yang berlaku sekarang; tidak ada yang diubah.');
      const [row] = await tx.insert(commissionPlans).values({ tenantId: a.tid, rates: input.rates, reason: input.reason, createdById: a.sub, createdByName: a.name }).returning();
      await this.core.audit(tx, a, `Tarif komisi diubah ${cur.join('/')} → ${input.rates.join('/')}% (hanya untuk pesanan baru): ${input.reason}`);
      return { rates: row!.rates, since: row!.createdAt, by: row!.createdByName, reason: row!.reason };
    });
  }
}

@Controller('commission-plan')
class CommissionPlanController {
  constructor(private readonly svc: CommissionPlanService) {}
  /** Semua peran boleh melihat tarif berlaku (anggota membacanya di halaman Skema komisi). */
  @Get() current(@CurrentActor() a: Actor) { return this.svc.current(a.tid); }
  @Get('history') @Roles(...FINANCE) history(@CurrentActor() a: Actor) { return this.svc.history(a.tid); }
  @Put() @Roles(...ADMIN) update(@CurrentActor() a: Actor, @Body(new ZodPipe(commissionPlanSchema)) b: { rates: number[]; reason: string }) { return this.svc.update(a, b); }
}

@Module({ controllers: [CommissionPlanController], providers: [CommissionPlanService], exports: [CommissionPlanService] })
export class CommissionPlanModule {}
