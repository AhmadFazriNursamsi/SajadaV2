import { z } from 'zod';
import { FAMILY_CODE_LIST, OPNAME_REASON_LIST, ROLES, SHIPMENT_ISSUE_LIST } from './constants';

const id = z.string().uuid();
const rupiah = z.coerce.number().int().min(0);
const ref = z.string().trim().min(1, 'Referensi wajib diisi').max(64);

/** `tenant` opsional: bila kosong, tenant ditentukan dari email + kata sandi. */
export const loginSchema = z.object({ tenant: z.string().min(1).optional(), username: z.string().trim().toLowerCase().min(1, 'Username wajib diisi').max(60), password: z.string().min(1, 'Kata sandi wajib diisi') });
export const forgotSchema = z.object({ username: z.string().trim().toLowerCase().min(1, 'Username wajib diisi').max(60) });
/** Kata sandi baru: minimal 8 karakter, memuat huruf dan angka. */
export const changePasswordSchema = z.object({
  current: z.string().min(1, 'Kata sandi sekarang wajib diisi'),
  next: z.string().min(8, 'Kata sandi baru minimal 8 karakter').max(72, 'Kata sandi baru maksimal 72 karakter').regex(/[A-Za-z]/, 'Harus memuat huruf').regex(/\d/, 'Harus memuat angka'),
});
/** Daerah = kelurahan/desa dari Struktur daerah; kecamatan (untuk tampilan) dan nomor anggota diturunkan darinya. */
export const createMemberSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(120),
  villageId: z.string().uuid('Pilih daerah dari Struktur daerah'),
  /** Buat akun login untuk anggota ini (username dari nama; kata sandi acak ditampilkan sekali). */
  createAccount: z.boolean().optional(),
  /** Kode referal anggota yang mengajak; sponsor terisi otomatis. Kosong = tanpa sponsor. */
  referralCode: z.string().trim().max(20).optional(),
  familyCode: z.enum(FAMILY_CODE_LIST as [string, ...string[]], { errorMap: () => ({ message: 'Kode keluarga wajib A, D, B, I, L atau P' }) }),
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD');
/** Aktivasi saldo belanja: tanggal & referensi wajib. */
export const activationSchema = z.object({ ref, date: isoDate });
/** Alokasi sumber penyertaan per investor; total harus sama dengan penyertaan (dicek server). */
export const fundingSchema = z.object({
  ref,
  date: isoDate,
  allocations: z.array(z.object({ investorId: id, amount: z.coerce.number().int().min(1, 'Jumlah alokasi minimal 1') })).min(1, 'Pilih minimal satu investor'),
});
export const createInvestorSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/, 'Kode 2–16 huruf/angka'),
  name: z.string().trim().min(1, 'Nama investor wajib').max(120),
  sharePercent: z.coerce.number().int().min(1, 'Porsi 1–100').max(100, 'Porsi 1–100'),
});
export const REGION_LEVELS = ['province', 'regency', 'district', 'village'] as const;
export type RegionLevel = (typeof REGION_LEVELS)[number];
export const REGION_LABEL: Record<RegionLevel, string> = { province: 'Provinsi', regency: 'Kabupaten / kota', district: 'Kecamatan', village: 'Kelurahan / desa' };
const regionCode = (level: RegionLevel) => (level === 'village' ? /^\d{2,10}$/ : /^\d{2}$/);
export const createRegionSchema = z
  .object({ level: z.enum(REGION_LEVELS), parentId: id.nullable(), /** Kode lokal opsional: bila kosong, server menetapkan nomor bebas berikutnya pada induk tersebut. */ code: z.string().trim().optional(), name: z.string().trim().min(1, 'Nama wilayah wajib').max(120) })
  .refine((v) => !v.code || regionCode(v.level).test(v.code), { message: 'Kode lokal provinsi/kabupaten/kecamatan harus 2 digit (kelurahan 2–10 digit)', path: ['code'] })
  .refine((v) => (v.level === 'province') === (v.parentId === null), { message: 'Provinsi tanpa induk; tingkat lain wajib memilih induk', path: ['parentId'] });
/** Tambah wilayah dari data referensi: server menurunkan nama & kode lokal dari `sourceCode`; klien tidak mengirim keduanya. */
export const regionFromMasterSchema = z.object({ level: z.enum(REGION_LEVELS), parentId: id.nullable(), sourceCode: z.string().regex(/^\d{2,10}$/, 'Kode wilayah tidak valid') });
/** Penempatan: kelurahan yang sudah ada di pohon tenant (villageId) ATAU kode kelurahan dari data referensi (server membuat jalur yang belum ada). */
export const placementSchema = z
  .object({ villageId: id.optional(), villageSourceCode: z.string().regex(/^\d{10}$/, 'Kode kelurahan/desa harus 10 digit').optional() })
  .refine((v) => (v.villageId ? 1 : 0) + (v.villageSourceCode ? 1 : 0) === 1, { message: 'Pilih salah satu: kelurahan di Struktur daerah atau dari data referensi', path: ['villageId'] });
export const sponsorSchema = z.object({ sponsorId: id.nullable() });
const customerName = z.string().trim().min(2, 'Nama pelanggan minimal 2 karakter').max(80);
const customerPhone = z.string().trim().max(30).optional();
const items = z.array(z.object({ productId: id, qty: z.coerce.number().int().min(1) })).min(1, 'Keranjang kosong');
const oneBuyer = (v: { buyerId?: string; customerName?: string }) => (v.buyerId ? 1 : 0) + (v.customerName ? 1 : 0) === 1;
const BUYER_MSG = { message: 'Pilih satu pembeli: anggota atau pelanggan umum', path: ['buyerId'] };
/** Checkout oleh petugas: pembeli = anggota (buyerId) atau pelanggan umum (customerName). */
export const checkoutSchema = z
  .object({
    /** Toko asal stok; kosong = toko petugas (atau toko utama untuk pengurus). */
    depotId: id.optional(),
    sellerId: id,
    buyerId: id.optional(),
    customerName: customerName.optional(),
    customerPhone,
    items,
  })
  .refine(oneBuyer, BUYER_MSG);
/** Penjualan yang dicatat anggota di aplikasi: penjual = anggota itu; pembeli selalu pelanggan umum (anggota tidak menjual ke anggota lain). */
export const memberSaleSchema = z.object({ depotId: id, customerName, customerPhone, items: items.max(20) });
/** Pesanan anggota dari aplikasi: pembeli = penjual = anggota itu sendiri. */
export const memberOrderSchema = z.object({
  depotId: id,
  items: z.array(z.object({ productId: id, qty: z.coerce.number().int().min(1).max(999) })).min(1, 'Pilih minimal satu barang'),
});
export const rejectSchema = z.object({ reason: z.string().trim().min(1, 'Isi alasan penolakan').max(300) });
const lat = z.coerce.number().min(-90, 'Lintang harus antara -90 dan 90').max(90, 'Lintang harus antara -90 dan 90');
const lng = z.coerce.number().min(-180, 'Bujur harus antara -180 dan 180').max(180, 'Bujur harus antara -180 dan 180');
const bothOrNone = (v: { lat?: number | null; lng?: number | null }) => (v.lat == null) === (v.lng == null);
export const depotSchema = z
  .object({ name: z.string().trim().min(2, 'Nama toko minimal 2 karakter').max(80), address: z.string().trim().max(200).optional(), lat: lat.nullish(), lng: lng.nullish() })
  .refine(bothOrNone, { message: 'Isi lintang dan bujur sekaligus, atau kosongkan keduanya', path: ['lat'] });
export const depotUpdateSchema = z
  .object({ name: z.string().trim().min(2).max(80).optional(), address: z.string().trim().max(200).optional(), lat: lat.nullish(), lng: lng.nullish(), active: z.boolean().optional() })
  .refine((v) => !('lat' in v || 'lng' in v) || bothOrNone(v), { message: 'Isi lintang dan bujur sekaligus, atau kosongkan keduanya', path: ['lat'] });
/** Posisi anggota untuk mengurutkan toko terdekat; tidak disimpan. */
export const nearSchema = z.object({ lat, lng });
export const depotStaffSchema = z.object({ name: z.string().trim().min(2, 'Nama petugas minimal 2 karakter').max(80) });
export const shipSchema = z.object({ deliveryRef: ref });
export const receiveOrderSchema = z.object({ proofRef: ref, receiverName: z.string().trim().min(1, 'Nama penerima wajib').max(120) });
/** Stok opname wajib tiap akhir bulan: diajukan paling cepat sekian hari sebelum bulan berakhir. Bulan berlalu tanpa itu → transaksi toko dikunci. */
export const OPNAME_WINDOW_DAYS = 7;
/** Pesanan anggota yang belum diperiksa anggotanya baru boleh diselesaikan pengurus setelah sekian hari sejak dikirim. */
export const MEMBER_CHECK_GRACE_DAYS = 3;
export const receiveOverrideSchema = z.object({ reason: z.string().trim().min(10, 'Jelaskan alasannya (minimal 10 karakter)').max(300) });
export const cancelSchema = z.object({ reason: z.string().trim().min(1, 'Isi alasan pembatalan').max(300) });
/** Hitungan opname per baris; countedQty null = belum dihitung. */
export const countLineSchema = z.object({
  lineId: id,
  countedQty: z.coerce.number().int().min(0, 'Hasil hitung tidak boleh negatif').max(1_000_000).nullable(),
  reason: z.enum(OPNAME_REASON_LIST as [string, ...string[]]).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});
export const saveCountLinesSchema = z.object({ lines: z.array(countLineSchema).min(1).max(500) });
export const createCountSchema = z.object({ depotId: id.optional(), note: z.string().trim().max(200).optional() });
/** Toleransi selisih opname: persen per produk (dari stok sistem) dan nilai total dokumen (Rp, harga beli). */
export const opnamePolicySchema = z.object({
  tolerancePct: z.coerce.number().int().min(0, 'Persen tidak boleh negatif').max(100, 'Maksimal 100%'),
  toleranceValue: z.coerce.number().int().min(0, 'Nilai tidak boleh negatif').max(1_000_000_000_000),
});
export const countReasonSchema = z.object({ reason: z.string().trim().min(3, 'Isi alasan (minimal 3 karakter)').max(300) });
export const stockQtySchema = z.object({ depotId: id.optional(), qty: z.coerce.number().int().min(1, 'Jumlah minimal 1') });
export const poReceiveSchema = z.object({ accepted: z.coerce.number().int().min(0), rejected: z.coerce.number().int().min(0) });
export const poScheduleSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD') });
export const profitReportSchema = z
  .object({
    memberId: id,
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Periode harus YYYY-MM'),
    ref,
    revenue: rupiah,
    cost: rupiah,
  })
  .refine((v) => v.cost <= v.revenue, { message: 'Biaya tidak boleh lebih besar dari pendapatan', path: ['cost'] })
  .refine((v) => v.revenue - v.cost > 0, { message: 'Laporan rugi belum diproses', path: ['revenue'] });
export const apPaymentSchema = z.object({ amount: z.coerce.number().int().min(1, 'Isi jumlah pembayaran'), ref });
export const scenarioSchema = z.object({ profit: rupiah, remaining: rupiah, cumulative: rupiah });
export const roleSchema = z.enum(ROLES);

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type MemberSaleInput = z.infer<typeof memberSaleSchema>;
export type MemberOrderInput = z.infer<typeof memberOrderSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type ProfitReportInput = z.infer<typeof profitReportSchema>;

/** Batas wajar tarif komisi: tiap tingkat 0-15% dan total paling banyak 30% dari nilai pesanan. */
export const COMMISSION_RATE_MAX = 15;
export const COMMISSION_TOTAL_MAX = 30;
export const commissionPlanSchema = z.object({
  rates: z.array(z.coerce.number().min(0, 'Tarif tidak boleh negatif').max(COMMISSION_RATE_MAX, `Tarif per tingkat maksimal ${COMMISSION_RATE_MAX}%`)).length(4, 'Isi 4 tarif: penjual dan 3 tingkat sponsor')
    .refine((r) => r.reduce((a, b) => a + b, 0) <= COMMISSION_TOTAL_MAX, `Total tarif maksimal ${COMMISSION_TOTAL_MAX}%`)
    .refine((r) => r.reduce((a, b) => a + b, 0) > 0, 'Total tarif harus lebih dari 0%'),
  reason: z.string().trim().min(5, 'Jelaskan alasan perubahan (minimal 5 karakter)').max(300),
});
export const updateMemberSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(120).optional(),
  familyCode: z.enum(FAMILY_CODE_LIST as [string, ...string[]], { errorMap: () => ({ message: 'Kode keluarga wajib A, D, B, I, L atau P' }) }).optional(),
}).refine((v) => v.name !== undefined || v.familyCode !== undefined, { message: 'Tidak ada yang diubah' });
export const deactivateMemberSchema = z.object({ reason: z.string().trim().min(5, 'Isi alasan (minimal 5 karakter)').max(300) });

/** Saldo penarikan: persen bawaan produk baru. Tiap produk punya persennya sendiri (products.rewardPercent), diatur admin. */
export const REWARD_PERCENT = 20;
/** Penarikan saldo ke rekening minimal Rp20.000 (pindah ke saldo belanja tanpa batas minimal). */
export const MIN_WITHDRAWAL = 20_000;
export const rewardTransferSchema = z.object({ amount: z.coerce.number().int('Harus bilangan bulat').min(1, 'Isi jumlah').max(1_000_000_000) });
export const withdrawalSchema = z.object({
  amount: z.coerce.number().int('Harus bilangan bulat').min(MIN_WITHDRAWAL, `Penarikan minimal Rp${MIN_WITHDRAWAL.toLocaleString('id-ID')}`).max(1_000_000_000),
  bank: z.string().trim().min(2, 'Isi nama bank').max(40),
  accountNo: z.string().trim().regex(/^[0-9]{5,25}$/, 'Nomor rekening 5–25 angka'),
  accountName: z.string().trim().min(2, 'Isi nama pemilik rekening').max(80),
});

/** Admin pusat: master produk, stok gudang pusat, dan pengiriman ke toko. */
const money0 = z.coerce.number().int('Harus bilangan bulat').min(0, 'Tidak boleh negatif').max(1_000_000_000);
/** Tampilan toko anggota. Harga tetap: tidak ada harga coret atau diskon. */
const shopFields = {
  category: z.string().trim().max(40).optional(),
  description: z.string().trim().max(2000).optional(),
  coins: z.coerce.number().int('Harus bilangan bulat').min(0).max(1_000_000).optional(),
  /** Persen nilai produk yang masuk saldo penarikan saat belanja sendiri diterima (0 = tanpa imbalan). */
  rewardPercent: z.coerce.number().int('Harus bilangan bulat').min(0, 'Minimal 0%').max(100, 'Maksimal 100%').optional(),
};
export const createProductSchema = z.object({
  name: z.string().trim().min(2, 'Nama produk minimal 2 karakter').max(80),
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'SKU huruf besar/angka/strip, 2–20 karakter').optional(),
  buyPrice: money0.optional().default(0), // tidak lagi diisi dari halaman Produk; dipakai hutang pemasok & nilai opname bila ada
  sellPrice: money0.refine((v) => v > 0, 'Harga harus lebih dari 0'),
  safety: z.coerce.number().int().min(0).max(100000),
  target: z.coerce.number().int().min(0).max(100000),
  ...shopFields,
}).refine((p) => p.target >= p.safety, { message: 'Target stok tidak boleh di bawah stok aman', path: ['target'] });
export const updateProductSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  buyPrice: money0.optional(),
  sellPrice: money0.refine((v) => v > 0, 'Harga jual harus lebih dari 0').optional(),
  safety: z.coerce.number().int().min(0).max(100000).optional(),
  target: z.coerce.number().int().min(0).max(100000).optional(),
  ...shopFields,
});
export const productImageSchema = z.object({ contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(100).max(1_400_000) });
export const centralReceiptSchema = z.object({ productId: id, qty: z.coerce.number().int().min(1, 'Jumlah minimal 1').max(1_000_000), note: z.string().trim().max(200).optional() });
export const createShipmentSchema = z.object({
  depotId: id,
  note: z.string().trim().max(200).optional(),
  items: z.array(z.object({ productId: id, qty: z.coerce.number().int().min(1, 'Jumlah minimal 1').max(1_000_000) })).min(1, 'Pilih minimal satu produk').max(50)
    .refine((l) => new Set(l.map((i) => i.productId)).size === l.length, 'Produk yang sama tidak boleh dua kali'),
});
export const cancelShipmentSchema = z.object({ reason: z.string().trim().min(5, 'Jelaskan alasan pembatalan (minimal 5 karakter)').max(300) });
/**
 * Penerimaan kiriman di toko: petugas memeriksa barang fisik. `items` kosong = semua sesuai kiriman.
 * Bila jumlah diterima < dikirim, alasan wajib (dicek server); "lainnya" wajib dijelaskan.
 */
export const receiveShipmentSchema = z.object({
  note: z.string().trim().max(200).optional(),
  items: z.array(z.object({
    productId: id,
    qty: z.coerce.number().int().min(0).max(1_000_000),
    issue: z.enum(SHIPMENT_ISSUE_LIST as [string, ...string[]]).optional(),
    note: z.string().trim().max(200).optional(),
  })).max(50).optional(),
});
export const centralAdminSchema = z.object({ name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(80) });

/** Permintaan stok toko → pusat. */
export const createStockRequestSchema = z.object({
  depotId: id.optional(),
  note: z.string().trim().max(200).optional(),
  items: z.array(z.object({ productId: id, qty: z.coerce.number().int().min(1, 'Jumlah minimal 1').max(100000) })).min(1, 'Pilih minimal satu produk').max(50)
    .refine((l) => new Set(l.map((i) => i.productId)).size === l.length, 'Produk yang sama tidak boleh dua kali'),
});
/** Pengurus memproses: jumlah kirim per produk (0 = tidak dikirim, tidak boleh melebihi yang diminta; dicek server). */
export const fulfillStockRequestSchema = z.object({
  items: z.array(z.object({ productId: id, qty: z.coerce.number().int().min(0).max(100000) })).min(1),
  note: z.string().trim().max(200).optional(),
});
export const rejectStockRequestSchema = z.object({ reason: z.string().trim().min(5, 'Jelaskan alasan penolakan (minimal 5 karakter)').max(300) });

/** Anggota mengubah profilnya sendiri (nama, nomor HP, alamat). Kolom kosong "" = dihapus. */
export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(120).optional(),
  phone: z.string().trim().max(20).regex(/^(\+?[0-9][0-9 -]{6,18}[0-9])?$/, 'Nomor HP tidak valid (angka, boleh diawali +, spasi atau strip)').optional(),
  address: z.string().trim().max(200).optional(),
  familyCode: z.enum(FAMILY_CODE_LIST as [string, ...string[]], { errorMap: () => ({ message: 'Status keluarga tidak valid' }) }).optional(),
}).refine((v) => v.name !== undefined || v.phone !== undefined || v.address !== undefined || v.familyCode !== undefined, { message: 'Tidak ada yang diubah' });

/**
 * Anggota memeriksa barang yang dikirim untuk pesanannya. `items` kosong = semua sesuai.
 * Jumlah diterima ≤ jumlah dipesan; bila kurang, alasan wajib (kurang/rusak/salah produk/lainnya); "lainnya" wajib dicatat.
 */
/** Foto bukti penerimaan: JPEG (data URL base64) yang sudah dikecilkan di aplikasi, sekitar maksimal 1,3 MB. */
export const RECEIPT_PHOTO_MAX_CHARS = 1_800_000;
export const verifyReceiptSchema = z.object({ valid: z.boolean(), note: z.string().trim().max(300).optional() })
  .refine((v) => v.valid || (v.note?.length ?? 0) >= 3, { message: 'Isi alasan foto ditolak (minimal 3 karakter)', path: ['note'] });
export const orderCheckSchema = z.object({
  /** Wajib: foto barang yang diterima. Petugas toko memeriksanya sebelum pesanan selesai. */
  photo: z.string({ required_error: 'Foto barang yang diterima wajib dilampirkan' }).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/, 'Foto harus berupa gambar JPEG').max(RECEIPT_PHOTO_MAX_CHARS, 'Foto terlalu besar'),
  note: z.string().trim().max(300).optional(),
  items: z.array(z.object({
    productId: id,
    qty: z.coerce.number().int().min(0).max(1_000_000),
    issue: z.enum(['kurang', 'rusak', 'salah_kirim', 'lainnya']).optional(),
    note: z.string().trim().max(200).optional(),
  })).max(50).optional(),
});
export const resolveReportSchema = z.object({ note: z.string().trim().min(3, 'Tulis tanggapan untuk anggota (minimal 3 karakter)').max(300) });

/** Voucher yang bisa ditukar dengan koin. */
export const voucherSchema = z.object({
  name: z.string().trim().min(2, 'Nama voucher minimal 2 karakter').max(80),
  description: z.string().trim().max(1000).optional(),
  coinCost: z.coerce.number().int('Harus bilangan bulat').min(1, 'Harga koin minimal 1').max(1_000_000_000),
  stock: z.coerce.number().int('Harus bilangan bulat').min(0).max(1_000_000),
  active: z.boolean().optional(),
});
export const voucherUpdateSchema = voucherSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'Tidak ada yang diubah' });
export const voucherFulfillSchema = z.object({ code: z.string().trim().max(200).optional() });

/** Profil badan usaha untuk kop invoice. Semua boleh kosong; yang kosong tampil sebagai "belum diisi" di dokumen. */
export const companyProfileSchema = z.object({
  legalName: z.string().trim().max(150).optional(),
  address: z.string().trim().max(300).optional(),
  npwp: z.string().trim().max(30).regex(/^[0-9.\-]*$/, 'NPWP hanya angka, titik, atau strip').optional(),
  phone: z.string().trim().max(30).optional(),
  signatory: z.string().trim().max(100).optional(),
  signatoryTitle: z.string().trim().max(60).optional(),
});
