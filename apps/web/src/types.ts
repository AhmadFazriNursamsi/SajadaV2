export interface MemberRow { deactivatedAt: string | null; deactivationReason: string | null; referralCode: string; id: string; name: string; area: string; villageId: string | null; familyCode: string | null; memberNo: string | null; placed: boolean; regionPath: string | null; fundingRef: string | null; fundedAt: string | null; activatedAt: string | null; activationRef: string | null; funded: boolean; active: boolean; balance: number; remaining: number; cumulative: number; sponsorId: string | null; username: string | null; resetRequestedAt: string | null }
export interface ProductRow { id: string; depotId: string; sku: string; name: string; physical: number; inTransit: number; safety: number; target: number; moq: number; multiple: number; autoReplenish: boolean; active: boolean; buyPrice: number; sellPrice: number; category: string | null; description: string | null; listPrice: number; coins: number; image: string | null; location: string; reserved: number; available: number; openPo: number; need: number; suggestion: number }
export interface OrderReportSummary { id: string; status: 'ok' | 'open' | 'resolved'; note: string | null; createdAt: string; resolution: string | null; resolvedByName: string | null; resolvedAt: string | null }
export interface OrderReport extends OrderReportSummary { groupNo: string; memberName: string; lines: { productId: string; name: string; sku: string; qtyOrdered: number; qtyReceived: number; issue: string | null; note: string | null }[] }
export interface OrderRow { sellerName: string | null; buyerName: string | null; report: OrderReportSummary | null; groupId: string; groupNo: string; lineNo: number; commissionApprovedById: string | null; commissionApprovedBy: string | null; commissionPaidBy: string | null; commissionRates: number[]; returned: boolean; returnedAt: string | null; returnReason: string | null; returnRequestedAt: string | null; returnRequestReason: string | null; commissionReversedFrom: string | null; id: string; no: string; depotId: string; depotName: string; cancelReason: string | null; sellerId: string; buyerId: string | null; customerName: string | null; customerPhone: string | null; productId: string; qty: number; price: number; total: number; status: 'cancelled' | 'returned' | 'awaiting_approval' | 'awaiting_payment' | 'paid' | 'shipped' | 'received'; pay: 'unpaid' | 'balance' | 'cash'; commission: 'pending' | 'approved' | 'paid' | 'reversed'; commissionEligible: boolean ; shipped: boolean; received: boolean; deliveryRef: string | null; proofRef: string | null; receiverName: string | null; receivedAt: string | null; approvedAt: string | null; approvedBy: string | null; createdAt: string; cancelled: boolean }
export interface PoRow { id: string; no: string; depot: string; product: string; supplier: string | null; qty: number; accepted: number; rejected: number; remaining: number; status: 'draft' | 'approved' | 'partial' | 'done'; promisedDate: string | null; invoiced: boolean }
export interface PayableRow { id: string; no: string; supplier: string | null; poNo: string | null; dueDate: string; amount: number; paid: number; outstanding: number; status: 'paid' | 'overdue' | 'open' }
export interface ReportRow { id: string; no: string; member: string; memberId: string; period: string; ref: string; profit: number; status: 'draft' | 'settled'; memberShare: number; investorShare: number; gold: { amount: number; rest: number; percent: number } | null }
export interface Overview {
  tenant: { name: string; slug: string; depots: { id: string; name: string }[] };
  kpis: { memberBalance: number; activeMembers: number; availableStock: number; lowStockProducts: number; salesValue: number; orderCount: number; pendingCommission: number; pendingCommissionCount: number; rewardBalance: number; coinBalance: number };
  actions: { awaitingApproval: number; draftPo: number; paidNotShipped: number; commissionsToApprove: number; stockRequests: number; withdrawalsPending: number; redemptionsPending: number };
  sales7: { date: string; packs: number }[];
  activity: { at: string; actor: string | null; message: string }[];
}
export const orderLabel = { cancelled: ['Dibatalkan', 'bad'], returned: ['Diretur', 'bad'], awaiting_approval: ['Menunggu persetujuan toko', 'warn'], awaiting_payment: ['Menunggu pembayaran', 'warn'], paid: ['Lunas', 'warn'], shipped: ['Dikirim', 'warn'], received: ['Diterima', 'ok'] } as const;
export const poLabel = { draft: ['Draf', 'warn'], approved: ['Disetujui', 'ok'], partial: ['Terima sebagian', 'warn'], done: ['Selesai', 'ok'] } as const;

export interface RegionRow { id: string; level: 'province' | 'regency' | 'district' | 'village'; parentId: string | null; code: string; name: string; path: string[]; members: number; children: number; sourceCode: string | null }
export interface Funding {
  investors: { id: string; code: string; name: string; sharePercent: number; allocated: number; members: number }[];
  members: { id: string; name: string; funded: boolean; fundingRef: string | null; fundedAt: string | null; total: number; perInvestor: { code: string; amount: number }[] }[];
}


export interface MasterItem { code: string; name: string; localCode: string }

export interface DepotRow { id: string; name: string; address: string | null; lat: number | null; lng: number | null; active: boolean; physical: number; awaitingApproval: number; staff: { name: string; username: string }[] }

export interface StaffRow { id: string; name: string; username: string; depotId: string | null; depotName: string | null; mustChangePassword: boolean; resetRequestedAt: string | null; createdAt: string }

export type CountStatus = 'draft' | 'submitted' | 'approved' | 'cancelled';
export interface CountRow {
  id: string; no: string; depotId: string; depotName: string; status: CountStatus; note: string | null; createdAt: string; createdByName: string; createdById: string;
  needsAdmin: boolean; submittedByName: string | null; approvedByName: string | null; approvedAt: string | null; lineCount: number; countedCount: number; varianceQty: number; varianceValue: number;
}
export interface CountLine {
  id: string; productId: string; sku: string; name: string; systemQty: number; countedQty: number | null; reason: string | null; note: string | null; unitCost: number;
  variance: number | null; value: number | null; reserved: number; current: number; moved: number; postedDelta: number | null;
}
export interface CountDetail extends CountRow {
  submittedById: string | null; returnNote: string | null; cancelReason: string | null; lines: CountLine[];
  needsAdmin: boolean; exceedReason: string | null; canApprove: boolean; policy: { tolerancePct: number; toleranceValue: number };
  totals: { lines: number; counted: number; varianceQty: number; varianceValue: number; gain: number; loss: number };
}
export interface Movement { id: string; at: string; type: string; qty: number; balanceAfter: number; refNo: string | null; note: string | null; actor: string | null }

export interface CentralRow extends Omit<ProductRow, 'depotId' | 'physical' | 'inTransit' | 'location' | 'reserved' | 'available' | 'openPo' | 'need' | 'suggestion'> { central: number; onTheWay: number; atDepots: number; byDepot: Record<string, { physical: number; inTransit: number }> }
export type ShipmentStatus = 'in_transit' | 'received' | 'cancelled';
export interface ShipmentRow {
  id: string; no: string; depotId: string; depotName: string; status: ShipmentStatus; note: string | null; createdByName: string; createdAt: string;
  receivedAt: string | null; receivedByName: string | null; receiveNote: string | null; cancelledAt: string | null; cancelledByName: string | null; cancelReason: string | null;
  lines: { productId: string; name: string; sku: string; qty: number; qtyReceived: number | null; issue: string | null; issueNote: string | null }[]; totalQty: number; hasIssue: boolean;
  /** Permintaan toko yang dijawab kiriman ini (bila ada). */
  request: { no: string; note: string | null; lines: { productId: string; qty: number; qtySent: number }[] } | null;
}

export type RequestStatus = 'pending' | 'sent' | 'rejected' | 'cancelled';
export interface StockRequestRow { invoiceNo: string | null;
  id: string; no: string; depotId: string; depotName: string; status: RequestStatus; note: string | null; createdByName: string; createdAt: string;
  decidedAt: string | null; decidedByName: string | null; decisionNote: string | null; shipmentNo: string | null; shipmentStatus: ShipmentStatus | null;
  lines: { productId: string; name: string; sku: string; qty: number; qtySent: number; central?: number }[]; totalQty: number; totalSent: number;
}
