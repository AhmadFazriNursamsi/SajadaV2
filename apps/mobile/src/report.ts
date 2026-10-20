export interface ReportDay { date: string; ownOrders: number; ownPacks: number; ownTurnover: number; ownCommission: number; networkOrders: number; networkTurnover: number; networkCommission: number; total: number }
export interface SalesReport {
  timezone: string;
  days: ReportDay[];
  period: { days: number; ownOrders: number; ownPacks: number; ownTurnover: number; ownCommission: number; networkCommission: number; total: number; activeDays: number };
  balance: { pending: number; approved: number; paid: number; clawback: number; available: number };
  inProgress: { orders: number; potentialCommission: number };
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
/** "2026-10-16" → "Jumat, 16 Okt" (kalender WIB dari server, tanpa konversi zona waktu lagi). */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${BULAN[m - 1]}`;
}
