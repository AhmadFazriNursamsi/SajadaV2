import { COMMISSION_RATES } from '@sajadah/shared';
import { useData } from './hooks';

export interface PlanNow { rates: number[]; since: string | null; by: string | null; reason: string; /** Batas dari kebijakan pusat. */ limits?: { rate: number; total: number } }

/** Tarif komisi yang berlaku sekarang (penjual, sponsor tingkat 1..3), dari pengaturan pengurus. */
export function useRates(): number[] {
  const q = useData<PlanNow>('/commission-plan');
  return q.data?.rates ?? [...COMMISSION_RATES];
}
/** "5/3/2/1" — tanpa nol di belakang koma. */
export const ratesText = (r: readonly number[]) => r.map((x) => String(+x.toFixed(2))).join('/');
