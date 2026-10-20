export const formatRupiah = (n: number): string => 'Rp' + Math.round(n).toLocaleString('id-ID');
export const formatNumber = (n: number): string => Math.round(n).toLocaleString('id-ID');
