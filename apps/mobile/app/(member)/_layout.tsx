import type { ComponentProps } from 'react';
import { Platform, type ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useCart } from '../../src/cart';
import { usePush } from '../../src/push';
import { useSession } from '../../src/session';
import { C } from '../../src/theme';

const icon = (name: ComponentProps<typeof Ionicons>['name']) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} size={size} color={color} />;

/** Layar yang dibuka dari dalam aplikasi (bukan tab). Jual, komisi, dan jaringan disembunyikan dulu; layarnya tetap ada. */
const HIDDEN = ['reward', 'products', 'product', 'checkout', 'check', 'order', 'report', 'network', 'scheme', 'notifications', 'edit-profile', 'info', 'coins'];

export default function MemberTabs() {
  const { me, ready } = useSession();
  const { count } = useCart();
  usePush(ready && !!me);
  if (ready && !me) return <Redirect href="/login" />;
  return (
    <Tabs backBehavior="history" screenOptions={{ headerStyle: { backgroundColor: C.side }, headerTintColor: '#ffffff', tabBarActiveTintColor: C.green, ...(Platform.OS === 'web' && { tabBarStyle: { height: 64, paddingBottom: 8 } }) }}>
      <Tabs.Screen name="index" options={{ headerShown: false, title: 'Beranda', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="cart" options={{ title: 'Keranjang', tabBarIcon: icon('cart-outline'), tabBarBadge: count > 0 ? count : undefined, tabBarBadgeStyle: { backgroundColor: C.gold, color: C.ink } }} />
      <Tabs.Screen name="orders" options={{ headerShown: false, title: 'Transaksi', tabBarIcon: icon('receipt-outline') }} />
      <Tabs.Screen name="installments" options={{ headerShown: false, title: 'Tagihan', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="profile" options={{ headerShown: false, title: 'Akun', tabBarIcon: icon('person-outline') }} />
      {HIDDEN.map((n) => <Tabs.Screen key={n} name={n} options={{ href: null, headerShown: n === 'check', title: 'Periksa barang' }} />)}
    </Tabs>
  );
}
