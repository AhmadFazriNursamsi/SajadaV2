import { mkdirSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Body, Controller, ForbiddenException, Get, Header, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { productImageSchema, rejectSchema, voucherFulfillSchema, voucherSchema, voucherUpdateSchema } from '@sajadah/shared';
import { Database } from '../db/db';
import { coinEntries, members, voucherRedemptions, vouchers } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { EXT, MAX_IMAGE_BYTES, TYPE, looksLike } from '../common/image-store';
import { ADMIN, CurrentActor, Public, Roles } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';

const FILE = /^[0-9a-f-]{36}-\d+\.(jpg|png|webp)$/;
const dir = () => process.env.VOUCHER_IMAGE_DIR ?? join(process.cwd(), '.data/vouchers');
const imageUrl = (f: string | null) => (f ? `/api/vouchers/image/${f}` : null);

/**
 * Koin anggota: tiap produk punya koin per satuan, dikreditkan saat belanja sendiri diterima (OrdersService).
 * Koin ditukar dengan voucher (umroh, belanja, dll). Koin dipotong saat menukar; pengurus menerbitkan voucher (isi kode)
 * atau menolak (koin dan stok kembali).
 */
@Injectable()
export class CoinsService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService) { mkdirSync(dir(), { recursive: true }); }

  async mine(a: Actor) {
    if (!a.mid) throw new ForbiddenException('Akun tidak terhubung ke anggota');
    const [m] = await this.db.select({ coinBalance: members.coinBalance }).from(members).where(and(eq(members.id, a.mid), eq(members.tenantId, a.tid)));
    const [entries, reds, vs] = await Promise.all([
      this.db.select().from(coinEntries).where(eq(coinEntries.memberId, a.mid)).orderBy(desc(coinEntries.createdAt)).limit(50),
      this.db.select().from(voucherRedemptions).where(eq(voucherRedemptions.memberId, a.mid)).orderBy(desc(voucherRedemptions.createdAt)).limit(30),
      this.db.select().from(vouchers).where(and(eq(vouchers.tenantId, a.tid), eq(vouchers.active, true))).orderBy(asc(vouchers.coinCost)),
    ]);
    return {
      balance: m?.coinBalance ?? 0,
      vouchers: vs.map((v) => ({ id: v.id, name: v.name, description: v.description, coinCost: v.coinCost, stock: v.stock, imageUrl: imageUrl(v.image) })),
      entries: entries.map((e) => ({ id: e.id, kind: e.kind, amount: e.amount, refNo: e.refNo, note: e.note, createdAt: e.createdAt })),
      redemptions: reds.map((r) => ({ id: r.id, no: r.no, voucherName: r.voucherName, coins: r.coins, status: r.status, code: r.code, reason: r.reason, createdAt: r.createdAt })),
    };
  }

  /** Tukar koin dengan voucher: koin dipotong dan stok berkurang langsung; menunggu diterbitkan pengurus. */
  async redeem(a: Actor, voucherId: string) {
    return this.db.transaction(async (tx) => {
      if (!a.mid) throw new ForbiddenException('Akun tidak terhubung ke anggota');
      const [m] = await tx.select().from(members).where(and(eq(members.id, a.mid), eq(members.tenantId, a.tid))).for('update');
      if (!m) throw new ForbiddenException('Anggota tidak ditemukan');
      if (m.deactivatedAt) throw new BusinessError('Anggota sudah nonaktif.');
      const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.tenantId, a.tid), eq(vouchers.id, voucherId))).for('update');
      if (!v || !v.active) throw new BusinessError('Voucher tidak tersedia.');
      if (v.stock < 1) throw new BusinessError('Stok voucher habis.');
      if (m.coinBalance < v.coinCost) throw new BusinessError(`Koin belum cukup: butuh ${v.coinCost}, kamu punya ${m.coinBalance}.`);
      const no = await this.core.docNo(tx, a.tid, 'VC');
      await tx.update(members).set({ coinBalance: m.coinBalance - v.coinCost }).where(eq(members.id, m.id));
      await tx.update(vouchers).set({ stock: v.stock - 1 }).where(eq(vouchers.id, v.id));
      const [r] = await tx.insert(voucherRedemptions).values({ tenantId: a.tid, memberId: m.id, voucherId: v.id, no, voucherName: v.name, coins: v.coinCost }).returning();
      await tx.insert(coinEntries).values({ tenantId: a.tid, memberId: m.id, kind: 'redeem', amount: -v.coinCost, refNo: no, note: `Tukar voucher ${v.name}` });
      await this.core.audit(tx, a, `${no}: ${m.name} menukar ${v.coinCost} koin dengan voucher ${v.name}`);
      return { id: r!.id, no, status: r!.status, balance: m.coinBalance - v.coinCost };
    });
  }

  // --- pengurus ---
  async listVouchers(a: Actor) {
    const rows = await this.db.select().from(vouchers).where(eq(vouchers.tenantId, a.tid)).orderBy(asc(vouchers.coinCost), asc(vouchers.name));
    return rows.map((v) => ({ ...v, imageUrl: imageUrl(v.image) }));
  }

  async uploadImage(a: Actor, id: string, input: z.infer<typeof productImageSchema>) {
    const bytes = Buffer.from(input.data, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new BusinessError('Foto terlalu besar (maksimal 1 MB).');
    if (!looksLike(input.contentType, bytes)) throw new BusinessError('Isi berkas bukan gambar yang valid.');
    const [v] = await this.db.select().from(vouchers).where(and(eq(vouchers.tenantId, a.tid), eq(vouchers.id, id)));
    if (!v) throw new BusinessError('Voucher tidak ditemukan.');
    const file = `${id}-${Date.now()}.${EXT[input.contentType]}`;
    mkdirSync(dir(), { recursive: true });
    await writeFile(join(dir(), file), bytes);
    await this.db.transaction(async (tx) => {
      await tx.update(vouchers).set({ image: file }).where(eq(vouchers.id, id));
      await this.core.audit(tx, a, `Foto voucher ${v.name} diganti`);
    });
    if (v.image && FILE.test(v.image)) await unlink(join(dir(), v.image)).catch(() => undefined);
    return { imageUrl: imageUrl(file) };
  }

  async readImage(file: string) {
    if (!FILE.test(file)) throw new NotFoundException();
    const bytes = await readFile(join(dir(), file)).catch(() => null);
    if (!bytes) throw new NotFoundException();
    return { bytes, type: TYPE[file.split('.').pop() as keyof typeof TYPE] };
  }

  async createVoucher(a: Actor, input: z.infer<typeof voucherSchema>) {
    return this.db.transaction(async (tx) => {
      const [v] = await tx.insert(vouchers).values({ tenantId: a.tid, name: input.name, description: input.description || null, coinCost: input.coinCost, stock: input.stock, active: input.active ?? true }).returning();
      await this.core.audit(tx, a, `Voucher baru ${v!.name}: ${v!.coinCost} koin, stok ${v!.stock}`);
      return v!;
    });
  }

  async updateVoucher(a: Actor, id: string, input: z.infer<typeof voucherUpdateSchema>) {
    return this.db.transaction(async (tx) => {
      const [v] = await tx.select().from(vouchers).where(and(eq(vouchers.tenantId, a.tid), eq(vouchers.id, id))).for('update');
      if (!v) throw new BusinessError('Voucher tidak ditemukan.');
      const next = { name: input.name ?? v.name, description: input.description === undefined ? v.description : input.description || null, coinCost: input.coinCost ?? v.coinCost, stock: input.stock ?? v.stock, active: input.active ?? v.active };
      if (next.name === v.name && next.description === v.description && next.coinCost === v.coinCost && next.stock === v.stock && next.active === v.active) throw new BusinessError('Tidak ada yang diubah.');
      const [u] = await tx.update(vouchers).set(next).where(eq(vouchers.id, id)).returning();
      await this.core.audit(tx, a, `Voucher ${v.name} diubah: ${next.coinCost} koin, stok ${next.stock}, ${next.active ? 'aktif' : 'nonaktif'}`);
      return u!;
    });
  }

  async listRedemptions(a: Actor) {
    const rows = await this.db.select({ r: voucherRedemptions, memberName: members.name, memberNo: members.memberNo }).from(voucherRedemptions)
      .innerJoin(members, eq(members.id, voucherRedemptions.memberId)).where(eq(voucherRedemptions.tenantId, a.tid)).orderBy(desc(voucherRedemptions.createdAt));
    return rows.map(({ r, memberName, memberNo }) => ({ id: r.id, no: r.no, memberName, memberNo, voucherName: r.voucherName, coins: r.coins, status: r.status, code: r.code, reason: r.reason, decidedAt: r.decidedAt, decidedByName: r.decidedByName, createdAt: r.createdAt }));
  }

  private async decide(a: Actor, id: string, to: 'fulfilled' | 'rejected', extra: { code?: string; reason?: string }) {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(voucherRedemptions).where(and(eq(voucherRedemptions.tenantId, a.tid), eq(voucherRedemptions.id, id))).for('update');
      if (!r) throw new BusinessError('Penukaran tidak ditemukan.');
      if (r.status !== 'pending') throw new BusinessError('Penukaran ini sudah diputuskan.');
      await tx.update(voucherRedemptions).set({ status: to, code: extra.code || null, reason: extra.reason ?? null, decidedAt: new Date(), decidedByName: a.name }).where(eq(voucherRedemptions.id, id));
      if (to === 'rejected') {
        const [m] = await tx.select().from(members).where(eq(members.id, r.memberId)).for('update');
        await tx.update(members).set({ coinBalance: m!.coinBalance + r.coins }).where(eq(members.id, m!.id));
        await tx.update(vouchers).set({ stock: sql`${vouchers.stock} + 1` }).where(eq(vouchers.id, r.voucherId));
        await tx.insert(coinEntries).values({ tenantId: a.tid, memberId: r.memberId, kind: 'refund', amount: r.coins, refNo: r.no, note: `Penukaran ditolak: ${extra.reason}` });
      }
      await this.core.notify(tx, { tenantId: a.tid, memberId: r.memberId, tab: 'info', cat: 'Koin', title: to === 'fulfilled' ? 'Voucher diterbitkan' : 'Penukaran voucher ditolak', body: to === 'fulfilled' ? `${r.no}: ${r.voucherName}${extra.code ? `, kode ${extra.code}` : ''}.` : `${r.no}: ${r.voucherName} ditolak (${extra.reason}). Koin dikembalikan.`, route: 'coins' });
      await this.core.audit(tx, a, to === 'fulfilled' ? `${r.no}: voucher ${r.voucherName} diterbitkan${extra.code ? ` (kode ${extra.code})` : ''}` : `${r.no}: penukaran voucher ${r.voucherName} ditolak (${extra.reason}); koin dikembalikan`);
      return { ok: true };
    });
  }
  fulfill(a: Actor, id: string, code?: string) { return this.decide(a, id, 'fulfilled', { code }); }
  reject(a: Actor, id: string, reason: string) { return this.decide(a, id, 'rejected', { reason }); }
}

@Controller()
class CoinsController {
  constructor(private readonly svc: CoinsService) {}
  @Get('me/coins') @Roles('member') mine(@CurrentActor() a: Actor) { return this.svc.mine(a); }
  @Post('me/vouchers/:id/redeem') @Roles('member') redeem(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.redeem(a, id); }

  @Get('vouchers') @Roles(...ADMIN) vouchers(@CurrentActor() a: Actor) { return this.svc.listVouchers(a); }
  @Post('vouchers') @Roles(...ADMIN) create(@CurrentActor() a: Actor, @Body(new ZodPipe(voucherSchema)) b: z.infer<typeof voucherSchema>) { return this.svc.createVoucher(a, b); }
  @Patch('vouchers/:id') @Roles(...ADMIN) update(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(voucherUpdateSchema)) b: z.infer<typeof voucherUpdateSchema>) { return this.svc.updateVoucher(a, id, b); }
  @Post('vouchers/:id/image') @Roles(...ADMIN) image(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(productImageSchema)) b: z.infer<typeof productImageSchema>) { return this.svc.uploadImage(a, id, b); }

  /** Publik (nama berkas memuat UUID + waktu) agar komponen gambar bisa memuatnya langsung. */
  @Public() @Get('vouchers/image/:file') @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async file(@Param('file') file: string, @Res({ passthrough: true }) res: { header: (k: string, v: string) => unknown }) {
    const { bytes, type } = await this.svc.readImage(file);
    res.header('Content-Type', type);
    return bytes;
  }

  @Get('voucher-redemptions') @Roles(...ADMIN) redemptions(@CurrentActor() a: Actor) { return this.svc.listRedemptions(a); }
  @Post('voucher-redemptions/:id/fulfill') @Roles(...ADMIN) fulfill(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(voucherFulfillSchema)) b: z.infer<typeof voucherFulfillSchema>) { return this.svc.fulfill(a, id, b.code); }
  @Post('voucher-redemptions/:id/reject') @Roles(...ADMIN) reject(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectSchema)) b: z.infer<typeof rejectSchema>) { return this.svc.reject(a, id, b.reason); }
}

@Module({ controllers: [CoinsController], providers: [CoinsService] })
export class CoinsModule {}
