import { useData } from './hooks';

export interface ShopProduct {
  id: string; sku: string; name: string; price: number; listPrice: number; discountPct: number; coins: number;
  category: string | null; description: string | null; imageUrl: string | null; stock: Record<string, number>; available: number;
}
export interface ShopDepot { id: string; name: string; address: string | null; lat: number | null; lng: number | null }
export interface Shop { categories: string[]; depots: ShopDepot[]; products: ShopProduct[] }

export const useShop = () => useData<Shop>('/me/shop');

/** Stok terbanyak di satu toko: batas jumlah yang pasti bisa dipesan dari satu toko. */
export const maxOrderable = (p: ShopProduct) => Math.max(0, ...Object.values(p.stock));
