import { useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { C } from '../../src/theme';
import { useData } from '../../src/hooks';
import { HList, HomeHeader, SectionTitle, ShortcutRow, WalletCard, type Shortcut } from '../../src/HomeParts';
import { ProductCard } from '../../src/shop';
import { useNotifs } from '../../src/notifData';
import { useShop, type Shop, type ShopProduct } from '../../src/shopData';

interface Profile { name: string; balance: number; rewardBalance: number; coinBalance: number; active: boolean }

const CATEGORY_ICON: Record<string, Shortcut['icon']> = { Makanan: 'fast-food-outline', Minuman: 'cafe-outline', 'Kebutuhan Rumah': 'home-outline', Sembako: 'basket-outline' };

function Products({ title, items, onAll }: { title: string; items: ShopProduct[]; onAll: () => void }) {
  if (items.length === 0) return null;
  return (
    <>
      <SectionTitle action="Lihat semua" onAction={onAll}>{title}</SectionTitle>
      <HList items={items.map((p) => ({ key: p.id, p }))} render={({ p }) => <View style={{ width: 160 }}><ProductCard p={p} /></View>} />
    </>
  );
}

function HomeBody({ m, shop }: { m: Profile; shop: Shop }) {
  const router = useRouter();
  const go = (path: string, params?: Record<string, string>) => () => router.push({ pathname: path as never, params });
  const badge = useNotifs().unread();
  const categories: Shortcut[] = shop.categories.map((c) => ({ key: c, label: c, icon: CATEGORY_ICON[c] ?? 'pricetag-outline', onPress: go('/(member)/products', { category: c }) }));
  return (
    <>
      <HomeHeader name={m.name} onSearch={go('/(member)/products', { focus: '1' })} onBell={go('/(member)/notifications')} badge={badge} />
      <View style={{ padding: 16, gap: 14, marginTop: -40 }}>
        <WalletCard balance={m.balance} reward={m.rewardBalance} coins={m.coinBalance} active={m.active} onReward={go('/(member)/reward')} onCoins={go('/(member)/coins')} />
        {categories.length > 0 && <><SectionTitle>Kategori Belanja</SectionTitle><ShortcutRow items={categories} /></>}
        <Products title="Produk Pilihan" items={shop.products.slice(0, 8)} onAll={go('/(member)/products')} />
      </View>
    </>
  );
}

/** Beranda anggota bergaya Klik Indomaret: kepala + cari, dompet, aksi, promo, kategori, produk, dan status pesanan. */
export default function Home() {
  const me = useData<Profile>('/me');
  const shop = useShop();
  const all = [me, shop];
  useFocusEffect(useCallback(() => { void me.refetch(); void shop.refetch(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));
  const err = all.find((q) => q.error)?.error as Error | undefined;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={all.some((q) => q.isRefetching)} onRefresh={() => all.forEach((q) => void q.refetch())} />}>
      {me.isLoading || shop.isLoading ? <ActivityIndicator color={C.green} style={{ marginTop: 80 }} /> : err ? <Text style={{ color: C.bad[1], padding: 16 }}>Gagal memuat: {err.message}</Text>
        : me.data && shop.data && <HomeBody m={me.data} shop={shop.data} />}
    </ScrollView>
  );
}
