import type { ComponentProps } from 'react';
import { Platform, type ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { usePush } from '../../src/push';
import { useSession } from '../../src/session';
import { C } from '../../src/theme';

const icon = (name: ComponentProps<typeof Ionicons>['name']) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} size={size} color={color} />;

export default function StaffTabs() {
  const { me, ready } = useSession();
  usePush(ready && !!me);
  if (ready && !me) return <Redirect href="/login" />;
  return (
    <Tabs backBehavior="history" screenOptions={{ headerStyle: { backgroundColor: '#ffffff' }, headerTintColor: C.ink, headerTitleStyle: { fontWeight: '700' }, tabBarActiveTintColor: C.green, ...(Platform.OS === 'web' && { tabBarStyle: { height: 64, paddingBottom: 8 } }) }}>
      <Tabs.Screen name="index" options={{ headerShown: false, title: 'Beranda', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="orders" options={{ headerShown: false, title: 'Pesanan', tabBarIcon: icon('receipt-outline') }} />
      <Tabs.Screen name="stock" options={{ headerShown: false, title: 'Stok', tabBarIcon: icon('cube-outline') }} />
      <Tabs.Screen name="profile" options={{ headerShown: false, title: 'Akun', tabBarIcon: icon('person-outline') }} />
      <Tabs.Screen name="notifications" options={{ href: null, headerShown: false, title: 'Notifikasi' }} />
      <Tabs.Screen name="opname" options={{ href: null, title: 'Stok opname' }} />
      <Tabs.Screen name="receive" options={{ href: null, title: 'Periksa kiriman' }} />
      <Tabs.Screen name="request" options={{ href: null, title: 'Minta stok ke pusat' }} />
    </Tabs>
  );
}
