import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { createRegionSchema, REGION_LABEL, REGION_LEVELS, regionFromMasterSchema, type RegionLevel } from '@sajadah/shared';
import { Database } from '../db/db';
import { members, regions, type Region } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError, isUniqueViolation } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { ADMIN, CurrentActor, Roles } from '../auth/auth.decorators';
import type { Actor } from '../auth/auth.types';
import { MasterService } from './master.service';

const PARENT_OF: Record<RegionLevel, RegionLevel | null> = { province: null, regency: 'province', district: 'regency', village: 'district' };

export interface RegionChain { province: Region; regency: Region; district: Region; village: Region }

@Injectable()
export class RegionsService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService, readonly master: MasterService) {}

  /** Seluruh pohon wilayah tenant (datar), lengkap dengan jalur nama dan jumlah anggota di kelurahan. */
  async list(tid: string) {
    const [rows, counts] = await Promise.all([
      this.db.select().from(regions).where(eq(regions.tenantId, tid)).orderBy(asc(regions.code), asc(regions.name)),
      this.db.select({ villageId: members.villageId, n: sql<number>`count(*)`.mapWith(Number) }).from(members).where(eq(members.tenantId, tid)).groupBy(members.villageId),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const memberCount = new Map(counts.filter((c) => c.villageId).map((c) => [c.villageId!, c.n]));
    const path = (r: Region): string[] => (r.parentId && byId.get(r.parentId) ? [...path(byId.get(r.parentId)!), r.name] : [r.name]);
    return rows.map((r) => ({ ...r, path: path(r), members: memberCount.get(r.id) ?? 0, children: rows.filter((c) => c.parentId === r.id).length }));
  }

  /** Rantai induk dari kelurahan: null bila tidak lengkap. Dipakai untuk membentuk nomor anggota. */
  async chain(q: Database, tid: string, villageId: string): Promise<RegionChain | null> {
    const all = await q.select().from(regions).where(eq(regions.tenantId, tid));
    const byId = new Map(all.map((r) => [r.id, r]));
    const village = byId.get(villageId);
    if (!village || village.level !== 'village') return null;
    const district = village.parentId ? byId.get(village.parentId) : undefined;
    const regency = district?.parentId ? byId.get(district.parentId) : undefined;
    const province = regency?.parentId ? byId.get(regency.parentId) : undefined;
    return province && regency && district ? { province, regency, district, village } : null;
  }

  private async assertParent(q: Database, tid: string, level: RegionLevel, parentId: string | null) {
    const want = PARENT_OF[level];
    if (!want) return;
    const [p] = await q.select().from(regions).where(and(eq(regions.tenantId, tid), eq(regions.id, parentId!)));
    if (!p) throw new BusinessError('Induk wilayah tidak ditemukan.');
    if (p.level !== want) throw new BusinessError(`Induk ${REGION_LABEL[level]} harus berupa ${REGION_LABEL[want]}.`);
  }

  /** Kode lokal bebas berikutnya di antara saudara (2 digit; kelurahan 3 digit). */
  private async nextCode(q: Database, tid: string, level: RegionLevel, parentId: string | null): Promise<string> {
    const siblings = await q.select({ code: regions.code }).from(regions).where(and(eq(regions.tenantId, tid), parentId ? eq(regions.parentId, parentId) : sql`${regions.parentId} is null`));
    const used = new Set(siblings.map((s) => Number(s.code)));
    let n = 1;
    while (used.has(n)) n++;
    if (level !== 'village' && n > 99) throw new BusinessError('Kode lokal 2 digit pada induk ini sudah habis (maksimum 99 wilayah).');
    return String(n).padStart(level === 'village' ? 3 : 2, '0');
  }

  /** `code` boleh dikosongkan: kode ditetapkan otomatis (nomor bebas berikutnya). Penetapan otomatis diulang bila bentrok dengan permintaan lain. */
  async create(a: Actor, input: { level: RegionLevel; parentId: string | null; code?: string; name: string; sourceCode?: string }) {
    const auto = !input.code;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          await this.assertParent(tx, a.tid, input.level, input.parentId);
          const [dup] = await tx.select({ id: regions.id }).from(regions).where(and(eq(regions.tenantId, a.tid), eq(regions.level, input.level), input.parentId ? eq(regions.parentId, input.parentId) : sql`${regions.parentId} is null`, sql`lower(${regions.name}) = lower(${input.name})`));
          if (dup) throw new BusinessError(`${REGION_LABEL[input.level]} "${input.name}" sudah ada pada induk yang sama.`);
          const code = input.code || (await this.nextCode(tx, a.tid, input.level, input.parentId));
          const [r] = await tx.insert(regions).values({ tenantId: a.tid, level: input.level, parentId: input.parentId, code, name: input.name, sourceCode: input.sourceCode ?? null }).returning();
          await this.core.audit(tx, a, `Wilayah ditambahkan: ${REGION_LABEL[input.level]} ${input.name} (kode ${code})`);
          return r!;
        });
      } catch (e) {
        if (isUniqueViolation(e)) {
          if (auto && attempt < 3) continue; // bentrok kode otomatis dengan permintaan serentak → hitung ulang
          throw new BusinessError(auto ? 'Kode otomatis bentrok, coba lagi.' : `Kode lokal ${input.code} sudah dipakai pada induk yang sama.`);
        }
        throw e;
      }
    }
  }

  /**
   * Tambah dari data referensi. Nama & kode lokal diturunkan SERVER dari `sourceCode` setelah diperiksa terhadap anak induknya
   * (klien tidak dipercaya). Induk juga harus berasal dari data referensi (punya sourceCode).
   */
  async createFromMaster(a: Actor, input: { level: RegionLevel; parentId: string | null; sourceCode: string }) {
    let parentCode: string | undefined;
    if (input.level === 'province') {
      if (input.parentId) throw new BusinessError('Provinsi tidak memiliki induk.');
    } else {
      const [parent] = input.parentId ? await this.db.select().from(regions).where(and(eq(regions.tenantId, a.tid), eq(regions.id, input.parentId))) : [];
      if (!parent) throw new BusinessError('Induk wilayah tidak ditemukan.');
      if (!parent.sourceCode) throw new BusinessError('Induk ini ditambahkan manual, sehingga tidak bisa memakai data referensi. Isi nama secara manual.');
      parentCode = parent.sourceCode;
    }
    const item = (await this.master.children(input.level, parentCode)).find((i) => i.code === input.sourceCode);
    if (!item) throw new BusinessError('Wilayah itu tidak ada pada data referensi di bawah induk yang dipilih.');
    return this.create(a, { level: input.level, parentId: input.parentId, code: item.localCode, name: item.name, sourceCode: item.code });
  }

  /**
   * Pastikan jalur provinsi → kelurahan untuk kode kelurahan (10 digit) ada di pohon tenant (cari/buat), lalu kembalikan kelurahannya.
   * Tiap tingkat diperiksa terhadap data referensi. Wilayah manual bernama sama ditautkan (diberi kode sumber), bukan diduplikasi.
   * Idempoten: memanggil ulang tidak membuat duplikat.
   */
  async ensureVillage(a: Actor, villageCode: string): Promise<Region> {
    const steps: { level: RegionLevel; src: string; parentSrc?: string }[] = [
      { level: 'province', src: villageCode.slice(0, 2) },
      { level: 'regency', src: villageCode.slice(0, 4), parentSrc: villageCode.slice(0, 2) },
      { level: 'district', src: villageCode.slice(0, 7), parentSrc: villageCode.slice(0, 4) },
      { level: 'village', src: villageCode, parentSrc: villageCode.slice(0, 7) },
    ];
    const items: { level: RegionLevel; code: string; name: string; local: string }[] = [];
    for (const st of steps) {
      const item = (await this.master.children(st.level, st.parentSrc)).find((i) => i.code === st.src);
      if (!item) throw new BusinessError('Kelurahan/desa itu tidak ada pada data referensi.');
      items.push({ level: st.level, code: item.code, name: item.name, local: item.localCode });
    }
    let parent: Region | null = null;
    for (const it of items) {
      const siblings: Region[] = await this.db.select().from(regions).where(and(eq(regions.tenantId, a.tid), eq(regions.level, it.level), parent ? eq(regions.parentId, parent.id) : sql`${regions.parentId} is null`));
      const hit = siblings.find((s) => s.sourceCode === it.code);
      const manual = hit ? undefined : siblings.find((s) => !s.sourceCode && s.name.toLowerCase() === it.name.toLowerCase());
      if (hit) parent = hit;
      else if (manual) parent = (await this.db.update(regions).set({ sourceCode: it.code }).where(eq(regions.id, manual.id)).returning())[0]!;
      else parent = (await this.create(a, { level: it.level, parentId: parent?.id ?? null, code: it.local, name: it.name, sourceCode: it.code })) as Region;
    }
    return parent!;
  }

  async remove(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(regions).where(and(eq(regions.tenantId, a.tid), eq(regions.id, id))).for('update');
      if (!r) throw new BusinessError('Wilayah tidak ditemukan.');
      const [child] = await tx.select({ id: regions.id }).from(regions).where(eq(regions.parentId, id)).limit(1);
      if (child) throw new BusinessError('Wilayah masih memiliki wilayah di bawahnya.');
      const [m] = await tx.select({ id: members.id }).from(members).where(eq(members.villageId, id)).limit(1);
      if (m) throw new BusinessError('Wilayah masih dipakai penempatan anggota.');
      await tx.delete(regions).where(eq(regions.id, id));
      await this.core.audit(tx, a, `Wilayah dihapus: ${REGION_LABEL[r.level]} ${r.name}`);
      return { ok: true };
    });
  }
}

@Controller()
@Roles(...ADMIN)
class RegionsController {
  constructor(private readonly svc: RegionsService) {}

  @Get('regions') list(@CurrentActor() a: Actor) { return this.svc.list(a.tid); }
  @Post('regions') create(@CurrentActor() a: Actor, @Body(new ZodPipe(createRegionSchema)) b: any) { return this.svc.create(a, b); }
  @Post('regions/from-master') fromMaster(@CurrentActor() a: Actor, @Body(new ZodPipe(regionFromMasterSchema)) b: any) { return this.svc.createFromMaster(a, b); }
  @Delete('regions/:id') remove(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(a, id); }

  /** Data referensi (dari database, tanpa jaringan): ?level=province|regency|district|village&parent=<kode induk>. */
  @Get('master/wilayah') async master(@Query('level') level: string, @Query('parent') parent?: string) {
    if (!(REGION_LEVELS as readonly string[]).includes(level)) throw new BusinessError('Tingkat tidak dikenal.');
    const items = await this.svc.master.children(level as RegionLevel, parent || undefined);
    return { source: MasterService.SOURCE, available: (await this.svc.master.count()) > 0, items };
  }
}

@Module({ controllers: [RegionsController], providers: [RegionsService, MasterService], exports: [RegionsService, MasterService] })
export class RegionsModule {}
