import { BadRequestException, Controller, Get, Body, Ip, Post, Req, Res, UnauthorizedException, Injectable, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { changePasswordSchema, forgotSchema, loginSchema } from '@sajadah/shared';
import type { Database } from '../db/db';
import { members, tenants, users } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { ZodPipe } from '../common/zod.pipe';
import { AllowPasswordChange, CurrentActor, Public } from './auth.decorators';
import { AuthGuard, cookieName } from './auth.guard';
import { LoginLimiter } from './login-limiter';
import { hashPassword, verifyPassword } from './password';
import type { Actor } from './auth.types';
import type { z } from 'zod';

export const jwtSecret = () => {
  const s = process.env.JWT_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET wajib diisi di production');
  return s ?? 'dev-only-secret-ubah-di-production';
};

@Injectable()
class AuthService {
  constructor(@InjectDb() private readonly db: Database, private readonly jwt: JwtService, private readonly limiter: LoginLimiter) {}

  /**
   * Login dengan username tanpa memilih tenant: cari semua akun dengan username itu lalu cocokkan kata sandi.
   * Hanya akun yang kata sandinya cocok yang dihitung, jadi tidak membocorkan tenant mana yang punya username tsb.
   * `tenant` (slug) tetap diterima bila username yang sama dipakai di beberapa koperasi.
   */
  async login(input: z.infer<typeof loginSchema>, ip: string) {
    this.limiter.check('login', ip, input.username);
    const rows = await this.db
      .select({ user: users, tenant: tenants, memberOff: members.deactivatedAt })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .leftJoin(members, eq(members.id, users.memberId))
      .where(input.tenant ? and(eq(users.username, input.username), eq(tenants.slug, input.tenant)) : eq(users.username, input.username));
    // Verifikasi selalu dijalankan (juga saat tidak ada akun) agar waktu respons tidak membocorkan keberadaan akun.
    const checks = await Promise.all((rows.length ? rows : [null]).map(async (r) => ({ r, ok: await verifyPassword(input.password, r?.user.passwordHash ?? '00:00') })));
    const matches = checks.filter((c) => c.ok && c.r).map((c) => c.r!);
    if (matches.length === 0) { this.limiter.fail('login', ip, input.username); throw new UnauthorizedException('Username atau kata sandi salah'); }
    if (matches.length > 1) throw new UnauthorizedException('Username terdaftar di lebih dari satu koperasi dengan kata sandi yang sama; hubungi pengurus');
    const { user, tenant, memberOff } = matches[0]!;
    if (memberOff) throw new UnauthorizedException('Akun Anda dinonaktifkan. Hubungi pengurus koperasi.'); // sandi benar, tetapi anggota sudah nonaktif
    this.limiter.success('login', ip, input.username);
    const actor: Actor = { sub: user.id, tid: tenant.id, role: user.role, name: user.name, mid: user.memberId };
    return { token: await this.jwt.signAsync(actor), user: { ...actor, username: user.username, mustChangePassword: user.mustChangePassword }, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } };
  }

  /**
   * Lupa kata sandi: tidak ada email/SMS, jadi permintaan ditandai agar pengurus melihatnya dan mengatur ulang sandi.
   * Respons selalu sama, ada atau tidaknya akun, supaya username tidak bisa ditebak.
   */
  async forgot(input: z.infer<typeof forgotSchema>, ip: string) {
    // Setiap permintaan dihitung (juga yang berhasil) agar tidak dipakai membanjiri daftar permintaan reset pengurus.
    this.limiter.check('forgot', ip, input.username);
    this.limiter.fail('forgot', ip, input.username);
    await this.db.update(users).set({ resetRequestedAt: new Date() }).where(eq(users.username, input.username));
    return { ok: true };
  }

  async me(actor: Actor) {
    // Nama diambil dari data terbaru (anggota bisa mengubah namanya di Profil), bukan dari isi token.
    const [u] = await this.db.select({ username: users.username, name: users.name, mustChangePassword: users.mustChangePassword }).from(users).where(eq(users.id, actor.sub));
    return { ...actor, name: u?.name ?? actor.name, username: u?.username ?? '', mustChangePassword: u?.mustChangePassword ?? false };
  }

  async changePassword(actor: Actor, input: z.infer<typeof changePasswordSchema>) {
    this.limiter.check('chpw', '-', actor.sub);
    const [u] = await this.db.select().from(users).where(eq(users.id, actor.sub));
    if (!u || !(await verifyPassword(input.current, u.passwordHash))) { this.limiter.fail('chpw', '-', actor.sub); throw new UnauthorizedException('Kata sandi sekarang salah'); }
    this.limiter.success('chpw', '-', actor.sub);
    if (input.current === input.next) throw new BadRequestException('Kata sandi baru harus berbeda dari yang sekarang');
    await this.db.update(users).set({ passwordHash: await hashPassword(input.next), mustChangePassword: false }).where(eq(users.id, actor.sub));
    return { ok: true };
  }
}

@Controller('auth')
class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('forgot')
  forgot(@Body(new ZodPipe(forgotSchema)) body: z.infer<typeof forgotSchema>, @Ip() ip: string) {
    return this.auth.forgot(body, ip);
  }

  @Public() @Post('login')
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Ip() ip: string, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const r = await this.auth.login(body, ip);
    // Web: sesi di cookie HttpOnly (tidak terbaca JavaScript, jadi tidak bisa dicuri lewat XSS). Mobile tetap memakai `token` dari isi respons.
    res.header('Set-Cookie', `${cookieName(req.headers)}=${encodeURIComponent(r.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${12 * 3600}${req.protocol === 'https' ? '; Secure' : ''}`);
    return r;
  }

  @Public() @Post('logout')
  logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    res.header('Set-Cookie', `${cookieName(req.headers)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    return { ok: true };
  }

  @Get('me') @AllowPasswordChange()
  me(@CurrentActor() actor: Actor) {
    return this.auth.me(actor);
  }

  @Post('change-password') @AllowPasswordChange()
  change(@CurrentActor() actor: Actor, @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    return this.auth.changePassword(actor, body);
  }
}

@Global()
@Module({
  imports: [JwtModule.registerAsync({ useFactory: () => ({ secret: jwtSecret(), signOptions: { expiresIn: '12h' } }) })],
  controllers: [AuthController],
  providers: [AuthService, LoginLimiter, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [JwtModule, LoginLimiter],
})
export class AuthModule {}
