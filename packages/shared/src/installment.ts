/**
 * Tagihan harian: pada hari aktif memotong Rp30.000 dari saldo penarikan, sampai 730 hari aktif (2 tahun).
 * Hari aktif = hari (WIB) ketika total imbalan yang masuk dari belanja sendiri yang diterima sudah mencapai INSTALLMENT_MIN_REWARD.
 */
export const INSTALLMENT_AMOUNT = 30_000;
/** Batas total imbalan harian (Rp) agar tagihan hari itu dipotong; di bawahnya tidak ada potongan dan hari tidak dihitung. */
export const INSTALLMENT_MIN_REWARD = 30_000;
export const INSTALLMENT_DAYS = 730;

export interface InstallmentPlan {
  /** Hari ini dihitung sebagai satu angsuran (selama tenor belum habis). */
  counted: boolean;
  /** Jumlah yang ditagih hari ini: angsuran hari ini + tunggakan sebelumnya. */
  due: number;
  /** Yang bisa dipotong dari saldo penarikan sekarang. */
  paid: number;
  /** Tunggakan setelah pemotongan. */
  arrears: number;
}

/**
 * Hitung potongan pada hari aktif. Hari tetap dihitung 1 angsuran walau saldo kurang; kekurangannya menjadi tunggakan
 * yang dipotong lebih dulu bersama angsuran berikutnya. Setelah 730 hari terhitung, hanya sisa tunggakan yang ditagih.
 */
export function planInstallment(i: { balance: number; arrears: number; daysCounted: number }): InstallmentPlan {
  const counted = i.daysCounted < INSTALLMENT_DAYS;
  const due = (counted ? INSTALLMENT_AMOUNT : 0) + Math.max(0, i.arrears);
  const paid = Math.min(Math.max(0, i.balance), due);
  return { counted, due, paid, arrears: due - paid };
}
