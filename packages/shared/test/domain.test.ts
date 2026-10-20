import { describe, expect, it } from 'vitest';
import { buildMemberNumber, commissionLines, createsSponsorCycle, shouldAutoReplenish, splitProfit, uplineChain, profitReportSchema, simulateIncome, planInstallment, INSTALLMENT_AMOUNT, INSTALLMENT_DAYS, terbilangRupiah } from '../src';

describe('splitProfit', () => {
  it('fase pemulihan 20/80 sampai sisa penyertaan tertutup', () => {
    const r = splitProfit(12_500_000, 0, 20_000_000);
    // 12.5jt/0.8 = 15.625jt masuk fase pemulihan; sisa 4.375jt ke tarif marginal 25%
    expect(r.remainingAfter).toBe(0);
    expect(r.member + r.investor).toBe(20_000_000);
    expect(r.member).toBe(Math.round(15_625_000 * 0.2 + 4_375_000 * 0.25));
    expect(r.cumulativeAfter).toBe(4_375_000);
  });
  it('seluruh laba di fase pemulihan bila kecil', () => {
    const r = splitProfit(12_500_000, 0, 1_000_000);
    expect(r).toMatchObject({ member: 200_000, investor: 800_000, remainingAfter: 12_500_000 - 800_000 });
  });
  it('tarif marginal lintas tingkat', () => {
    const r = splitProfit(0, 8_000_000, 5_000_000); // 2jt @25% + 3jt @30%
    expect(r.member).toBe(500_000 + 900_000);
    expect(r.rows).toHaveLength(2);
  });
  it('menolak nilai negatif', () => expect(() => splitProfit(0, 0, -1)).toThrow());
});

describe('persediaan', () => {
  const base = { physical: 9, safety: 5, target: 20, inTransit: 3, moq: 10, multiple: 5, autoReplenish: true, active: true };
  it('contoh prototipe: produk B', () => {
    // tersedia 4 <= safety 5; kebutuhan = 20-4-3-5(PO jalan) = 8 -> MOQ 10
    expect(shouldAutoReplenish(base, 5, 5)).toBe(10);
  });
  it('tidak membuat PO bila stok di atas safety atau aturan jeda', () => {
    expect(shouldAutoReplenish(base, 0, 0)).toBe(0);
    expect(shouldAutoReplenish({ ...base, autoReplenish: false }, 5, 0)).toBe(0);
  });
});

describe('jaringan', () => {
  const sp: Record<string, string | null> = { a: 'b', b: 'c', c: 'd', d: 'e', e: null };
  it('rantai upline maksimal 3', () => expect(uplineChain('a', (i) => sp[i])).toEqual(['b', 'c', 'd']));
  it('deteksi siklus', () => {
    expect(createsSponsorCycle('c', 'a', (i) => sp[i])).toBe(true);
    expect(createsSponsorCycle('a', 'e', (i) => sp[i])).toBe(false);
  });
  it('komisi 5/3/2/1', () => {
    const l = commissionLines('a', ['b', 'c', 'd'], 1_000_000);
    expect(l.map((x) => x.amount)).toEqual([50_000, 30_000, 20_000, 10_000]);
  });
});

describe('nomor anggota & validasi', () => {
  it('format PPKKCCYYNNNNNN', () => {
    expect(buildMemberNumber({ province: '32', regency: '01', district: '01', year: 2026, sequence: 1 })).toBe('32010126000001');
  });
  it('laporan rugi ditolak', () => {
    const v = { memberId: crypto.randomUUID(), period: '2026-10', ref: 'LAP', revenue: 100, cost: 200 };
    expect(profitReportSchema.safeParse(v).success).toBe(false);
  });
});

describe('simulateIncome', () => {
  it('komisi sendiri 5% dan jaringan 3/2/1% dari omzet masing-masing tingkat', () => {
    const r = simulateIncome({ price: 100_000, ownPacks: 20, downlinePacks: [10, 10, 10], costs: 0 });
    expect(r.ownCommission).toBe(100_000);            // 20 × 100rb × 5%
    expect(r.lines.map((l) => l.commission)).toEqual([100_000, 30_000, 20_000, 10_000]);
    expect(r.networkCommission).toBe(60_000);
    expect(r.grossCommission).toBe(160_000);
    expect(r.turnover).toBe(5_000_000);
    expect(r.effectivePercent).toBeCloseTo(3.2, 5);
  });
  it('biaya mengurangi komisi; hasil bisa negatif', () => {
    const r = simulateIncome({ price: 100_000, ownPacks: 20, downlinePacks: [], costs: 250_000 });
    expect(r.net).toBe(100_000 - 250_000);
    expect(r.net).toBeLessThan(0);
  });
  it('titik impas: pak sendiri minimal agar bersih ≥ 0', () => {
    const base = { price: 100_000, downlinePacks: [10, 0, 0], costs: 200_000 };
    const r = simulateIncome({ ...base, ownPacks: 0 });
    // jaringan 10×100rb×3% = 30rb; perlu (200rb−30rb)/5rb = 34 pak
    expect(r.breakEvenOwnPacks).toBe(34);
    expect(simulateIncome({ ...base, ownPacks: 34 }).net).toBeGreaterThanOrEqual(0);
    expect(simulateIncome({ ...base, ownPacks: 33 }).net).toBeLessThan(0);
    expect(simulateIncome({ ...base, costs: 0, ownPacks: 0 }).breakEvenOwnPacks).toBe(0);
  });
  it('masukan tidak valid dianggap 0 (tanpa NaN)', () => {
    const r = simulateIncome({ price: NaN, ownPacks: -5, downlinePacks: [Infinity], costs: -1 });
    expect(r.grossCommission).toBe(0); expect(r.net).toBe(0); expect(r.effectivePercent).toBe(0);
  });
});

describe('tagihan harian', () => {
  it('saldo cukup: potong Rp30.000 penuh, tanpa tunggakan', () => {
    expect(planInstallment({ balance: 50_000, arrears: 0, daysCounted: 0 })).toEqual({ counted: true, due: 30_000, paid: 30_000, arrears: 0 });
  });
  it('saldo kurang: hari tetap dihitung, kekurangan jadi tunggakan; tunggakan lama ditagih bersama', () => {
    expect(planInstallment({ balance: 20_000, arrears: 0, daysCounted: 3 })).toEqual({ counted: true, due: 30_000, paid: 20_000, arrears: 10_000 });
    expect(planInstallment({ balance: 20_000, arrears: 10_000, daysCounted: 4 })).toEqual({ counted: true, due: 40_000, paid: 20_000, arrears: 20_000 });
    expect(planInstallment({ balance: 0, arrears: 0, daysCounted: 1 }).arrears).toBe(30_000);
  });
  it('setelah 730 hari terhitung hanya tunggakan yang ditagih; lunas bila tak ada tunggakan', () => {
    expect(INSTALLMENT_DAYS * INSTALLMENT_AMOUNT).toBe(21_900_000);
    expect(planInstallment({ balance: 100_000, arrears: 15_000, daysCounted: 730 })).toEqual({ counted: false, due: 15_000, paid: 15_000, arrears: 0 });
    expect(planInstallment({ balance: 100_000, arrears: 0, daysCounted: 730 })).toEqual({ counted: false, due: 0, paid: 0, arrears: 0 });
    expect(planInstallment({ balance: -5, arrears: 0, daysCounted: 729 }).paid).toBe(0);
  });
});

describe('terbilangRupiah', () => {
  it('mengeja angka rupiah', () => {
    expect(terbilangRupiah(0)).toBe('nol rupiah');
    expect(terbilangRupiah(11_000)).toBe('sebelas ribu rupiah');
    expect(terbilangRupiah(1_250_000)).toBe('satu juta dua ratus lima puluh ribu rupiah');
    expect(terbilangRupiah(5_260_000)).toBe('lima juta dua ratus enam puluh ribu rupiah');
    expect(terbilangRupiah(21_900_000)).toBe('dua puluh satu juta sembilan ratus ribu rupiah');
    expect(terbilangRupiah(2_000_100)).toBe('dua juta seratus rupiah');
  });
});
