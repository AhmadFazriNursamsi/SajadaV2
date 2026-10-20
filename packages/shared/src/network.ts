import { COMMISSION_RATES, MAX_UPLINE_DEPTH } from './constants';

/** Rantai sponsor dari penjual ke atas (maks. 3 upline). `sponsorOf` mengembalikan id sponsor atau null. */
export function uplineChain(sellerId: string, sponsorOf: (id: string) => string | null | undefined): string[] {
  const chain: string[] = [];
  let cur = sponsorOf(sellerId) ?? null;
  while (cur && chain.length < MAX_UPLINE_DEPTH && !chain.includes(cur) && cur !== sellerId) {
    chain.push(cur);
    cur = sponsorOf(cur) ?? null;
  }
  return chain;
}

/** Apakah menetapkan `newSponsorId` sebagai sponsor `memberId` membentuk siklus. */
export function createsSponsorCycle(
  memberId: string,
  newSponsorId: string | null,
  sponsorOf: (id: string) => string | null | undefined,
): boolean {
  let cur = newSponsorId;
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur === memberId) return true;
    cur = sponsorOf(cur) ?? null;
  }
  return false;
}

export interface CommissionLine {
  memberId: string;
  level: number; // 0 = penjual
  percent: number;
  amount: number;
}

/** Komisi per penerima. `rates` = tarif yang dibekukan pada pesanan itu (indeks 0 = penjual, 1..3 = upline); bawaan: tarif standar. */
export function commissionLines(sellerId: string, uplines: string[], orderValue: number, rates: readonly number[] = COMMISSION_RATES): CommissionLine[] {
  return [sellerId, ...uplines].slice(0, rates.length).map((memberId, level) => ({
    memberId,
    level,
    percent: rates[level]!,
    amount: Math.round((orderValue * rates[level]!) / 100),
  }));
}

export const totalCommissionPercent = COMMISSION_RATES.reduce((a, b) => a + b, 0);
