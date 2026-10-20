import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { and, desc, eq, ilike, lt, or } from 'drizzle-orm';
import { Database } from '../db/db';
import { auditLog } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CurrentActor, FINANCE, Roles } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

/** Penampil log aktivitas lengkap (hanya baca): pengurus. Pencarian teks pada pesan/pelaku dan halaman mundur dengan kursor waktu. */
@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Database) {}

  async list(tid: string, opts: { limit: number; before?: Date; q?: string }) {
    const term = opts.q?.trim().replace(/[%_]/g, '');
    const rows = await this.db.select().from(auditLog)
      .where(and(
        eq(auditLog.tenantId, tid),
        opts.before ? lt(auditLog.createdAt, opts.before) : undefined,
        term ? or(ilike(auditLog.message, `%${term}%`), ilike(auditLog.actorName, `%${term}%`)) : undefined,
      ))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(opts.limit + 1);
    const page = rows.slice(0, opts.limit);
    return {
      rows: page.map((r) => ({ id: r.id, at: r.createdAt, actor: r.actorName, message: r.message })),
      next: rows.length > opts.limit ? page[page.length - 1]!.createdAt : null,
    };
  }
}

@Controller('audit-log')
@Roles(...FINANCE)
class AuditController {
  constructor(private readonly svc: AuditService) {}
  @Get() list(@CurrentActor() a: Actor, @Query('limit') limit?: string, @Query('before') before?: string, @Query('q') q?: string) {
    const n = Math.min(200, Math.max(1, Math.floor(Number(limit ?? 50)) || 50));
    const b = before ? new Date(before) : undefined;
    return this.svc.list(a.tid, { limit: n, before: b && !Number.isNaN(b.getTime()) ? b : undefined, q });
  }
}

@Module({ controllers: [AuditController], providers: [AuditService] })
export class AuditModule {}
