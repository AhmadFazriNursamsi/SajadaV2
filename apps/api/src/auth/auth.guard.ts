import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import type { Role } from '@sajadah/shared';
import type { Database } from '../db/db';
import { members, users } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { ALLOW_PW_CHANGE, IS_PUBLIC, ROLES_KEY } from './auth.decorators';
import type { Actor } from './auth.types';

/** Guard global: verifikasi JWT Bearer lalu cek role dari @Roles (method menimpa class). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector, @InjectDb() private readonly db: Database) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    // Web memakai cookie HttpOnly (tidak terbaca JavaScript); mobile memakai header Bearer.
    const token = bearer ?? readSessionCookie(req.headers.cookie, cookieName(req.headers));
    if (!token) throw new UnauthorizedException('Token tidak ada');
    if (!bearer && !isSameOrigin(req)) throw new ForbiddenException('Permintaan lintas situs ditolak');
    let actor: Actor;
    try {
      actor = await this.jwt.verifyAsync<Actor>(token);
    } catch {
      throw new UnauthorizedException('Token tidak valid atau kedaluwarsa');
    }
    // Token yang akunnya sudah tidak ada (mis. database di-reset atau akun dihapus) → 401 agar klien kembali ke login.
    const [alive] = await this.db.select({ role: users.role, mustChange: users.mustChangePassword, depotId: users.depotId, memberOff: members.deactivatedAt }).from(users).leftJoin(members, eq(members.id, users.memberId)).where(and(eq(users.id, actor.sub), eq(users.tenantId, actor.tid)));
    if (!alive) throw new UnauthorizedException('Sesi tidak berlaku lagi; silakan masuk kembali');
    if (alive.memberOff) throw new UnauthorizedException('Akun Anda dinonaktifkan. Hubungi pengurus koperasi.');
    actor = { ...actor, role: alive.role, did: alive.depotId }; // peran selalu mengikuti data terbaru, bukan isi token
    if (alive.mustChange && !this.reflector.getAllAndOverride<boolean>(ALLOW_PW_CHANGE, targets)) {
      throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: 'PASSWORD_CHANGE_REQUIRED', message: 'Anda harus mengganti kata sandi terlebih dahulu.' });
    }
    req.actor = actor;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(actor.role)) throw new ForbiddenException('Peran tidak diizinkan untuk tindakan ini');
    return true;
  }

}

export const SESSION_COOKIE = 'sajadah_session';
export const MOBILE_WEB_COOKIE = 'sajadah_m';

/** Mobile versi web (di /m) memakai cookie sendiri agar tidak menimpa sesi web admin di browser yang sama. */
export const cookieName = (headers: Record<string, string | string[] | undefined>) => (headers['x-client'] === 'mobile-web' ? MOBILE_WEB_COOKIE : SESSION_COOKIE);

function readSessionCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** Perlindungan CSRF tambahan di atas SameSite=Strict: tindakan yang mengubah data harus berasal dari situs yang sama. */
function isSameOrigin(req: { method: string; headers: Record<string, string | string[] | undefined> }): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(String(origin)).host === String(req.headers['x-forwarded-host'] ?? req.headers.host); } catch { return false; }
}
