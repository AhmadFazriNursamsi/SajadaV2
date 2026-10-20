/** Nomor HP Indonesia: dikelola sebagai angka lokal tanpa awalan (+62), selalu diawali 8 (mis. 8123456789). */
export const PHONE_DEFAULT = '8';
export const PHONE_RE = /^8[0-9]{8,12}$/;

/** Bersihkan isian: hanya angka, awalan 0/62 dibuang, wajib diawali 8, maksimal 13 angka. */
export function cleanPhone(v: string) {
  let d = v.replace(/\D/g, '');
  if (d.startsWith('62')) d = d.slice(2);
  d = d.replace(/^0+/, '');
  if (!d.startsWith('8')) return PHONE_DEFAULT;
  return d.slice(0, 13);
}

/** Dari nilai tersimpan (+628…, 08…, 628…) ke angka lokal; kosong → "8". */
export const toLocalPhone = (stored: string | null) => cleanPhone(stored ?? '');
/** Ke nilai simpan: +62 + angka lokal. */
export const toStoredPhone = (local: string) => `+62${local}`;
