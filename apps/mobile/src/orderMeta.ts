import type { Tone } from './theme';

export interface OrderLine { productId: string; product: string; qty: number; price: number; total: number }
export interface OrderGroup {
  id: string; groupId: string; no: string; status: string; depot: string; createdAt: string; total: number; lines: OrderLine[];
  role: 'seller' | 'buyer'; selfOrder: boolean; buyerName: string | null; customerOrder: boolean; canPay: boolean; canCheck: boolean;
  approvedAt: string | null; approvedBy: string | null; pay: 'unpaid' | 'balance' | 'cash'; shipped: boolean; deliveryRef: string | null;
  received: boolean; receivedAt: string | null; receiverName: string | null; proofRef: string | null; cancelReason: string | null;
  report: { status: 'ok' | 'open' | 'resolved'; resolution: string | null; resolvedByName: string | null; verifyStatus: 'pending' | 'valid' | 'invalid'; verifyNote: string | null } | null;
}

export const STATUS: Record<string, [string, Tone]> = {
  awaiting_approval: ['Menunggu toko', 'warn'], awaiting_payment: ['Belum bayar', 'warn'], paid: ['Disiapkan', 'warn'],
  shipped: ['Dikirim', 'warn'], received: ['Selesai', 'ok'], cancelled: ['Dibatalkan', 'bad'], returned: ['Diretur', 'bad'],
};

const pad = (n: number) => String(n).padStart(2, '0');
/** "8 Okt 2026 - 17:39" */
export function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })} - ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
