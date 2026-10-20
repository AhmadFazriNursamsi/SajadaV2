export interface StockItem {
  physical: number;
  safety: number;
  target: number;
  inTransit: number;
  moq: number;
  multiple: number;
  autoReplenish: boolean;
  active: boolean;
}

export const availableStock = (physical: number, reserved: number): number => physical - reserved;

/** Kebutuhan beli = target - tersedia - transfer masuk - sisa PO berjalan (min 0). */
export function replenishmentNeed(item: StockItem, reserved: number, openPoQty: number): number {
  return Math.max(0, item.target - (item.physical - reserved) - item.inTransit - openPoQty);
}

/** Bulatkan kebutuhan ke MOQ dan kelipatan. 0 bila tidak ada kebutuhan. */
export function suggestOrderQty(need: number, moq: number, multiple: number): number {
  if (need <= 0) return 0;
  return Math.max(moq, Math.ceil(need / multiple) * multiple);
}

/** Apakah aturan otomatis harus membuat draf PO untuk item ini. */
export function shouldAutoReplenish(item: StockItem, reserved: number, openPoQty: number): number {
  if (!item.active || !item.autoReplenish) return 0;
  if (item.physical - reserved > item.safety) return 0;
  return suggestOrderQty(replenishmentNeed(item, reserved, openPoQty), item.moq, item.multiple);
}

/** Jarak lurus antar dua titik (haversine), dalam km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
