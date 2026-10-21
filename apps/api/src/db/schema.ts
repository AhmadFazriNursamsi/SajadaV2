import { relations, sql } from 'drizzle-orm';
import {
  bigint, boolean, check, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const money = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0);
const pk = () => uuid('id').primaryKey().defaultRandom();
const tenantRef = () => uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('role', ['tenant_admin', 'staff', 'member']);
export const payStatusEnum = pgEnum('pay_status', ['unpaid', 'balance', 'cash']);
export const commissionStatusEnum = pgEnum('commission_status', ['pending', 'approved', 'paid', 'reversed']);
export const poStatusEnum = pgEnum('po_status', ['draft', 'approved', 'partial', 'done']);
export const reportStatusEnum = pgEnum('report_status', ['draft', 'settled']);
export const stockMoveTypeEnum = pgEnum('stock_move_type', ['opening', 'receipt', 'po_receipt', 'shipment', 'return', 'transfer_in', 'opname']);
export const centralMoveTypeEnum = pgEnum('central_move_type', ['opening', 'receipt', 'shipment', 'shipment_cancel']);
export const stockRequestStatusEnum = pgEnum('stock_request_status', ['pending', 'sent', 'rejected', 'cancelled']);
export const shipmentStatusEnum = pgEnum('shipment_status', ['in_transit', 'received', 'cancelled']);
export const stockCountStatusEnum = pgEnum('stock_count_status', ['draft', 'submitted', 'approved', 'cancelled']);
export const regionLevelEnum = pgEnum('region_level', ['province', 'regency', 'district', 'village']);

/** Tenant = koperasi. Kas dicatat per tenant; kode wilayah 2 digit dipakai untuk nomor anggota. */
export const tenants = pgTable('tenants', {
  id: pk(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  cash: money('cash'),
  /** Toleransi selisih opname: di atas ambang ini, diberi tanda "di atas toleransi" agar diperiksa teliti sebelum disetujui pengurus. */
  opnameTolerancePct: integer('opname_tolerance_pct').notNull().default(5),
  opnameToleranceValue: bigint('opname_tolerance_value', { mode: 'number' }).notNull().default(500000),
  /** Profil badan usaha untuk kop invoice (boleh kosong). */
  legalName: text('legal_name'),
  address: text('address'),
  npwp: text('npwp'),
  phone: text('phone'),
  signatory: text('signatory'),
  signatoryTitle: text('signatory_title'),
  createdAt: createdAt(),
});

export const members = pgTable('members', {
  id: pk(),
  tenantId: tenantRef(),
  name: text('name').notNull(),
  area: text('area').notNull(),
  familyCode: text('family_code'),
  memberNo: text('member_no'),
  /** Kelurahan/desa penempatan (pohon wilayah tenant). Null = belum ditempatkan. */
  villageId: uuid('village_id'),
  funded: boolean('funded').notNull().default(false),
  fundingRef: text('funding_ref'),
  fundedAt: date('funded_at', { mode: 'string' }),
  active: boolean('active').notNull().default(false),
  activatedAt: date('activated_at', { mode: 'string' }),
  activationRef: text('activation_ref'),
  /** Snapshot anggaran awal saat aktivasi; perubahan anggaran kelak tidak mengubah aktivasi lama. */
  budgetSnapshot: jsonb('budget_snapshot').$type<Record<string, number>>(),
  balance: money('balance'),
  /** Saldo penarikan: 20% dari belanja sendiri yang sudah diterima; bisa ditarik atau dipindah ke saldo belanja. */
  rewardBalance: money('reward_balance'),
  avatar: text('avatar'),
  coinBalance: bigint('coin_balance', { mode: 'number' }).notNull().default(0),
  /** Tagihan harian: jumlah hari aktif yang sudah dihitung (maks 730) dan tunggakan yang belum terpotong. */
  installmentDays: integer('installment_days').notNull().default(0),
  installmentArrears: bigint('installment_arrears', { mode: 'number' }).notNull().default(0),
  remaining: money('remaining'),
  cumulative: money('cumulative'),
  sponsorId: uuid('sponsor_id'),
  /** Kontak yang diisi anggota sendiri di aplikasi (Profil). */
  phone: text('phone'),
  address: text('address'),
  /** Anggota nonaktif (keluar): tidak bisa masuk, memesan, atau menjual; riwayat tetap tersimpan. */
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  deactivationReason: text('deactivation_reason'),
  deactivatedBy: text('deactivated_by'),
  /** Kode referal anggota (8 karakter); diberikan ke calon anggota agar sponsor otomatis terisi saat pendaftaran. */
  referralCode: text('referral_code').notNull().default(sql`upper(substr(md5(gen_random_uuid()::text), 1, 8))`),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('members_tenant_no_uq').on(t.tenantId, t.memberNo),
  uniqueIndex('members_tenant_referral_uq').on(t.tenantId, t.referralCode),
  index('members_tenant_idx').on(t.tenantId),
]);

/** Toko = gudang/titik layanan koperasi. Stok, pesanan, dan PO dipisah per toko. */
export const depots = pgTable('depots', {
  id: pk(),
  tenantId: tenantRef(),
  name: text('name').notNull(),
  address: text('address'),
  /** Koordinat toko (opsional) untuk mengurutkan toko terdekat di aplikasi anggota. */
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('depots_tenant_name_uq').on(t.tenantId, t.name)]);

export const users = pgTable('users', {
  id: pk(),
  tenantId: tenantRef(),
  /** Nama login, dibuat dari nama pemilik (mis. budi.santoso); unik per tenant. */
  username: text('username').notNull(),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  /** Diisi saat pengguna menekan "Lupa kata sandi"; dibersihkan saat pengurus mengatur ulang sandi. */
  resetRequestedAt: timestamp('reset_requested_at', { withTimezone: true }),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull(),
  memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
  /** Petugas toko hanya bekerja di toko ini; kosong = semua toko (pengurus). */
  depotId: uuid('depot_id').references(() => depots.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_tenant_username_uq').on(t.tenantId, t.username), uniqueIndex('users_member_uq').on(t.memberId)]);

export const products = pgTable('products', {
  id: pk(),
  tenantId: tenantRef(),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  safety: integer('safety').notNull().default(0),
  target: integer('target').notNull().default(0),
  moq: integer('moq').notNull().default(1),
  multiple: integer('multiple').notNull().default(1),
  autoReplenish: boolean('auto_replenish').notNull().default(true),
  active: boolean('active').notNull().default(true),
  buyPrice: money('buy_price'),
  sellPrice: money('sell_price'),
  /** Tampilan toko anggota: kategori, deskripsi, harga normal (0 = tanpa coret) dan nama berkas foto. */
  category: text('category'),
  description: text('description'),
  listPrice: money('list_price'),
  image: text('image'),
  /** Koin yang didapat anggota per satuan produk saat belanja sendiri diterima. */
  coins: integer('coins').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('products_tenant_sku_uq').on(t.tenantId, t.sku)]);

/** Stok fisik & transfer masuk per toko per produk. */
export const depotStock = pgTable('depot_stock', {
  depotId: uuid('depot_id').notNull().references(() => depots.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  physical: integer('physical').notNull().default(0),
  inTransit: integer('in_transit').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.depotId, t.productId] })]);

/** Kartu stok: setiap perubahan stok fisik tercatat (jumlah +/-, saldo sesudahnya, referensi dokumen, pelaku). */
export const stockMovements = pgTable('stock_movements', {
  id: pk(),
  tenantId: tenantRef(),
  depotId: uuid('depot_id').notNull().references(() => depots.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  type: stockMoveTypeEnum('type').notNull(),
  qty: integer('qty').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  refNo: text('ref_no'),
  note: text('note'),
  actorName: text('actor_name'),
  createdAt: createdAt(),
}, (t) => [index('stock_movements_card_idx').on(t.depotId, t.productId, t.createdAt)]);

/** Stok gudang pusat per produk (dikelola Admin pusat). Kirim ke toko mengurangi stok ini. */
export const centralStock = pgTable('central_stock', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  physical: integer('physical').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.productId] })]);

/** Kartu stok gudang pusat. */
export const centralMovements = pgTable('central_movements', {
  id: pk(),
  tenantId: tenantRef(),
  productId: uuid('product_id').notNull().references(() => products.id),
  type: centralMoveTypeEnum('type').notNull(),
  qty: integer('qty').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  refNo: text('ref_no'),
  note: text('note'),
  actorName: text('actor_name'),
  createdAt: createdAt(),
}, (t) => [index('central_movements_card_idx').on(t.tenantId, t.productId, t.createdAt)]);

/** Pengiriman pusat → toko (KRM-0001…): dalam perjalanan sampai petugas/pengurus toko menerimanya. */
export const shipments = pgTable('shipments', {
  id: pk(),
  tenantId: tenantRef(),
  no: text('no').notNull(),
  depotId: uuid('depot_id').notNull().references(() => depots.id),
  status: shipmentStatusEnum('status').notNull().default('in_transit'),
  note: text('note'),
  createdByName: text('created_by_name').notNull(),
  createdAt: createdAt(),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  receivedByName: text('received_by_name'),
  receiveNote: text('receive_note'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledByName: text('cancelled_by_name'),
  cancelReason: text('cancel_reason'),
}, (t) => [uniqueIndex('shipments_tenant_no_uq').on(t.tenantId, t.no), index('shipments_depot_idx').on(t.depotId, t.status)]);

/** Permintaan stok toko ke pusat (REQ-0001…): petugas meminta, pengurus mengirim (penuh/sebagian) atau menolak. */
export const stockRequests = pgTable('stock_requests', {
  id: pk(),
  tenantId: tenantRef(),
  no: text('no').notNull(),
  depotId: uuid('depot_id').notNull().references(() => depots.id),
  status: stockRequestStatusEnum('status').notNull().default('pending'),
  note: text('note'),
  createdById: uuid('created_by_id'),
  createdByName: text('created_by_name').notNull(),
  createdAt: createdAt(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedByName: text('decided_by_name'),
  decisionNote: text('decision_note'),
  shipmentId: uuid('shipment_id').references(() => shipments.id),
  /** Nomor invoice permintaan ke pusat (INV-0001), diterbitkan saat permintaan dibuat. */
  invoiceNo: text('invoice_no'),
}, (t) => [uniqueIndex('stock_requests_tenant_no_uq').on(t.tenantId, t.no), index('stock_requests_depot_idx').on(t.depotId, t.status)]);

export const stockRequestLines = pgTable('stock_request_lines', {
  id: pk(),
  requestId: uuid('request_id').notNull().references(() => stockRequests.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  qty: integer('qty').notNull(),
  qtySent: integer('qty_sent').notNull().default(0),
  /** Harga satuan saat permintaan dibuat (0 = permintaan lama, pakai harga jual sekarang). */
  unitPrice: bigint('unit_price', { mode: 'number' }).notNull().default(0),
}, (t) => [index('stock_request_lines_idx').on(t.requestId)]);

/** Hasil pemeriksaan anggota atas barang pesanan yang dikirim: sesuai (ok) atau dilaporkan ke toko (open → resolved). */
export const orderReports = pgTable('order_reports', {
  id: pk(),
  tenantId: tenantRef(),
  groupId: uuid('group_id').notNull(),
  groupNo: text('group_no').notNull(),
  depotId: uuid('depot_id').notNull().references(() => depots.id),
  memberId: uuid('member_id').notNull().references(() => members.id),
  status: text('status').notNull(), // 'ok' | 'open' | 'resolved'
  note: text('note'),
  createdAt: createdAt(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedByName: text('resolved_by_name'),
  resolution: text('resolution'),
}, (t) => [index('order_reports_group_idx').on(t.tenantId, t.groupId, t.createdAt), index('order_reports_depot_idx').on(t.depotId, t.status)]);

export const orderReportLines = pgTable('order_report_lines', {
  id: pk(),
  reportId: uuid('report_id').notNull().references(() => orderReports.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  qtyOrdered: integer('qty_ordered').notNull(),
  qtyReceived: integer('qty_received').notNull(),
  issue: text('issue'),
  note: text('note'),
}, (t) => [index('order_report_lines_idx').on(t.reportId)]);

export const shipmentLines = pgTable('shipment_lines', {
  id: pk(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  qty: integer('qty').notNull(),
  /** Hasil pemeriksaan di toko: jumlah yang benar-benar diterima (kosong sampai diterima). */
  qtyReceived: integer('qty_received'),
  issue: text('issue'),
  issueNote: text('issue_note'),
}, (t) => [index('shipment_lines_idx').on(t.shipmentId)]);

/** Dokumen stok opname: hitung fisik per toko → ajukan → disetujui orang lain → penyesuaian diposting ke stok. */
export const stockCounts = pgTable('stock_counts', {
  id: pk(),
  tenantId: tenantRef(),
  depotId: uuid('depot_id').notNull().references(() => depots.id),
  no: text('no').notNull(),
  status: stockCountStatusEnum('status').notNull().default('draft'),
  note: text('note'),
  createdById: uuid('created_by_id').notNull(),
  createdByName: text('created_by_name').notNull(),
  createdAt: createdAt(),
  submittedById: uuid('submitted_by_id'),
  submittedByName: text('submitted_by_name'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  approvedById: uuid('approved_by_id'),
  approvedByName: text('approved_by_name'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  /** Alasan penyetuju mengembalikan ke draf untuk dihitung ulang. */
  returnNote: text('return_note'),
  cancelReason: text('cancel_reason'),
  /** Dibekukan saat diajukan: selisih melebihi toleransi sehingga perlu persetujuan pengurus. */
  needsAdmin: boolean('needs_admin').notNull().default(false),
  exceedReason: text('exceed_reason'),
}, (t) => [uniqueIndex('stock_counts_tenant_no_uq').on(t.tenantId, t.no), index('stock_counts_depot_idx').on(t.depotId, t.status)]);

export const stockCountLines = pgTable('stock_count_lines', {
  id: pk(),
  countId: uuid('count_id').notNull().references(() => stockCounts.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  /** Stok sistem saat opname dimulai (snapshot). */
  systemQty: integer('system_qty').notNull(),
  /** Hasil hitung fisik; null = belum dihitung. */
  countedQty: integer('counted_qty'),
  reason: text('reason'),
  note: text('note'),
  /** Harga beli saat opname dimulai, untuk menilai selisih. */
  unitCost: money('unit_cost'),
  /** Penyesuaian yang benar-benar diposting (hitung − snapshot). */
  postedDelta: integer('posted_delta'),
}, (t) => [uniqueIndex('stock_count_lines_uq').on(t.countId, t.productId)]);

export const orders = pgTable('orders', {
  id: pk(),
  tenantId: tenantRef(),
  no: text('no').notNull(),
  /** Satu checkout dengan beberapa produk = satu pesanan: baris-barisnya berbagi groupId/groupNo (nomor yang ditampilkan). */
  groupId: uuid('group_id').notNull(),
  groupNo: text('group_no').notNull(),
  lineNo: smallint('line_no').notNull().default(1),
  depotId: uuid('depot_id').notNull().references(() => depots.id),
  sellerId: uuid('seller_id').notNull().references(() => members.id),
  /** Pembeli anggota; kosong bila penjualan ke pelanggan umum (lihat customerName). */
  buyerId: uuid('buyer_id').references(() => members.id),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  productId: uuid('product_id').notNull().references(() => products.id),
  qty: integer('qty').notNull(),
  /** Snapshot harga & rantai upline saat checkout. */
  price: money('price'),
  uplines: jsonb('uplines').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  pay: payStatusEnum('pay').notNull().default('unpaid'),
  shipped: boolean('shipped').notNull().default(false),
  received: boolean('received').notNull().default(false),
  /** Imbalan saldo penarikan yang sudah dikreditkan untuk baris ini (0 = belum). Mencegah kredit ganda. */
  reward: money('reward'),
  coins: bigint('coins', { mode: 'number' }).notNull().default(0),
  cancelled: boolean('cancelled').notNull().default(false),
  cancelReason: text('cancel_reason'),
  deliveryRef: text('delivery_ref'),
  proofRef: text('proof_ref'),
  receiverName: text('receiver_name'),
  commission: commissionStatusEnum('commission').notNull().default('pending'),
  /** Tarif komisi yang berlaku saat pesanan dibuat (penjual, upline 1..3); perubahan tarif tidak mengubah pesanan lama. */
  commissionRates: jsonb('commission_rates').$type<number[]>().notNull().default(sql`'[5,3,2,1]'::jsonb`),
  /** Jejak persetujuan/pembayaran komisi: penyetuju dan pembayar harus orang berbeda. */
  commissionApprovedById: uuid('commission_approved_by_id'),
  commissionApprovedBy: text('commission_approved_by'),
  commissionApprovedAt: timestamp('commission_approved_at', { withTimezone: true }),
  commissionPaidBy: text('commission_paid_by'),
  commissionPaidAt: timestamp('commission_paid_at', { withTimezone: true }),
  /** Status komisi sebelum dibalik karena retur (paid = sudah dibayar, perlu ditagihkan kembali). */
  commissionReversedFrom: commissionStatusEnum('commission_reversed_from'),
  /** Saat barang dikonfirmasi diterima; dasar jendela retur. */
  receivedAt: timestamp('received_at', { withTimezone: true }),
  /** Anggota mengajukan retur; petugas toko memprosesnya. */
  returnRequestedAt: timestamp('return_requested_at', { withTimezone: true }),
  returnRequestReason: text('return_request_reason'),
  returned: boolean('returned').notNull().default(false),
  returnedAt: timestamp('returned_at', { withTimezone: true }),
  returnReason: text('return_reason'),
  returnedBy: text('returned_by'),
  /** Disetujui toko. Kosong = menunggu persetujuan (pesanan dari anggota); pesanan yang dibuat petugas langsung disetujui. */
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('orders_tenant_no_uq').on(t.tenantId, t.no), index('orders_group_idx').on(t.tenantId, t.groupId), index('orders_product_idx').on(t.productId), check('orders_buyer_chk', sql`${t.buyerId} is not null or ${t.customerName} is not null`)]);

/** Riwayat tarif komisi per tenant; tarif berlaku = baris terbaru. Pesanan membekukan tarif saat dibuat. */
export const commissionPlans = pgTable('commission_plans', {
  id: pk(),
  tenantId: tenantRef(),
  rates: jsonb('rates').$type<number[]>().notNull(),
  reason: text('reason').notNull(),
  createdById: uuid('created_by_id'),
  createdByName: text('created_by_name').notNull(),
  createdAt: createdAt(),
}, (t) => [index('commission_plans_tenant_idx').on(t.tenantId, t.createdAt)]);

export const suppliers = pgTable('suppliers', {
  id: pk(),
  tenantId: tenantRef(),
  name: text('name').notNull(),
  phone: text('phone'),
  active: boolean('active').notNull().default(true),
});

export const purchaseOrders = pgTable('purchase_orders', {
  id: pk(),
  tenantId: tenantRef(),
  no: text('no').notNull(),
  depotId: uuid('depot_id').notNull().references(() => depots.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  qty: integer('qty').notNull(),
  accepted: integer('accepted').notNull().default(0),
  rejected: integer('rejected').notNull().default(0),
  status: poStatusEnum('status').notNull().default('draft'),
  promisedDate: date('promised_date', { mode: 'string' }),
  invoiced: boolean('invoiced').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('po_tenant_no_uq').on(t.tenantId, t.no)]);

export const payables = pgTable('payables', {
  id: pk(),
  tenantId: tenantRef(),
  no: text('no').notNull(),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  poId: uuid('po_id').references(() => purchaseOrders.id),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  amount: money('amount'),
  paid: money('paid'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('payables_tenant_no_uq').on(t.tenantId, t.no)]);

/** Referensi pembayaran unik per tenant mencegah pembayaran ganda. */
export const apPayments = pgTable('ap_payments', {
  id: pk(),
  tenantId: tenantRef(),
  payableId: uuid('payable_id').notNull().references(() => payables.id),
  ref: text('ref').notNull(),
  amount: money('amount'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('ap_payments_tenant_ref_uq').on(t.tenantId, t.ref)]);

export const profitReports = pgTable('profit_reports', {
  id: pk(),
  tenantId: tenantRef(),
  no: text('no').notNull(),
  memberId: uuid('member_id').notNull().references(() => members.id),
  period: text('period').notNull(),
  ref: text('ref').notNull(),
  revenue: money('revenue'),
  cost: money('cost'),
  profit: money('profit'),
  status: reportStatusEnum('status').notNull().default('draft'),
  memberShare: money('member_share'),
  investorShare: money('investor_share'),
  createdBy: uuid('created_by'),
  settledBy: uuid('settled_by'),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('reports_tenant_no_uq').on(t.tenantId, t.no)]);

export const investors = pgTable('investors', {
  id: pk(),
  tenantId: tenantRef(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  /** Porsi alokasi dalam persen; total per tenant harus 100. */
  sharePercent: smallint('share_percent').notNull(),
}, (t) => [uniqueIndex('investors_tenant_code_uq').on(t.tenantId, t.code)]);

/** Alokasi sumber penyertaan per anggota per investor. Total per anggota harus Rp12.500.000. */
export const fundingAllocations = pgTable('funding_allocations', {
  id: pk(),
  tenantId: tenantRef(),
  memberId: uuid('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  investorId: uuid('investor_id').notNull().references(() => investors.id),
  amount: money('amount'),
}, (t) => [uniqueIndex('funding_member_investor_uq').on(t.memberId, t.investorId)]);

/**
 * Pohon wilayah koperasi: provinsi → kabupaten/kota → kecamatan → kelurahan/desa.
 * `code` = kode lokal dua digit (provinsi/kabupaten/kecamatan) yang membentuk nomor anggota; kelurahan tanpa kode di nomor.
 */
export const regions = pgTable('regions', {
  id: pk(),
  tenantId: tenantRef(),
  level: regionLevelEnum('level').notNull(),
  parentId: uuid('parent_id'),
  code: text('code').notNull(),
  name: text('name').notNull(),
  /** Kode lengkap pada data referensi (mis. 3204290) bila dipilih dari sana; null bila diisi manual. */
  sourceCode: text('source_code'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('regions_sibling_code_uq').on(t.tenantId, sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.code),
  index('regions_parent_idx').on(t.parentId),
]);

/** Data referensi wilayah (dari indonesia.sql). Global, bukan per tenant; dimuat sekali dari apps/api/data/wilayah.json.gz. */
export const masterRegions = pgTable('master_regions', {
  level: regionLevelEnum('level').notNull(),
  code: text('code').notNull(),
  parentCode: text('parent_code'),
  name: text('name').notNull(),
  /** Kode lokal untuk nomor anggota: provinsi 2 digit; kab/kota 2 digit terakhir; kecamatan 2 digit (prefiks BPS, nomor bebas berikutnya bila bentrok); desa 3 digit terakhir. */
  localCode: text('local_code').notNull(),
}, (t) => [primaryKey({ columns: [t.level, t.code] }), index('master_regions_parent_idx').on(t.level, t.parentCode)]);

export const counters = pgTable('counters', {
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: integer('value').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.key] })]);

export const auditLog = pgTable('audit_log', {
  id: pk(),
  tenantId: tenantRef(),
  actorId: uuid('actor_id'),
  actorName: text('actor_name'),
  message: text('message').notNull(),
  createdAt: createdAt(),
}, (t) => [index('audit_tenant_time_idx').on(t.tenantId, t.createdAt)]);

export const membersRelations = relations(members, ({ one }) => ({ tenant: one(tenants, { fields: [members.tenantId], references: [tenants.id] }) }));

export type Region = typeof regions.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type Payable = typeof payables.$inferSelect;
export type ProfitReport = typeof profitReports.$inferSelect;
export type User = typeof users.$inferSelect;

/** Buku saldo penarikan anggota: tiap perubahan tercatat (jumlah bertanda + untuk masuk, - untuk keluar). */
export const rewardEntries = pgTable('reward_entries', {
  id: pk(),
  tenantId: tenantRef(),
  memberId: uuid('member_id').notNull().references(() => members.id),
  /** earn = imbalan belanja, transfer = dipindah ke saldo belanja, withdraw = diajukan tarik, refund = penarikan ditolak. */
  kind: text('kind').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  refNo: text('ref_no'),
  note: text('note'),
  createdAt: createdAt(),
}, (t) => [index('reward_entries_member_idx').on(t.memberId, t.createdAt)]);

/** Pengajuan tarik saldo penarikan ke rekening. Saldo ditahan saat diajukan; pengurus mentransfer di luar aplikasi lalu menandai dibayar. */
export const withdrawals = pgTable('withdrawals', {
  id: pk(),
  tenantId: tenantRef(),
  memberId: uuid('member_id').notNull().references(() => members.id),
  no: text('no').notNull(),
  amount: money('amount'),
  bank: text('bank').notNull(),
  accountNo: text('account_no').notNull(),
  accountName: text('account_name').notNull(),
  status: text('status').notNull().default('pending'),
  reason: text('reason'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedByName: text('decided_by_name'),
  createdAt: createdAt(),
}, (t) => [index('withdrawals_tenant_idx').on(t.tenantId, t.createdAt)]);

/** Buku koin anggota: earn = dari belanja diterima, redeem = ditukar voucher, refund = penukaran ditolak. */
export const coinEntries = pgTable('coin_entries', {
  id: pk(),
  tenantId: tenantRef(),
  memberId: uuid('member_id').notNull().references(() => members.id),
  kind: text('kind').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  refNo: text('ref_no'),
  note: text('note'),
  createdAt: createdAt(),
}, (t) => [index('coin_entries_member_idx').on(t.memberId, t.createdAt)]);

/** Katalog voucher yang bisa ditukar dengan koin (umroh, belanja, dll). Stok menipis tiap penukaran. */
export const vouchers = pgTable('vouchers', {
  id: pk(),
  tenantId: tenantRef(),
  name: text('name').notNull(),
  description: text('description'),
  coinCost: bigint('coin_cost', { mode: 'number' }).notNull(),
  stock: integer('stock').notNull().default(0),
  active: boolean('active').notNull().default(true),
  image: text('image'),
  createdAt: createdAt(),
}, (t) => [index('vouchers_tenant_idx').on(t.tenantId, t.createdAt)]);

/** Penukaran voucher. Koin langsung dipotong; pengurus menerbitkan (isi kode/catatan) atau menolak (koin dan stok kembali). */
export const voucherRedemptions = pgTable('voucher_redemptions', {
  id: pk(),
  tenantId: tenantRef(),
  memberId: uuid('member_id').notNull().references(() => members.id),
  voucherId: uuid('voucher_id').notNull().references(() => vouchers.id),
  no: text('no').notNull(),
  voucherName: text('voucher_name').notNull(),
  coins: bigint('coins', { mode: 'number' }).notNull(),
  status: text('status').notNull().default('pending'),
  code: text('code'),
  reason: text('reason'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedByName: text('decided_by_name'),
  createdAt: createdAt(),
}, (t) => [index('voucher_redemptions_tenant_idx').on(t.tenantId, t.createdAt)]);

/** Buku tagihan harian: satu baris per anggota per hari aktif (hari itu ditagih sekali). */
export const installmentEntries = pgTable('installment_entries', {
  id: pk(),
  tenantId: tenantRef(),
  memberId: uuid('member_id').notNull().references(() => members.id),
  /** Tanggal (WIB) hari aktif. */
  day: date('day', { mode: 'string' }).notNull(),
  /** Nomor angsuran (1..730); 0 bila tenor sudah habis dan hanya menagih tunggakan. */
  seq: integer('seq').notNull(),
  due: bigint('due', { mode: 'number' }).notNull(),
  paid: bigint('paid', { mode: 'number' }).notNull(),
  arrearsAfter: bigint('arrears_after', { mode: 'number' }).notNull(),
  refNo: text('ref_no'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('installment_member_day_uq').on(t.memberId, t.day), index('installment_tenant_idx').on(t.tenantId, t.createdAt)]);

/** Kotak masuk anggota: dibuat saat ada kejadian (pesanan, saldo, koin, voucher). `readAt` kosong = belum dibaca; `pushedAt` kosong = belum dikirim ke HP. */
export const notifications = pgTable('notifications', {
  id: pk(),
  tenantId: tenantRef(),
  memberId: uuid('member_id').notNull().references(() => members.id),
  /** 'info' (saldo, koin, voucher) atau 'trx' (pesanan). */
  tab: text('tab').notNull(),
  cat: text('cat').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  /** Layar tujuan di aplikasi, mis. 'orders', 'reward', 'coins'. */
  route: text('route').notNull(),
  /** Id yang dibuka di layar tujuan (mis. groupId pesanan). */
  refId: text('ref_id'),
  readAt: timestamp('read_at', { withTimezone: true }),
  pushedAt: timestamp('pushed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('notifications_member_idx').on(t.memberId, t.createdAt)]);

/** Token push Expo per perangkat anggota. */
export const pushTokens = pgTable('push_tokens', {
  id: pk(),
  tenantId: tenantRef(),
  memberId: uuid('member_id').notNull().references(() => members.id),
  token: text('token').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('push_tokens_token_uq').on(t.token)]);
