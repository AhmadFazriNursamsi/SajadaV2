/** Penyertaan per anggota (IDR) dan rinciannya, mengikuti dokumen Proses Bisnis v1.1 bagian 3. */
export const PARTICIPATION_TOTAL = 12_500_000;
export const SHOPPING_BALANCE = 10_000_000;
export const INITIAL_BUDGET = {
  hpAndroid: 2_000_000,
  mandatoryDues: 100_000,
  firstMonthlyDues: 50_000,
  costume: 100_000,
  application: 250_000,
} as const;

export const FAMILY_CODES = {
  A: 'Single Mom',
  D: 'Duda',
  B: 'Bapak',
  I: 'Ibu',
  L: 'Anak laki-laki',
  P: 'Anak perempuan',
} as const;
export type FamilyCode = keyof typeof FAMILY_CODES;
export const FAMILY_CODE_LIST = Object.keys(FAMILY_CODES) as FamilyCode[];

/** Tarif komisi demo: penjual 5%, upline 1..3 = 3/2/1 (kebijakan demo, bukan produksi). */
export const COMMISSION_RATES = [5, 3, 2, 1] as const;
export const MAX_UPLINE_DEPTH = 3;

/** Tahap bagi hasil setelah pemulihan: [dari, sampai, bagian anggota]. */
export const MARGINAL_TIERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 10_000_000, 0.25],
  [10_000_000, 50_000_000, 0.3],
  [50_000_000, 100_000_000, 0.5],
  [100_000_000, 1e13, 0.6],
];
/** Fase pemulihan: anggota menerima 20% sampai 80% bagian investor menutup sisa penyertaan. */
export const RECOVERY_MEMBER_SHARE = 0.2;

/**
 * Peran di dalam koperasi: Pengurus (mengurus pusat: produk, stok pusat, kirim ke toko, persetujuan, keuangan, anggota;
 * hanya baca untuk stok toko), Petugas (stok toko), Anggota.
 */
export const ROLES = ['tenant_admin', 'staff', 'member'] as const;
export type Role = (typeof ROLES)[number];

/** Laporan harian dibulatkan menurut hari kalender WIB (UTC+7). */
export const REPORT_UTC_OFFSET_HOURS = 7;

/** Kode referal ditampilkan berkelompok (XXXX-XXXX) dan dibaca tanpa tanda baca/huruf kecil. */
export const normalizeReferral = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const formatReferral = (code: string): string => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

/** Alasan selisih stok opname (wajib bila hasil hitung berbeda dari stok sistem). */
export const OPNAME_REASONS = {
  rusak: 'Rusak / cacat',
  kadaluarsa: 'Kedaluwarsa',
  hilang: 'Hilang / susut',
  salah_catat: 'Salah pencatatan',
  lainnya: 'Lainnya (jelaskan di catatan)',
} as const;
export type OpnameReason = keyof typeof OPNAME_REASONS;

/** Alasan bila barang yang diterima di toko tidak sama dengan yang dikirim pusat. */
export const SHIPMENT_ISSUES = {
  kurang: 'Jumlah kurang dari yang dikirim',
  rusak: 'Rusak / cacat',
  salah_kirim: 'Salah produk',
  lebih: 'Jumlah lebih dari yang dikirim',
  lainnya: 'Lainnya (jelaskan di catatan)',
} as const;
export type ShipmentIssue = keyof typeof SHIPMENT_ISSUES;
export const SHIPMENT_ISSUE_LIST = Object.keys(SHIPMENT_ISSUES) as ShipmentIssue[];
export const OPNAME_REASON_LIST = Object.keys(OPNAME_REASONS) as OpnameReason[];
