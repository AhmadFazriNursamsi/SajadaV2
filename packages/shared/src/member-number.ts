const pad = (n: number | string, len: number) => String(n).padStart(len, '0');

export interface MemberNumberParts {
  province: string;
  regency: string;
  district: string;
  year: number;
  sequence: number;
}

/** Format PPKKCCYYNNNNNN: provinsi, kabupaten, kecamatan (2 digit), tahun (2 digit), urut (6 digit). */
export function buildMemberNumber(p: MemberNumberParts): string {
  for (const [k, v] of Object.entries({ province: p.province, regency: p.regency, district: p.district })) {
    if (!/^\d{2}$/.test(v)) throw new RangeError(`Kode ${k} harus 2 digit`);
  }
  if (p.sequence < 1 || p.sequence > 999_999) throw new RangeError('Nomor urut di luar rentang');
  return p.province + p.regency + p.district + pad(p.year % 100, 2) + pad(p.sequence, 6);
}

export const isMemberNumber = (s: string): boolean => /^\d{14}$/.test(s);
