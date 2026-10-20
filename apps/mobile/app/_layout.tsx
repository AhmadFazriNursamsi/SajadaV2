import { useEffect } from 'react';
import { AppState, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../src/session';
import { CartProvider } from '../src/cart';
import { DialogProvider } from '../src/dialog';
import { ErrorBoundary } from '../src/ErrorBoundary';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } });

/** Di browser desktop, tampilkan aplikasi selebar ponsel di tengah layar; di HP tidak berpengaruh. */
function Frame({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return <View style={{ flex: 1, backgroundColor: '#e8f0ee' }}><View style={{ flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: '#ffffff', boxShadow: '0 0 40px rgba(0,39,29,0.15)' }}>{children}</View></View>;
}

/** Saat aplikasi kembali dibuka dari latar belakang, data di layar yang tampil dimuat ulang (status penarikan, pesanan, dll). */
function useForegroundRefresh() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);
}

export default function Root() {
  useForegroundRefresh();
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <StatusBar style="light" />
        <CartProvider><DialogProvider><ErrorBoundary><Frame><Stack screenOptions={{ headerShown: false }} /></Frame></ErrorBoundary></DialogProvider></CartProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
