import { COMMISSION_RATES } from './constants';

/** Masukan simulasi bulanan. Semua angka non-negatif; harga dalam rupiah, volume dalam satuan. */
export interface IncomeInput {
  /** Harga jual (rata-rata produk yang dijual). */
  price: number;
  /** Unit yang terjual atas nama anggota sendiri per bulan. */
  ownPacks: number;
  /** Unit yang terjual oleh downline per bulan: indeks 0 = tingkat 1 (langsung), 1 = tingkat 2, 2 = tingkat 3. */
  downlinePacks: number[];
  /** Biaya pribadi anggota per bulan (transportasi, ongkir, promosi, dll.). */
  costs: number;
  /** Tarif yang berlaku (indeks 0 = penjualan sendiri, 1..3 = downline); bawaan: tarif standar. */
  rates?: readonly number[];
}

export interface IncomeLine {
  /** 0 = penjualan sendiri; 1..3 = downline tingkat 1..3. */
  level: number;
  packs: number;
  turnover: number;
  percent: number;
  commission: number;
}

export interface IncomeResult {
  lines: IncomeLine[];
  turnover: number;
  ownCommission: number;
  networkCommission: number;
  grossCommission: number;
  costs: number;
  /** Komisi kotor dikurangi biaya pribadi; bisa negatif. */
  net: number;
  /** Komisi kotor sebagai persen dari seluruh omzet yang mendasarinya. */
  effectivePercent: number;
  /** Unit penjualan sendiri minimal agar `net` ≥ 0 dengan volume jaringan yang sama; null bila tarif penjual 0. */
  breakEvenOwnPacks: number | null;
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * Simulasi komisi bulanan menurut skema koperasi: penjual menerima tarif tingkat 0 dari nilai pesanan atas namanya,
 * dan sponsor tingkat 1..3 menerima tarif tingkat 1..3 dari pesanan downline-nya. Hanya komisi; margin produk milik koperasi
 * dan bagi hasil laba tidak dihitung di sini. Hasil adalah ilustrasi, bukan janji penghasilan.
 */
export function simulateIncome(input: IncomeInput): IncomeResult {
  const rates = input.rates ?? COMMISSION_RATES;
  const price = nonNeg(input.price);
  const packs = [nonNeg(input.ownPacks), ...rates.slice(1).map((_, i) => nonNeg(input.downlinePacks[i] ?? 0))];
  const lines: IncomeLine[] = packs.map((p, level) => {
    const turnover = p * price;
    const percent = rates[level]!;
    return { level, packs: p, turnover, percent, commission: Math.round((turnover * percent) / 100) };
  });
  const turnover = lines.reduce((s, l) => s + l.turnover, 0);
  const ownCommission = lines[0]!.commission;
  const networkCommission = lines.slice(1).reduce((s, l) => s + l.commission, 0);
  const grossCommission = ownCommission + networkCommission;
  const costs = nonNeg(input.costs);
  const perOwnPack = (price * rates[0]!) / 100;
  return {
    lines, turnover, ownCommission, networkCommission, grossCommission, costs,
    net: grossCommission - costs,
    effectivePercent: turnover > 0 ? (grossCommission / turnover) * 100 : 0,
    breakEvenOwnPacks: perOwnPack > 0 ? Math.max(0, Math.ceil((costs - networkCommission) / perOwnPack)) : null,
  };
}
