import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { useData } from './hooks';
import { useLocation } from './location';

/** Jarak (km) dari posisi anggota ke tiap toko; posisi hanya dikirim ke server untuk menghitung, tidak disimpan. */
export function useDepotKm() {
  const { fix, perm, allow, refresh } = useLocation();
  // Lokasi diminta otomatis saat layar ini dibuka (sekali; bila ditolak, anggota memilih toko manual).
  useEffect(() => { if (perm === 'ask') allow(); }, [perm, allow]);
  const q = useData<{ id: string; distanceKm: number | null }[]>(fix ? `/me/depots?lat=${fix.lat}&lng=${fix.lng}` : '/me/depots');
  const km = useMemo(() => new Map((q.data ?? []).map((d) => [d.id, d.distanceKm])), [q.data]);
  return { km, perm, allow, refresh, hasGps: fix != null && [...km.values()].some((v) => v != null) };
}

export const kmText = (n: number | null | undefined) => (n == null ? '' : `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`);

/** GPS wajib aktif di HP: mati, izin ditolak, atau belum diminta menahan checkout. Di web tidak ada GPS yang bisa dipaksa, jadi tidak diwajibkan. */
export const gpsBlocked = (perm: string) => Platform.OS !== 'web' && (perm === 'unavailable' || perm === 'denied' || perm === 'ask');
