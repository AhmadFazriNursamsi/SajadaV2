import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { buildMemberNumber, createsSponsorCycle, formatReferral, normalizeReferral, INITIAL_BUDGET, PARTICIPATION_TOTAL, SHOPPING_BALANCE, type CreateMemberInput } from '@sajadah/shared';
import { RegionsService, type RegionChain } from '../regions/regions.module';
import { AccountsService } from '../accounts/accounts.module';
import { Database } from '../db/db';
import { counters, fundingAllocations, investors, members, orders, regions, users } from '../db/schema';
import { InjectDb } from '../core/db.module';
import { CoreService } from '../core/core.service';
import { BusinessError } from '../common/errors';
import type { Actor } from '../auth/auth.types';

@Injectable()
export class MembersService {
  constructor(@InjectDb() private readonly db: Database, private readonly core: CoreService, private readonly regionsSvc: RegionsService, private readonly accounts: AccountsService) {}

  /** Daftar anggota + status penempatan dan jalur wilayah (kelurahan → provinsi). */
  async list(tid: string) {
    const [rows, regs] = await Promise.all([
      this.db.select({ ...getTableColumns(members), placed: sql<boolean>`${members.villageId} is not null`, username: users.username, resetRequestedAt: users.resetRequestedAt }).from(members).leftJoin(users, eq(users.memberId, members.id)).where(eq(members.tenantId, tid)).orderBy(asc(members.createdAt), asc(members.name)),
      this.db.select().from(regions).where(eq(regions.tenantId, tid)),
    ]);
    const byId = new Map(regs.map((r) => [r.id, r]));
    const path = (id: string | null): string | null => {
      const out: string[] = [];
      for (let cur = id ? byId.get(id) : undefined; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) out.push(cur.name);
      return out.length ? out.join(', ') : null;
    };
    return rows.map((m) => ({ ...m, regionPath: path(m.villageId) }));
  }

  private async get(q: Database, tid: string, id: string) {
    const [m] = await q.select().from(members).where(and(eq(members.tenantId, tid), eq(members.id, id))).for('update');
    if (!m) throw new BusinessError('Anggota tidak ditemukan');
    return m;
  }

  /** Anggota baru langsung ditempatkan di kelurahan yang dipilih dan nomornya terbit saat itu juga. */
  async create(a: Actor, input: CreateMemberInput) {
    return this.db.transaction(async (tx) => {
      const chain = await this.regionsSvc.chain(tx, a.tid, input.villageId);
      if (!chain) throw new BusinessError('Pilih kelurahan/desa dari Struktur daerah yang wilayah induknya (kecamatan, kabupaten, provinsi) sudah lengkap.');
      // Kode referal (opsional): anggota yang mengajak menjadi sponsor otomatis.
      const sponsor = input.referralCode?.trim() ? await this.byReferral(tx, a.tid, input.referralCode) : null;
      const [m] = await tx.insert(members).values({ tenantId: a.tid, name: input.name, area: chain.district.name, villageId: chain.village.id, familyCode: input.familyCode, sponsorId: sponsor?.id ?? null }).returning();
      const memberNo = await this.issue(tx, a, m!, chain);
      await this.core.audit(tx, a, `Anggota ditambahkan: ${input.name} (${memberNo})${sponsor ? `; diajak oleh ${sponsor.name} (kode referal)` : ''}`);
      if (input.createAccount && a.role !== 'tenant_admin') throw new ForbiddenException('Hanya pengurus yang dapat membuat akun login.');
      const account = input.createAccount ? await this.accounts.createInTx(tx, a, m!) : null; // kata sandi hanya dikembalikan di sini
      return { ...m!, memberNo, account };
    });
  }

  /** Ubah data identitas anggota (nama, status keluarga). Nomor anggota yang sudah terbit tidak berubah. */
  async update(a: Actor, id: string, input: { name?: string; familyCode?: string }) {
    return this.db.transaction(async (tx) => {
      const m = await this.get(tx, a.tid, id);
      const set: { name?: string; familyCode?: string } = {};
      if (input.name !== undefined && input.name !== m.name) set.name = input.name;
      if (input.familyCode !== undefined && input.familyCode !== m.familyCode) set.familyCode = input.familyCode;
      if (!Object.keys(set).length) throw new BusinessError('Tidak ada perubahan.');
      const [u] = await tx.update(members).set(set).where(eq(members.id, id)).returning();
      if (set.name) await tx.update(users).set({ name: set.name }).where(and(eq(users.memberId, id), eq(users.tenantId, a.tid)));
      await this.core.audit(tx, a, `Data anggota ${m.name} diubah${set.name ? `: nama → ${set.name}` : ''}${set.familyCode ? `; status keluarga ${m.familyCode ?? '—'} → ${set.familyCode}` : ''}`);
      return u!;
    });
  }

  /**
   * Nonaktifkan anggota (keluar/ditangguhkan). Riwayat transaksi tetap tersimpan (tidak dihapus); anggota tidak bisa masuk, memesan, atau menjual,
   * dan tidak bisa menjadi pengajak baru. Ditolak bila masih ada pesanan yang belum selesai.
   * Saldo belanja yang tersisa tidak dikembalikan otomatis: penyelesaiannya diputuskan pengurus di luar sistem.
   */
  async deactivate(a: Actor, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const m = await this.get(tx, a.tid, id);
      if (m.deactivatedAt) throw new BusinessError('Anggota ini sudah nonaktif.');
      const open = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(orders).where(and(
        eq(orders.tenantId, a.tid), eq(orders.cancelled, false), eq(orders.returned, false), eq(orders.received, false),
        sql`(${orders.sellerId} = ${id} or ${orders.buyerId} = ${id})`,
      ));
      if (open[0]!.n > 0) throw new BusinessError(`Anggota masih punya ${open[0]!.n} pesanan yang belum selesai (belum diterima/dibatalkan). Selesaikan atau batalkan dulu.`);
      await tx.update(members).set({ deactivatedAt: new Date(), deactivationReason: reason, deactivatedBy: a.name }).where(eq(members.id, id));
      await this.core.audit(tx, a, `Anggota ${m.name} dinonaktifkan: ${reason}${m.balance > 0 ? ` (saldo belanja tersisa ${m.balance} tidak otomatis dikembalikan)` : ''}`);
      return { ok: true, balance: m.balance };
    });
  }

  async reactivate(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const m = await this.get(tx, a.tid, id);
      if (!m.deactivatedAt) throw new BusinessError('Anggota ini tidak dalam keadaan nonaktif.');
      await tx.update(members).set({ deactivatedAt: null, deactivationReason: null, deactivatedBy: null }).where(eq(members.id, id));
      await this.core.audit(tx, a, `Anggota ${m.name} diaktifkan kembali`);
      return { ok: true };
    });
  }

  /** Cari anggota pemilik kode referal (kode dinormalkan: huruf besar tanpa tanda baca). */
  private async byReferral(q: Database, tid: string, code: string) {
    const [m] = await q.select({ id: members.id, name: members.name, referralCode: members.referralCode }).from(members).where(and(eq(members.tenantId, tid), eq(members.referralCode, normalizeReferral(code))));
    if (!m) throw new BusinessError('Kode referal tidak ditemukan. Periksa kembali kode dari anggota yang mengajak.');
    const [st] = await q.select({ d: members.deactivatedAt }).from(members).where(eq(members.id, m.id));
    if (st?.d) throw new BusinessError('Pemilik kode referal ini sudah nonaktif dan tidak dapat mengajak anggota baru.');
    return m;
  }

  /** Pratinjau sponsor untuk formulir pendaftaran: nama anggota pemilik kode. */
  async referralPreview(tid: string, code: string) {
    const m = await this.byReferral(this.db, tid, code);
    return { id: m.id, name: m.name, code: formatReferral(m.referralCode) };
  }

  /** Pratinjau nomor berikutnya untuk daerah tertentu (tampilan formulir; nomor final ditetapkan saat disimpan). */
  async nextNumber(tid: string, villageId: string) {
    const chain = await this.regionsSvc.chain(this.db, tid, villageId);
    if (!chain) throw new BusinessError('Pilih kelurahan/desa dari Struktur daerah yang wilayah induknya sudah lengkap.');
    const [c] = await this.db.select({ v: counters.value }).from(counters).where(and(eq(counters.tenantId, tid), eq(counters.key, 'member_no')));
    return { memberNo: buildMemberNumber({ province: chain.province.code, regency: chain.regency.code, district: chain.district.code, year: new Date().getFullYear(), sequence: (c?.v ?? 0) + 1 }) };
  }

  private async issue(tx: Database, a: Actor, m: { id: string; name: string }, chain: RegionChain) {
    const seq = await this.core.next(tx, a.tid, 'member_no');
    const memberNo = buildMemberNumber({ province: chain.province.code, regency: chain.regency.code, district: chain.district.code, year: new Date().getFullYear(), sequence: seq });
    await tx.update(members).set({ memberNo }).where(eq(members.id, m.id));
    return memberNo;
  }

  /** Penempatan ke kelurahan/desa (harus lengkap sampai provinsi). Nomor yang sudah terbit tidak berubah. */
  async place(a: Actor, id: string, input: { villageId?: string; villageSourceCode?: string }) {
    // Dari data referensi: bangun jalur wilayah dulu (di luar transaksi anggota agar tidak saling mengunci).
    const villageId = input.villageSourceCode ? (await this.regionsSvc.ensureVillage(a, input.villageSourceCode)).id : input.villageId!;
    return this.db.transaction(async (tx) => {
      const m = await this.get(tx, a.tid, id);
      const chain = await this.regionsSvc.chain(tx, a.tid, villageId);
      if (!chain) throw new BusinessError('Pilih kelurahan/desa yang wilayah induknya (kecamatan, kabupaten, provinsi) sudah lengkap.');
      await tx.update(members).set({ villageId }).where(eq(members.id, id));
      await this.core.audit(tx, a, `Penempatan disimpan: ${m.name} → ${chain.village.name}, ${chain.district.name}`);
      return { ok: true };
    });
  }

  async issueNumber(a: Actor, id: string) {
    return this.db.transaction(async (tx) => {
      const m = await this.get(tx, a.tid, id);
      if (m.memberNo) throw new BusinessError('Nomor anggota sudah terbit dan tidak berubah');
      if (!m.villageId) throw new BusinessError('Penempatan anggota belum lengkap.');
      const chain = await this.regionsSvc.chain(tx, a.tid, m.villageId);
      if (!chain) throw new BusinessError('Penempatan anggota belum lengkap.');
      const memberNo = await this.issue(tx, a, m, chain);
      await this.core.audit(tx, a, `Nomor terbit: ${memberNo} (${m.name})`);
      return { memberNo };
    });
  }

  /**
   * Alokasi sumber penyertaan per investor. Total harus tepat Rp12.500.000; referensi dan tanggal wajib.
   * (Aktivasi saldo baru boleh sesudah ini.)
   */
  async recordFunding(a: Actor, id: string, input: { ref: string; date: string; allocations: { investorId: string; amount: number }[] }) {
    return this.db.transaction(async (tx) => {
      const m = await this.get(tx, a.tid, id);
      if (m.funded) throw new BusinessError('Alokasi penyertaan sudah dicatat.');
      const ids = input.allocations.map((x) => x.investorId);
      if (new Set(ids).size !== ids.length) throw new BusinessError('Satu investor hanya boleh muncul sekali.');
      const found = await tx.select({ id: investors.id }).from(investors).where(and(eq(investors.tenantId, a.tid), inArray(investors.id, ids)));
      if (found.length !== ids.length) throw new BusinessError('Investor tidak ditemukan pada tenant ini.');
      const total = input.allocations.reduce((s, x) => s + x.amount, 0);
      if (total !== PARTICIPATION_TOTAL) throw new BusinessError(`Total alokasi harus Rp${PARTICIPATION_TOTAL.toLocaleString('id-ID')} (sekarang Rp${total.toLocaleString('id-ID')}).`);
      await tx.insert(fundingAllocations).values(input.allocations.map((x) => ({ tenantId: a.tid, memberId: id, investorId: x.investorId, amount: x.amount })));
      await tx.update(members).set({ funded: true, fundingRef: input.ref, fundedAt: input.date }).where(eq(members.id, id));
      await this.core.audit(tx, a, `Alokasi penyertaan Rp${total.toLocaleString('id-ID')} dicatat untuk ${m.name} (${input.ref}, ${input.allocations.length} investor)`);
      return { ok: true };
    });
  }

  /** Aktivasi saldo belanja Rp10 juta; anggaran awal Rp2,5 juta disimpan sebagai snapshot pada anggota. */
  async activate(a: Actor, id: string, input: { ref: string; date: string }) {
    return this.db.transaction(async (tx) => {
      const m = await this.get(tx, a.tid, id);
      if (m.active) throw new BusinessError('Saldo belanja sudah aktif.');
      if (!m.funded) throw new BusinessError('Aktivasi ditolak: sumber investor belum dicatat.');
      if (input.date > new Date().toISOString().slice(0, 10)) throw new BusinessError('Tanggal aktivasi tidak boleh di masa depan.');
      if (m.fundedAt && input.date < m.fundedAt) throw new BusinessError('Tanggal aktivasi tidak boleh sebelum tanggal pendanaan.');
      const budget = { ...INITIAL_BUDGET };
      const budgetTotal = Object.values(budget).reduce((x, y) => x + y, 0);
      if (budgetTotal + SHOPPING_BALANCE !== PARTICIPATION_TOTAL) throw new BusinessError('Anggaran awal tidak berjumlah Rp2.500.000.');
      await tx.update(members).set({ active: true, balance: SHOPPING_BALANCE, remaining: PARTICIPATION_TOTAL, activatedAt: input.date, activationRef: input.ref, budgetSnapshot: budget }).where(eq(members.id, id));
      await this.core.audit(tx, a, `Saldo belanja aktif: ${m.name} (${input.ref}, ${input.date}); anggaran awal ${budgetTotal.toLocaleString('id-ID')}`);
      return { ok: true };
    });
  }

  async setSponsor(a: Actor, id: string, sponsorId: string | null) {
    return this.db.transaction(async (tx) => {
      const m = await this.get(tx, a.tid, id);
      const all = await tx.select({ id: members.id, sponsorId: members.sponsorId }).from(members).where(eq(members.tenantId, a.tid));
      if (sponsorId && !all.some((x) => x.id === sponsorId)) throw new BusinessError('Sponsor harus anggota tenant yang sama.');
      const map = new Map(all.map((x) => [x.id, x.sponsorId]));
      if (sponsorId === id || createsSponsorCycle(id, sponsorId, (x) => map.get(x))) throw new BusinessError('Sponsor menyebabkan siklus.');
      await tx.update(members).set({ sponsorId }).where(eq(members.id, id));
      await this.core.audit(tx, a, `Sponsor ${m.name} diubah (berlaku untuk transaksi baru)`);
      return { ok: true };
    });
  }

  /** Volume jaringan: pribadi = penjualan berbayar sebagai penjual; downline = pesanan yang rantai upline-nya memuat anggota. */
  async network(tid: string) {
    const ms = await this.list(tid);
    const paid = (await this.db.select().from(orders).where(and(eq(orders.tenantId, tid), eq(orders.cancelled, false), eq(orders.returned, false), sql`${orders.pay} <> 'unpaid'`))).filter((o) => !o.buyerId); // hanya penjualan ke pelanggan umum
    const total = (o: (typeof paid)[number]) => o.qty * o.price;
    return ms.map((m) => {
      const personal = paid.filter((o) => o.sellerId === m.id).reduce((s, o) => s + total(o), 0);
      const downline = paid.filter((o) => o.uplines.includes(m.id)).reduce((s, o) => s + total(o), 0);
      return { id: m.id, name: m.name, sponsorId: m.sponsorId, downlineCount: ms.filter((x) => x.sponsorId === m.id).length, personal, downline, group: personal + downline };
    });
  }
}
