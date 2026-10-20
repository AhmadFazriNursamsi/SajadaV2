import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { RegionLevel } from '@sajadah/shared';
import { Database } from '../db/db';
import { masterRegions } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { BusinessError } from '../common/errors';

export interface MasterItem { code: string; name: string; localCode: string }
export interface MasterData {
  provinces: [string, string][];
  regencies: [string, string, string][];
  districts: [string, string, string][];
  villages: [string, string, string][];
}

const PARENT_RE: Record<RegionLevel, RegExp | null> = { province: null, regency: /^\d{2}$/, district: /^\d{4}$/, village: /^\d{7}$/ };

/** Kode lokal kecamatan: 2 digit pertama dari 3 digit akhir kode BPS; bila sudah dipakai saudaranya, nomor bebas berikutnya (≤ 99). */
function districtLocalCodes(rows: [string, string, string][]): Map<string, string> {
  const out = new Map<string, string>();
  const byParent = new Map<string, [string, string, string][]>();
  for (const r of rows) (byParent.get(r[1]) ?? byParent.set(r[1], []).get(r[1])!).push(r);
  for (const list of byParent.values()) {
    const used = new Set<number>();
    for (const [code] of [...list].sort((a, b) => a[0].localeCompare(b[0]))) {
      let n = Math.max(1, Number(code.slice(4, 6)));
      while (used.has(n) && n < 99) n++;
      if (used.has(n)) n = Array.from({ length: 99 }, (_, i) => i + 1).find((i) => !used.has(i))!;
      used.add(n);
      out.set(code, String(n).padStart(2, '0'));
    }
  }
  return out;
}

/**
 * Data referensi wilayah di database (offline; tanpa pemanggilan jaringan). Dimuat dari berkas saat pertama kali server jalan
 * (di latar belakang; permintaan menunggu sampai selesai). Bila berkas tidak ada, daftar kosong dan aplikasi memakai isian manual.
 */
@Injectable()
export class MasterService implements OnModuleInit {
  static readonly FILE = process.env.WILAYAH_FILE ?? resolve(__dirname, '../../data/wilayah.json.gz');
  static readonly SOURCE = 'indonesia.sql (BPS)';
  private readonly log = new Logger('Wilayah');
  ready: Promise<void> = Promise.resolve();

  constructor(@InjectDb() private readonly db: Database) {}

  onModuleInit() {
    if (process.env.WILAYAH_AUTOLOAD === 'false') return;
    this.ready = this.autoload().catch((e) => this.log.error(`Gagal memuat data wilayah: ${(e as Error).message}`));
  }

  async count(): Promise<number> {
    const [r] = await this.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(masterRegions);
    return r!.n;
  }

  private async autoload() {
    if ((await this.count()) > 0) return;
    if (!existsSync(MasterService.FILE)) { this.log.warn(`Berkas data wilayah tidak ada (${MasterService.FILE}); isian wilayah hanya manual.`); return; }
    const t0 = Date.now();
    const data = JSON.parse(gunzipSync(readFileSync(MasterService.FILE)).toString('utf8')) as MasterData;
    await this.load(data);
    this.log.log(`Data wilayah dimuat: ${data.provinces.length} provinsi, ${data.regencies.length} kab/kota, ${data.districts.length} kecamatan, ${data.villages.length} desa (${((Date.now() - t0) / 1000).toFixed(1)} dtk)`);
  }

  /** Ganti seluruh data referensi dengan `data` (dipakai saat boot dan oleh tes). */
  async load(data: MasterData): Promise<void> {
    const dLocal = districtLocalCodes(data.districts);
    const vSeq = new Map<string, number>();
    const rows: (typeof masterRegions.$inferInsert)[] = [
      ...data.provinces.map(([code, name]) => ({ level: 'province' as const, code, parentCode: null, name, localCode: code })),
      ...data.regencies.map(([code, parent, name]) => ({ level: 'regency' as const, code, parentCode: parent, name, localCode: code.slice(2) })),
      ...data.districts.map(([code, parent, name]) => ({ level: 'district' as const, code, parentCode: parent, name, localCode: dLocal.get(code)! })),
    ];
    const seen = new Map<string, Set<string>>();
    for (const [code, parent, name] of data.villages) {
      let local = code.slice(7);
      const used = seen.get(parent) ?? seen.set(parent, new Set()).get(parent)!;
      if (used.has(local)) { const n = (vSeq.get(parent) ?? 0) + 1; vSeq.set(parent, n); local = String(900 + n); } // jarang: bentrok 3 digit akhir
      used.add(local);
      rows.push({ level: 'village', code, parentCode: parent, name, localCode: local });
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(masterRegions);
      for (let i = 0; i < rows.length; i += 2000) await tx.insert(masterRegions).values(rows.slice(i, i + 2000));
    });
  }

  /** Anak dari `parent` (kode induk pada data referensi; kosong untuk provinsi). */
  async children(level: RegionLevel, parent?: string): Promise<MasterItem[]> {
    await this.ready;
    const re = PARENT_RE[level];
    if (re ? !parent || !re.test(parent) : !!parent) throw new BusinessError('Kode induk tidak valid untuk tingkat ini.');
    return this.db.select({ code: masterRegions.code, name: masterRegions.name, localCode: masterRegions.localCode }).from(masterRegions)
      .where(parent ? and(eq(masterRegions.level, level), eq(masterRegions.parentCode, parent)) : eq(masterRegions.level, level)).orderBy(asc(masterRegions.code));
  }
}
