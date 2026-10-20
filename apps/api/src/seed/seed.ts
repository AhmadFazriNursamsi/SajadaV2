import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { buildMemberNumber, INITIAL_BUDGET, PARTICIPATION_TOTAL, SHOPPING_BALANCE, uplineChain } from '@sajadah/shared';
import type { Database } from '../db/db';
import { auditLog, centralMovements, centralStock, commissionPlans, counters, depotStock, depots, stockMovements, fundingAllocations, investors, members, orders, payables, products, purchaseOrders, regions, suppliers, tenants, users, vouchers } from '../db/schema';
import { hashPassword } from '../auth/password';

export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'sajadah123';

/**
 * Wilayah demo per tenant memakai kode & nama dari data referensi (indonesia.sql / BPS). `src` = kode lengkap pada data referensi,
 * `code` = kode lokal yang membentuk nomor anggota (kecamatan: 2 digit prefiks BPS, bentrok → nomor bebas berikutnya).
 */
interface Node { src: string; code: string; name: string }
interface Geo { province: Node; regency: Node; districts: (Node & { village: Node })[] }
const TENANTS: { slug: string; name: string; depotName: string; depot2: string; geo1: [number, number]; geo2: [number, number]; cash: number; names: string[]; geo: Geo; districtOf: number[] }[] = [
  { slug: 'nasional', name: 'Koperasi Sajadah', depotName: 'Toko Kab. Bandung', depot2: 'Toko Kota Bandung', geo1: [-7.0252, 107.5196], geo2: [-6.9218, 107.6071], cash: 24_300_000, names: ['Siti Rahma', 'Budi Santoso', 'Dewi Lestari', 'Rina Marlina'],
    geo: { province: { src: '32', code: '32', name: 'Jawa Barat' }, regency: { src: '3204', code: '04', name: 'Kabupaten Bandung' }, districts: [
      { src: '3204290', code: '29', name: 'Cileunyi', village: { src: '3204290001', code: '001', name: 'Cibiru Hilir' } },
      { src: '3204110', code: '13', name: 'Rancaekek', village: { src: '3204110001', code: '001', name: 'Sukamanah' } },
      { src: '3204310', code: '31', name: 'Cimenyan', village: { src: '3204310001', code: '001', name: 'Cibeunying' } }] }, districtOf: [0, 0, 1, 2] },
  { slug: 'jabar', name: 'Koperasi Sajadah Jawa Barat', depotName: 'Toko Kota Cimahi', depot2: 'Toko Kab. Bogor', geo1: [-6.8841, 107.5413], geo2: [-6.4817, 106.854], cash: 27_800_000, names: ['Sari Wulandari', 'Hendra Gunawan', 'Lina Marlina', 'Tono Wijaya'],
    geo: { province: { src: '32', code: '32', name: 'Jawa Barat' }, regency: { src: '3277', code: '77', name: 'Kota Cimahi' }, districts: [
      { src: '3277030', code: '03', name: 'Cimahi Utara', village: { src: '3277030001', code: '001', name: 'Pasirkaliki' } },
      { src: '3277020', code: '02', name: 'Cimahi Tengah', village: { src: '3277020001', code: '001', name: 'Baros' } },
      { src: '3277010', code: '01', name: 'Cimahi Selatan', village: { src: '3277010001', code: '001', name: 'Melong' } }] }, districtOf: [0, 0, 1, 2] },
  { slug: 'dki', name: 'Koperasi Sajadah DKI Jakarta', depotName: 'Toko Jakarta Selatan', depot2: 'Toko Jakarta Timur', geo1: [-6.2615, 106.8106], geo2: [-6.225, 106.9004], cash: 31_300_000, names: ['Maya Putri', 'Joko Susilo', 'Ayu Ningsih', 'Eko Prasetyo'],
    geo: { province: { src: '31', code: '31', name: 'DKI Jakarta' }, regency: { src: '3171', code: '71', name: 'Kota Jakarta Selatan' }, districts: [
      { src: '3171090', code: '09', name: 'Tebet', village: { src: '3171090001', code: '001', name: 'Menteng Dalam' } },
      { src: '3171100', code: '10', name: 'Setia Budi', village: { src: '3171100001', code: '001', name: 'Karet Semanggi' } },
      { src: '3171020', code: '02', name: 'Pasar Minggu', village: { src: '3171020001', code: '001', name: 'Cilandak Timur' } }] }, districtOf: [0, 0, 1, 2] },
];

const PRODUCTS = [
  { sku: 'PRD-01', name: 'Produk A', physical: 20, safety: 5, target: 20, inTransit: 0, buyPrice: 70_000, sellPrice: 100_000, listPrice: 125_000, category: 'Makanan', coins: 10, description: 'Produk pilihan koperasi dalam kemasan, dikemas higienis dan siap dijual kembali. Simpan di tempat sejuk dan kering.' },
  { sku: 'PRD-02', name: 'Produk B', physical: 9, safety: 5, target: 20, inTransit: 0, buyPrice: 63_000, sellPrice: 90_000, listPrice: 0, category: 'Minuman', coins: 8, description: 'Minuman kemasan untuk kebutuhan harian keluarga dan warung. Kualitas terjaga langsung dari pemasok koperasi.' },
  { sku: 'PRD-03', name: 'Produk C', physical: 14, safety: 6, target: 24, inTransit: 0, buyPrice: 80_000, sellPrice: 115_000, listPrice: 0, category: 'Kebutuhan Rumah', coins: 12, description: 'Kebutuhan rumah tangga sehari-hari dalam kemasan, harga anggota lebih hemat dibanding eceran.' },
];

/** Bangun pohon wilayah tenant dan kembalikan id kelurahan (satu per kecamatan) + kode untuk nomor anggota. */
async function buildRegions(tx: Parameters<Parameters<Database['transaction']>[0]>[0], tid: string, geo: Geo) {
  const [pr] = await tx.insert(regions).values({ tenantId: tid, level: 'province', code: geo.province.code, name: geo.province.name, sourceCode: geo.province.src }).returning();
  const [rr] = await tx.insert(regions).values({ tenantId: tid, level: 'regency', parentId: pr!.id, code: geo.regency.code, name: geo.regency.name, sourceCode: geo.regency.src }).returning();
  const villages: { id: string; codes: { province: string; regency: string; district: string } }[] = [];
  for (const d of geo.districts) {
    const [dr] = await tx.insert(regions).values({ tenantId: tid, level: 'district', parentId: rr!.id, code: d.code, name: d.name, sourceCode: d.src }).returning();
    const [vr] = await tx.insert(regions).values({ tenantId: tid, level: 'village', parentId: dr!.id, code: d.village.code, name: d.village.name, sourceCode: d.village.src }).returning();
    villages.push({ id: vr!.id, codes: { province: pr!.code, regency: rr!.code, district: dr!.code } });
  }
  return villages;
}

/** `all` = ketiga koperasi (hanya untuk tes isolasi antar-koperasi); bawaan demo: satu koperasi. */
export async function seedIfEmpty(db: Database, opts: { all?: boolean } = {}): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(tenants);
  if (n > 0) return false;
  await seedDemo(db, opts);
  new Logger('Seed').log(`Data demo dibuat (Koperasi Sajadah). Login: admin.nasional / petugas.nasional, kata sandi ${DEMO_PASSWORD}`);
  return true;
}

export async function seedDemo(db: Database, opts: { all?: boolean } = {}): Promise<void> {
  const hash = await hashPassword(DEMO_PASSWORD);
  const year = new Date().getFullYear();
  for (const T of opts.all ? TENANTS : TENANTS.slice(0, 1)) {
    await db.transaction(async (tx) => {
      const [t] = await tx.insert(tenants).values({ slug: T.slug, name: T.name, cash: T.cash }).returning();
      const tid = t!.id;
      const villages = await buildRegions(tx, tid, T.geo);
      const [inv1, inv2] = await tx.insert(investors).values([{ tenantId: tid, code: 'INV-01', name: 'Investor Utama', sharePercent: 70 }, { tenantId: tid, code: 'INV-02', name: 'Investor Mitra', sharePercent: 30 }]).returning();

      // Anggota: 0 aktif (Ibu), 1 aktif (Bapak, sponsor 0), 2 belum terdanai (sponsor 1), 3 baru tanpa kode & penempatan
      const spec = [
        { familyCode: 'I', active: true, funded: true, placed: true, sponsor: -1 },
        { familyCode: 'B', active: true, funded: true, placed: true, sponsor: 0 },
        { familyCode: 'P', active: false, funded: false, placed: true, sponsor: 1 },
        { familyCode: null, active: false, funded: false, placed: false, sponsor: 2 },
      ] as const;
      const ms: (typeof members.$inferSelect)[] = [];
      let seq = 0;
      for (const [i, sp] of spec.entries()) {
        const v = sp.placed ? villages[T.districtOf[i]!]! : null;
        const memberNo = v ? buildMemberNumber({ ...v.codes, year, sequence: ++seq }) : null;
        const [m] = await tx.insert(members).values({
          tenantId: tid, name: T.names[i]!, area: T.geo.districts[T.districtOf[i]!]!.name, familyCode: sp.familyCode, memberNo, villageId: v?.id ?? null,
          funded: sp.funded, fundingRef: sp.funded ? `FUND-0${i + 1}` : null, fundedAt: sp.funded ? '2026-08-25' : null,
          active: sp.active, activatedAt: sp.active ? '2026-09-01' : null, activationRef: sp.active ? `AKT-0${i + 1}` : null, budgetSnapshot: sp.active ? { ...INITIAL_BUDGET } : null,
          balance: sp.active ? SHOPPING_BALANCE : 0, remaining: sp.active ? PARTICIPATION_TOTAL : 0,
          sponsorId: sp.sponsor >= 0 ? ms[sp.sponsor]!.id : null,
        }).returning();
        ms.push(m!);
        if (sp.funded) await tx.insert(fundingAllocations).values([{ tenantId: tid, memberId: m!.id, investorId: inv1!.id, amount: 8_750_000 }, { tenantId: tid, memberId: m!.id, investorId: inv2!.id, amount: 3_750_000 }]);
      }
      await tx.insert(counters).values({ tenantId: tid, key: 'member_no', value: seq });

      const [d1, d2] = await tx.insert(depots).values([{ tenantId: tid, name: T.depotName, lat: T.geo1[0], lng: T.geo1[1] }, { tenantId: tid, name: T.depot2, lat: T.geo2[0], lng: T.geo2[1] }]).returning();
      const ps = await tx.insert(products).values(PRODUCTS.map(({ physical: _p, inTransit: _i, ...p }) => ({ ...p, tenantId: tid, moq: 10, multiple: 5 }))).returning();
      await tx.insert(vouchers).values([
        { tenantId: tid, name: 'Voucher Umroh', description: 'Paket umroh untuk satu orang. Pengurus akan menghubungi untuk jadwal dan kelengkapan berkas.', coinCost: 50_000, stock: 5 },
        { tenantId: tid, name: 'Voucher Belanja Rp100.000', description: 'Potongan belanja di toko koperasi.', coinCost: 1_000, stock: 50 },
      ]);
      // Toko pertama membawa stok awal; toko kedua stok lebih kecil agar pemesanan per toko terlihat berbeda.
      const stockRows = ps.flatMap((p, i) => [
        { depotId: d1!.id, productId: p.id, physical: PRODUCTS[i]!.physical, inTransit: PRODUCTS[i]!.inTransit },
        { depotId: d2!.id, productId: p.id, physical: [12, 6, 8][i] ?? 5, inTransit: 0 },
      ]);
      await tx.insert(depotStock).values(stockRows);
      // Kartu stok dimulai dengan saldo awal agar jumlah mutasi selalu sama dengan stok fisik.
      await tx.insert(stockMovements).values(stockRows.filter((r) => r.physical !== 0).map((r) => ({ tenantId: tid, depotId: r.depotId, productId: r.productId, type: 'opening' as const, qty: r.physical, balanceAfter: r.physical, refNo: 'Saldo awal', actorName: 'Seed' })));
      // Gudang pusat: stok awal untuk demo kirim ke toko.
      const central = [60, 50, 40];
      await tx.insert(centralStock).values(ps.map((p, i) => ({ tenantId: tid, productId: p.id, physical: central[i] ?? 30 })));
      await tx.insert(centralMovements).values(ps.map((p, i) => ({ tenantId: tid, productId: p.id, type: 'opening' as const, qty: central[i] ?? 30, balanceAfter: central[i] ?? 30, refNo: 'Saldo awal', actorName: 'Seed' })));
      const [sup1, sup2] = await tx.insert(suppliers).values([{ tenantId: tid, name: 'CV Sumber Prima', phone: '0812-5550-0101' }, { tenantId: tid, name: 'UD Kemasan Jaya', phone: '0813-5550-0202' }]).returning();

      const byId = new Map(ms.map((m) => [m.id, m]));
      const up = (sellerIdx: number) => uplineChain(ms[sellerIdx]!.id, (id) => byId.get(id)?.sponsorId);
      // Penjualan anggota selalu ke pelanggan umum (bayar tunai); belanja anggota untuk diri sendiri tidak berkomisi.
      // SO-0409 belum dibayar; SO-0410 lunas tunai; SO-0411 belanja sendiri (saldo) dikirim; SO-0412 diterima (dasar komisi demo)
      const mk = (no: number, se: number, buyer: { member: number } | { customer: string }, pi: number, qty: number, o: Partial<typeof orders.$inferInsert>) => ({
        tenantId: tid, depotId: d1!.id, approvedAt: new Date(), approvedBy: 'Seed', no: `SO-0${no}`, groupId: crypto.randomUUID(), groupNo: `SO-0${no}`, sellerId: ms[se]!.id,
        ...('member' in buyer ? { buyerId: ms[buyer.member]!.id } : { buyerId: null, customerName: buyer.customer }),
        productId: ps[pi]!.id, qty, price: ps[pi]!.sellPrice, uplines: up(se), ...o,
      });
      await tx.insert(orders).values([
        mk(409, 1, { customer: 'Ibu Ratna' }, 1, 5, {}),
        mk(410, 0, { customer: 'Pak Hasan' }, 0, 4, { pay: 'cash' }),
        mk(411, 1, { member: 1 }, 1, 6, { pay: 'balance', shipped: true, deliveryRef: 'SJ-0411' }),
        mk(412, 2, { customer: 'Warung Bu Tini' }, 0, 10, { pay: 'cash', shipped: true, received: true, receivedAt: new Date(), deliveryRef: 'SJ-0412', proofRef: 'BKT-0412', receiverName: 'Penerima Demo' }),
      ]);
      await tx.insert(counters).values({ tenantId: tid, key: 'SO', value: 412 });
      // Fisik awal di katalog sudah memperhitungkan pengiriman demo di atas (dibuat konsisten: fisik ≥ reservasi).
      await tx.insert(purchaseOrders).values({ tenantId: tid, depotId: d1!.id, no: 'PO-0086', productId: ps[1]!.id, supplierId: sup1!.id, qty: 5, status: 'approved' });
      await tx.insert(counters).values({ tenantId: tid, key: 'PO', value: 86 });
      const due = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      await tx.insert(payables).values([
        { tenantId: tid, no: 'INV-8790', supplierId: sup1!.id, dueDate: due(-12), amount: 1_500_000 },
        { tenantId: tid, no: 'INV-8831', supplierId: sup1!.id, dueDate: due(6), amount: 4_500_000 },
      ]);
      await tx.insert(counters).values({ tenantId: tid, key: 'inv', value: 8831 });
      void sup2;

      const mail = (r: string) => `${r}.${T.slug}`;
      await tx.insert(users).values([
        { tenantId: tid, username: mail('admin'), name: 'Pengurus ' + T.slug, passwordHash: hash, role: 'tenant_admin' },
        { tenantId: tid, username: mail('petugas'), name: 'Petugas ' + T.depotName, passwordHash: hash, role: 'staff', depotId: d1!.id },
        { tenantId: tid, username: mail('petugas2'), name: 'Petugas ' + T.depot2, passwordHash: hash, role: 'staff', depotId: d2!.id },
        { tenantId: tid, username: mail('anggota'), name: T.names[0]!, passwordHash: hash, role: 'member', memberId: ms[0]!.id },
      ]);
      await tx.insert(commissionPlans).values({ tenantId: tid, rates: [5, 3, 2, 1], reason: 'Tarif awal (kebijakan demo)', createdByName: 'Sistem' });
      await tx.insert(auditLog).values({ tenantId: tid, actorName: 'Seed', message: 'Data demo dimuat' });
    });
  }
}
