import type { Role } from '@sajadah/shared';

export interface Actor {
  sub: string;
  tid: string;
  role: Role;
  name: string;
  mid: string | null;
  /** Toko petugas (dari data akun, bukan token). Kosong = semua toko. */
  did?: string | null;
}
