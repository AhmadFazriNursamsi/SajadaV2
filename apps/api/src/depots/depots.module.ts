import { Body, Controller, Get, Injectable, Module, Delete, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { depotSchema, depotStaffSchema, depotUpdateSchema } from '@sajadah/shared';
import { Database } from '../db/db';
import { depotStock, depots, orders, users } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { ADMIN, CurrentActor, Roles, STAFF } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { z } from 'zod';
import { hashPassword } from '../auth/password';
import { AccountsModule, AccountsService, generatePassword } from '../accounts/accounts.module';

const staffUpdateSchema = z.object({ name: z.string().trim().min(2, 'Nama petugas minimal 2 karakter').max(80).optional(), depotId: z.string().uuid().optional() });

@Injectable()
export class DepotsService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService, private readonly accounts: AccountsService) {}

  /** Daftar toko + ringkasan stok, pesanan yang menunggu persetujuan, dan petugasnya. Petugas toko hanya melihat tokonya. */
  async list(a: Actor) {
    const [ds, stock, pending, staff] = await Promise.all([
      this.db.select().from(depots).where(and(eq(depots.tenantId, a.tid), a.did ? eq(depots.id, a.did) : undefined)).orderBy(asc(depots.createdAt), asc(depots.name)),
      this.db.select({ depotId: depotStock.depotId, physical: sql<number>`coalesce(sum(${depotStock.physical}), 0)`.mapWith(Number) }).from(depotStock).groupBy(depotStock.depotId),
      this.db.select({ depotId: orders.depotId, n: sql<number>`count(distinct ${orders.groupId})`.mapWith(Number) }).from(orders).where(and(eq(orders.tenantId, a.tid), eq(orders.cancelled, false), sql`${orders.approvedAt} is null`)).groupBy(orders.depotId),
      this.db.select({ depotId: users.depotId, name: users.name, username: users.username }).from(users).where(and(eq(users.tenantId, a.tid), eq(users.role, 'staff'))),
    ]);
    return ds.map((d) => ({
      ...d,
      physical: stock.find((s) => s.depotId === d.id)?.physical ?? 0,
      awaitingApproval: pending.find((p) => p.depotId === d.id)?.n ?? 0,
      staff: staff.filter((u) => u.depotId === d.id).map(({ name, username }) => ({ name, username })),
    }));
  }

  async create(a: Actor, input: { name: string; address?: string; lat?: number | null; lng?: number | null }) {
    return this.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: depots.id }).from(depots).where(and(eq(depots.tenantId, a.tid), eq(depots.name, input.name)));
      if (dup) throw new BusinessError('Nama toko sudah dipakai.');
      const [d] = await tx.insert(depots).values({ tenantId: a.tid, name: input.name, address: input.address || null, lat: input.lat ?? null, lng: input.lng ?? null }).returning();
      await this.core.audit(tx, a, `Toko ditambahkan: ${d!.name}`);
      return d!;
    });
  }

  async update(a: Actor, id: string, input: { name?: string; address?: string; lat?: number | null; lng?: number | null; active?: boolean }) {
    return this.db.transaction(async (tx) => {
      const [d] = await tx.select().from(depots).where(and(eq(depots.tenantId, a.tid), eq(depots.id, id))).for('update');
      if (!d) throw new BusinessError('Toko tidak ditemukan.');
      if (input.name && input.name !== d.name) {
        const [dup] = await tx.select({ id: depots.id }).from(depots).where(and(eq(depots.tenantId, a.tid), eq(depots.name, input.name)));
        if (dup) throw new BusinessError('Nama toko sudah dipakai.');
      }
      if (input.active === false) {
        const [open] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(orders).where(and(eq(orders.depotId, id), eq(orders.cancelled, false), eq(orders.shipped, false)));
        if (open!.n > 0) throw new BusinessError(`Toko masih punya ${open!.n} pesanan yang belum dikirim; selesaikan atau batalkan dulu.`);
      }
      const [u] = await tx.update(depots).set({ ...(input.name ? { name: input.name } : {}), ...(input.address !== undefined ? { address: input.address || null } : {}), ...(input.active !== undefined ? { active: input.active } : {}), ...('lat' in input ? { lat: input.lat ?? null, lng: input.lng ?? null } : {}) }).where(eq(depots.id, id)).returning();
      await this.core.audit(tx, a, `Toko ${d.name} diubah${input.active === undefined ? '' : input.active ? ' (diaktifkan)' : ' (dinonaktifkan)'}`);
      return u!;
    });
  }

  async addStaff(a: Actor, depotId: string, name: string) {
    const [d] = await this.db.select().from(depots).where(and(eq(depots.tenantId, a.tid), eq(depots.id, depotId)));
    if (!d) throw new BusinessError('Toko tidak ditemukan.');
    return this.accounts.createStaff(a, depotId, name);
  }

  /** Semua akun petugas toko beserta tokonya. */
  async staffList(a: Actor) {
    const rows = await this.db.select({ id: users.id, name: users.name, username: users.username, depotId: users.depotId, depotName: depots.name, mustChangePassword: users.mustChangePassword, resetRequestedAt: users.resetRequestedAt, createdAt: users.createdAt })
      .from(users).leftJoin(depots, eq(depots.id, users.depotId)).where(and(eq(users.tenantId, a.tid), eq(users.role, 'staff'), a.did ? eq(users.depotId, a.did) : undefined)).orderBy(asc(users.name));
    return rows;
  }

  private async staffOf(tx: Database, a: Actor, id: string) {
    const [u] = await tx.select().from(users).where(and(eq(users.tenantId, a.tid), eq(users.id, id), eq(users.role, 'staff'))).for('update');
    if (!u) throw new BusinessError('Petugas tidak ditemukan.');
    return u;
  }

  async staffUpdate(a: Actor, id: string, input: { name?: string; depotId?: string }) {
    return this.db.transaction(async (tx) => {
      const u = await this.staffOf(tx, a, id);
      if (input.depotId) {
        const [d] = await tx.select({ id: depots.id }).from(depots).where(and(eq(depots.tenantId, a.tid), eq(depots.id, input.depotId)));
        if (!d) throw new BusinessError('Toko tidak ditemukan.');
      }
      await tx.update(users).set({ ...(input.name ? { name: input.name } : {}), ...(input.depotId ? { depotId: input.depotId } : {}) }).where(eq(users.id, id));
      await this.core.audit(tx, a, `Petugas ${u.username} diperbarui`);
      return { ok: true };
    });
  }

  async staffReset(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const u = await this.staffOf(tx, a, id);
      const password = generatePassword();
      await tx.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true, resetRequestedAt: null }).where(eq(users.id, id));
      await this.core.audit(tx, a, `Kata sandi petugas ${u.username} diatur ulang`);
      return { username: u.username, password };
    });
  }

  /** Hapus akun petugas; sesinya langsung tidak berlaku (guard memeriksa akun di setiap permintaan). */
  async staffRemove(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const u = await this.staffOf(tx, a, id);
      await tx.delete(users).where(eq(users.id, id));
      await this.core.audit(tx, a, `Akun petugas ${u.username} (${u.name}) dihapus`);
      return { ok: true };
    });
  }
}

@Controller('depots')
@Roles(...STAFF)
class DepotsController {
  constructor(private readonly svc: DepotsService) {}
  @Get() list(@CurrentActor() a: Actor) { return this.svc.list(a); }
  @Post() @Roles(...ADMIN) create(@CurrentActor() a: Actor, @Body(new ZodPipe(depotSchema)) b: any) { return this.svc.create(a, b); }
  @Patch(':id') @Roles(...ADMIN) update(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(depotUpdateSchema)) b: any) { return this.svc.update(a, id, b); }
  @Get('staff') staffList(@CurrentActor() a: Actor) { return this.svc.staffList(a); }
  @Patch('staff/:id') @Roles(...ADMIN) staffUpdate(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(staffUpdateSchema)) b: any) { return this.svc.staffUpdate(a, id, b); }
  @Post('staff/:id/reset') @Roles(...ADMIN) staffReset(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.staffReset(a, id); }
  @Delete('staff/:id') @Roles(...ADMIN) staffRemove(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.staffRemove(a, id); }
  @Post(':id/staff') @Roles(...ADMIN) staff(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(depotStaffSchema)) b: any) { return this.svc.addStaff(a, id, b.name); }
}

@Module({ imports: [AccountsModule], controllers: [DepotsController], providers: [DepotsService], exports: [DepotsService] })
export class DepotsModule {}
