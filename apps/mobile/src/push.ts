import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { destination, type Notif } from './notifData';

const CHANNEL_ID = 'sajadah-v2';

/**
 * Push notification ke HP. Hanya jalan di aplikasi terpasang (APK/IPA): Expo Go dan web tidak mendukung push jarak jauh,
 * jadi di sana kotak masuk tetap bekerja tetapi tanpa push. Gagal izin/token tidak mengganggu aplikasi.
 */
export function usePush(enabled: boolean) {
  const router = useRouter();
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const N = await import('expo-notifications');
        N.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
        // Pengaturan saluran Android tidak bisa diubah setelah dibuat; untuk mengganti suara, naikkan id saluran (juga di server: CHANNEL_ID).
        if (Platform.OS === 'android') await N.setNotificationChannelAsync(CHANNEL_ID, { name: 'Sajadah', importance: N.AndroidImportance.HIGH, sound: 'notif.mp3', vibrationPattern: [0, 250, 150, 250], lightColor: '#C8992B' });
        let { status } = await N.getPermissionsAsync();
        if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
        if (status !== 'granted' || cancelled) return;
        const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
        const { data } = await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
        await api('POST', '/me/push-token', { token: data });
        const got = N.addNotificationReceivedListener(() => { void qc.invalidateQueries({ queryKey: ['/me/notifications'] }); });
        const tap = N.addNotificationResponseReceivedListener((r) => {
          const d = r.notification.request.content.data as { route?: Notif['route']; refId?: string | null; id?: string };
          void qc.invalidateQueries({ queryKey: ['/me/notifications'] });
          if (d?.route) router.push(destination({ route: d.route, refId: d.refId ?? null }) as never);
        });
        off = () => { got.remove(); tap.remove(); };
      } catch { /* belum ada izin/FCM: kotak masuk tetap berfungsi */ }
    })();
    return () => { cancelled = true; off?.(); };
  }, [enabled, router, qc]);
}
