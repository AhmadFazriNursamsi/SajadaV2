import { Body, Controller, ForbiddenException, Get, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Post } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Database } from '../db/db';
import { notifications, pushTokens } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

/** Harus sama dengan CHANNEL_ID di aplikasi (apps/mobile/src/push.ts). */
const CHANNEL_ID = 'sajadah-v2';
const readSchema = z.object({ ids: z.array(z.string().uuid()).max(200).optional() });
const tokenSchema = z.object({ token: z.string().regex(/^(Expo|Exponent)PushToken\[[^\]]{8,}\]$/, 'Token push tidak valid') });

@Injectable()
export class NotificationsService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** Pemilik kotak masuk: anggota (lewat memberId) atau petugas (lewat userId). */
  private owner(a: Actor) {
    if (a.mid) return { member: a.mid, user: null };
    if (a.role === 'staff') return { member: null, user: a.sub };
    throw new ForbiddenException('Akun ini tidak memiliki notifikasi');
  }
  private mine(a: Actor) {
    const o = this.owner(a);
    return o.member ? eq(notifications.memberId, o.member) : eq(notifications.userId, o.user!);
  }

  async list(a: Actor) {
    const mine = this.mine(a);
    const rows = await this.db.select().from(notifications).where(mine).orderBy(desc(notifications.createdAt)).limit(200);
    const unread = await this.db.select({ tab: notifications.tab, n: sql<number>`count(*)`.mapWith(Number) }).from(notifications).where(and(mine, isNull(notifications.readAt))).groupBy(notifications.tab);
    return {
      items: rows.map((n) => ({ id: n.id, tab: n.tab, cat: n.cat, title: n.title, body: n.body, route: n.route, refId: n.refId, read: !!n.readAt, at: n.createdAt })),
      unread: { info: unread.find((u) => u.tab === 'info')?.n ?? 0, trx: unread.find((u) => u.tab === 'trx')?.n ?? 0 },
    };
  }

  /** Tandai terbaca: `ids` yang diberikan, atau semuanya bila `ids` kosong. */
  async markRead(a: Actor, ids?: string[]) {
    const where = and(this.mine(a), isNull(notifications.readAt), ids?.length ? inArray(notifications.id, ids) : undefined);
    await this.db.update(notifications).set({ readAt: new Date() }).where(where);
    return { ok: true };
  }

  async saveToken(a: Actor, token: string) {
    const o = this.owner(a);
    await this.db.insert(pushTokens).values({ tenantId: a.tid, memberId: o.member, userId: o.user, token }).onConflictDoUpdate({ target: pushTokens.token, set: { memberId: o.member, userId: o.user, tenantId: a.tid } });
    return { ok: true };
  }
}

/**
 * Mengirim notifikasi baru ke HP lewat layanan push Expo. Berjalan berkala (bukan di dalam transaksi) sehingga pesan hanya
 * terkirim untuk kejadian yang benar-benar tersimpan, dan gagal kirim tidak menggagalkan pesanan.
 */
@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Push');
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  constructor(@InjectDb() private readonly db: Database) {}

  onModuleInit() {
    if (process.env.VITEST || process.env.PUSH_DISABLED === 'true') return;
    this.timer = setInterval(() => void this.flush(), 5000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async flush() {
    if (this.busy) return;
    this.busy = true;
    try {
      const fresh = await this.db.select().from(notifications).where(isNull(notifications.pushedAt)).orderBy(notifications.createdAt).limit(50);
      if (!fresh.length) return;
      const mids = [...new Set(fresh.flatMap((n) => (n.memberId ? [n.memberId] : [])))], uids = [...new Set(fresh.flatMap((n) => (n.userId ? [n.userId] : [])))];
      const tokens = await this.db.select().from(pushTokens).where(or(mids.length ? inArray(pushTokens.memberId, mids) : undefined, uids.length ? inArray(pushTokens.userId, uids) : undefined));
      const messages = fresh.flatMap((n) => tokens.filter((t) => (n.memberId ? t.memberId === n.memberId : t.userId === n.userId)).map((t) => ({ to: t.token, title: n.title, body: n.body, sound: 'default', channelId: CHANNEL_ID, data: { route: n.route, refId: n.refId, id: n.id } })));
      if (messages.length) {
        const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(messages) });
        if (!res.ok) { this.log.warn(`Push gagal (${res.status}); dicoba lagi.`); return; }
        const out = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
        // Token yang sudah tidak terdaftar dibuang.
        const dead = (out.data ?? []).flatMap((d, i) => (d.details?.error === 'DeviceNotRegistered' ? [messages[i]!.to] : []));
        if (dead.length) await this.db.delete(pushTokens).where(inArray(pushTokens.token, dead));
      }
      await this.db.update(notifications).set({ pushedAt: new Date() }).where(inArray(notifications.id, fresh.map((n) => n.id)));
    } catch (e) {
      this.log.warn(`Push dilewati: ${(e as Error).message}`);
    } finally { this.busy = false; }
  }
}

@Controller()
class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}
  @Get('me/notifications') @Roles('member', 'staff') list(@CurrentActor() a: Actor) { return this.svc.list(a); }
  @Post('me/notifications/read') @Roles('member', 'staff') read(@CurrentActor() a: Actor, @Body(new ZodPipe(readSchema)) b: z.infer<typeof readSchema>) { return this.svc.markRead(a, b.ids); }
  @Post('me/push-token') @Roles('member', 'staff') token(@CurrentActor() a: Actor, @Body(new ZodPipe(tokenSchema)) b: z.infer<typeof tokenSchema>) { return this.svc.saveToken(a, b.token); }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService, PushService] })
export class NotificationsModule {}
