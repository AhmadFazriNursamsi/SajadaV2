import { MARGINAL_TIERS, RECOVERY_MEMBER_SHARE } from './constants';

export interface SplitRow {
  name: string;
  amount: number;
  member: number;
  investor: number;
}
export interface SplitResult {
  rows: SplitRow[];
  member: number;
  investor: number;
  remainingAfter: number;
  cumulativeAfter: number;
}

/**
 * Bagi hasil bertingkat.
 * Fase pemulihan: 20% anggota / 80% investor sampai bagian investor menutup `remaining`.
 * Setelah pulih: tarif marginal berdasarkan laba kumulatif pasca pemulihan (`cumulative`).
 * Semua nilai dalam IDR utuh; sisa pembulatan dibebankan ke investor agar total tetap sama.
 */
export function splitProfit(remaining: number, cumulative: number, profit: number): SplitResult {
  if (profit < 0 || remaining < 0 || cumulative < 0) throw new RangeError('Nilai tidak boleh negatif');
  const investorShare = 1 - RECOVERY_MEMBER_SHARE;
  const phase = Math.min(profit, remaining / investorShare);
  const post = profit - phase;
  const rows: SplitRow[] = [];
  let member = phase * RECOVERY_MEMBER_SHARE;
  let investor = phase * investorShare;
  if (phase > 0) rows.push({ name: 'Fase pemulihan 20/80', amount: phase, member: phase * RECOVERY_MEMBER_SHARE, investor: phase * investorShare });
  if (post > 0) {
    for (const [from, to, rate] of MARGINAL_TIERS) {
      const x = Math.max(0, Math.min(cumulative + post, to) - Math.max(cumulative, from));
      if (x <= 0) continue;
      member += x * rate;
      investor += x * (1 - rate);
      rows.push({ name: `Pasca pemulihan ${Math.round(rate * 100)}/${Math.round((1 - rate) * 100)}`, amount: x, member: x * rate, investor: x * (1 - rate) });
    }
  }
  const memberR = Math.round(member);
  return {
    rows,
    member: memberR,
    investor: Math.round(profit) - memberR,
    remainingAfter: Math.max(0, Math.round(remaining - phase * investorShare)),
    cumulativeAfter: Math.round(cumulative + post),
  };
}
