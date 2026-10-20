import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';

export type Fix = { lat: number; lng: number } | null;
export type Perm = 'checking' | 'ask' | 'denied' | 'granted' | 'unavailable';

const WATCH_MS = 3000;
const servicesOn = () => Location.hasServicesEnabledAsync().catch(() => true);

/**
 * Lokasi hanya dipakai untuk mengurutkan toko (dikirim ke server, tidak disimpan).
 * Dicek ulang saat layar dibuka lagi, saat aplikasi kembali aktif, dan saat GPS dinyalakan/dimatikan di layar yang sama.
 */
export function useLocation() {
  const [fix, setFix] = useState<Fix>(null);
  const [perm, setPerm] = useState<Perm>('checking');
  const gpsOn = useRef<boolean | null>(null);

  const locate = useCallback(async () => {
    if (!(await servicesOn())) { setFix(null); setPerm('unavailable'); return; }
    // Posisi terakhir hanya mempercepat; tidak semua platform (mis. web) mendukungnya, jadi kegagalannya diabaikan.
    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    if (last) setFix({ lat: last.coords.latitude, lng: last.coords.longitude });
    try {
      const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setFix({ lat: cur.coords.latitude, lng: cur.coords.longitude });
      setPerm('granted');
    } catch { if (!last) { setFix(null); setPerm('unavailable'); } }
  }, []);

  const apply = useCallback((r: { granted: boolean; canAskAgain: boolean }) => {
    if (r.granted) { setPerm((p) => (p === 'unavailable' ? p : 'granted')); void locate(); }
    else { setFix(null); setPerm(r.canAskAgain === false ? 'denied' : 'ask'); }
  }, [locate]);

  /** Periksa ulang izin dan lokasi (dipakai tombol "Coba lagi" juga). */
  const refresh = useCallback(() => Location.getForegroundPermissionsAsync().then(apply, () => setPerm('unavailable')), [apply]);
  const allow = useCallback(() => Location.requestForegroundPermissionsAsync().then(apply, () => setPerm('unavailable')), [apply]);

  // Layar dibuka (atau dibuka lagi): cek ulang, dan pantau GPS selama layar ini aktif.
  useFocusEffect(useCallback(() => {
    void refresh();
    const timer = setInterval(() => {
      void servicesOn().then((on) => {
        if (gpsOn.current !== null && gpsOn.current !== on) void refresh(); // GPS baru dinyalakan/dimatikan
        gpsOn.current = on;
      });
    }, WATCH_MS);
    return () => clearInterval(timer);
  }, [refresh]));

  // Kembali dari Pengaturan/aplikasi lain: izin atau GPS mungkin berubah.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refresh(); });
    return () => sub.remove();
  }, [refresh]);

  return { fix, perm, allow, refresh };
}
