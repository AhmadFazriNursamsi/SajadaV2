import { randomInt } from 'node:crypto';
import { Controller, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { and, eq, like } from 'drizzle-orm';
import { Database } from '../db/db';
import { members, users } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { ADMIN, CurrentActor, Roles } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { hashPassword } from '../auth/password';

export interface NewAccount { username: string; password: string }

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // tanpa 0/O/1/l/I agar mudah dibaca

/** Kata sandi acak 10 karakter (CSPRNG), selalu memuat huruf besar, huruf kecil, dan angka. */
export function generatePassword(length = 10): string {
  for (;;) {
    const pw = Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)) return pw;
  }
}

/** "Budi Santoso" → "budi.santoso" (tanpa aksen, huruf kecil, pemisah titik). */
export function usernameBase(name: string): string {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 28).replace(/\.+$/, '');
  return base || 'anggota';
}

@Injectable()
export class AccountsService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) {}

  /** Username unik per tenant: dasar dari nama, lalu angka 2, 3, … bila sudah dipakai. */
  private async uniqueUsername(q: Database, tid: string, name: string): Promise<string> {
    const base = usernameBase(name);
    const rows = await q.select({ u: users.username }).from(users).where(and(eq(users.tenantId, tid), like(users.username, `${base}%`)));
    const taken = new Set(rows.map((r) => r.u));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  }

  /** Buat akun anggota di dalam transaksi pemanggil. Kata sandi dikembalikan sekali; hanya hash yang disimpan. */
  async createInTx(tx: Database, a: Actor, member: { id: string; name: string }): Promise<NewAccount> {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.memberId, member.id));
    if (existing) throw new BusinessError('Anggota ini sudah memiliki akun login.');
    const username = await this.uniqueUsername(tx, a.tid, member.name);
    const password = generatePassword();
    await tx.insert(users).values({ tenantId: a.tid, username, name: member.name, passwordHash: await hashPassword(password), role: 'member', memberId: member.id, mustChangePassword: true });
    await this.core.audit(tx, a, `Akun login dibuat untuk ${member.name} (username ${username})`);
    return { username, password };
  }

  /** Akun petugas toko: username dari nama, sandi acak, wajib diganti saat login pertama. */
  async createStaff(a: Actor, depotId: string, name: string): Promise<NewAccount> {
    return this.db.transaction(async (tx) => {
      const username = await this.uniqueUsername(tx, a.tid, name);
      const password = generatePassword();
      await tx.insert(users).values({ tenantId: a.tid, username, name, passwordHash: await hashPassword(password), role: 'staff', depotId, mustChangePassword: true });
      await this.core.audit(tx, a, `Akun petugas dibuat untuk ${name} (username ${username})`);
      return { username, password };
    });
  }

  async createForMember(a: Actor, memberId: string): Promise<NewAccount> {
    return this.db.transaction(async (tx) => {
      const [m] = await tx.select({ id: members.id, name: members.name }).from(members).where(and(eq(members.tenantId, a.tid), eq(members.id, memberId))).for('update');
      if (!m) throw new BusinessError('Anggota tidak ditemukan.');
      return this.createInTx(tx, a, m);
    });
  }

  /** Atur ulang kata sandi: kata sandi baru acak, wajib diganti saat login berikutnya. */
  async resetForMember(a: Actor, memberId: string): Promise<NewAccount> {
    return this.db.transaction(async (tx) => {
      const [u] = await tx.select().from(users).where(and(eq(users.tenantId, a.tid), eq(users.memberId, memberId))).for('update');
      if (!u) throw new BusinessError('Anggota ini belum memiliki akun login.');
      const password = generatePassword();
      await tx.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true, resetRequestedAt: null }).where(eq(users.id, u.id));
      await this.core.audit(tx, a, `Kata sandi diatur ulang untuk ${u.name} (username ${u.username})`);
      return { username: u.username, password };
    });
  }
}

@Controller('members')
@Roles(...ADMIN)
class AccountsController {
  constructor(private readonly svc: AccountsService) {}
  @Post(':id/account') create(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.createForMember(a, id); }
  @Post(':id/account/reset') reset(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.resetForMember(a, id); }
}

@Module({ controllers: [AccountsController], providers: [AccountsService], exports: [AccountsService] })
export class AccountsModule {}
