import { COMMISSION_RATES } from '@sajadah/shared';
import { useData } from './hooks';

/** Tarif komisi yang berlaku sekarang (penjual, sponsor tingkat 1..3), diatur pengurus; bawaan bila belum termuat. */
export function useRates(): number[] {
  const q = useData<{ rates: number[] }>('/commission-plan');
  return q.data?.rates ?? [...COMMISSION_RATES];
}
export const ratesText = (r: readonly number[]) => r.map((x) => String(+x.toFixed(2))).join('/');
