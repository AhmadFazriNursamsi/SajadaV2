const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function words(n: number): string {
  if (n < 12) return SATUAN[n]!;
  if (n < 20) return `${words(n - 10)} belas`;
  if (n < 100) return `${words(Math.floor(n / 10))} puluh${n % 10 ? ` ${words(n % 10)}` : ''}`;
  if (n < 200) return `seratus${n % 100 ? ` ${words(n % 100)}` : ''}`;
  if (n < 1000) return `${words(Math.floor(n / 100))} ratus${n % 100 ? ` ${words(n % 100)}` : ''}`;
  if (n < 2000) return `seribu${n % 1000 ? ` ${words(n % 1000)}` : ''}`;
  if (n < 1_000_000) return `${words(Math.floor(n / 1000))} ribu${n % 1000 ? ` ${words(n % 1000)}` : ''}`;
  if (n < 1_000_000_000) return `${words(Math.floor(n / 1_000_000))} juta${n % 1_000_000 ? ` ${words(n % 1_000_000)}` : ''}`;
  if (n < 1_000_000_000_000) return `${words(Math.floor(n / 1_000_000_000))} miliar${n % 1_000_000_000 ? ` ${words(n % 1_000_000_000)}` : ''}`;
  return `${words(Math.floor(n / 1_000_000_000_000))} triliun${n % 1_000_000_000_000 ? ` ${words(n % 1_000_000_000_000)}` : ''}`;
}

/** Angka rupiah dalam kata, mis. 1.250.000 → "satu juta dua ratus lima puluh ribu rupiah" (untuk invoice). */
export function terbilangRupiah(n: number): string {
  const v = Math.max(0, Math.floor(n));
  return `${v === 0 ? 'nol' : words(v)} rupiah`;
}
