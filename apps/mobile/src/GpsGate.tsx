import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { C } from './theme';
import { gpsBlocked } from './depotKm';

const COPY: Record<string, { title: string; msg: string; action: string }> = {
  unavailable: { title: 'Nyalakan GPS dulu', msg: 'Lokasi HP Anda mati. Sajadah memakai GPS untuk memilih toko terdekat, jadi GPS harus menyala untuk melanjutkan checkout.', action: 'Nyalakan GPS' },
  denied: { title: 'Izin lokasi diperlukan', msg: 'Izin lokasi untuk Sajadah ditolak. Buka Pengaturan, izinkan lokasi, lalu kembali ke sini untuk melanjutkan checkout.', action: 'Buka Pengaturan' },
  ask: { title: 'Izinkan lokasi', msg: 'Sajadah perlu mengetahui lokasi Anda untuk memilih toko terdekat. Izinkan akses lokasi untuk melanjutkan checkout.', action: 'Izinkan lokasi' },
};

/**
 * Layar penghalang checkout saat GPS mati atau izin lokasi belum diberikan. Hilang sendiri begitu GPS menyala
 * (useLocation memantau GPS tiap beberapa detik dan saat aplikasi kembali aktif).
 */
export function GpsGate({ perm, allow, refresh, onBack }: { perm: string; allow: () => void; refresh: () => void; onBack: () => void }) {
  if (!gpsBlocked(perm)) return null;
  const c = COPY[perm]!;
  const act = async () => {
    if (perm === 'ask') { allow(); return; }
    if (perm === 'unavailable' && Platform.OS === 'android') {
      // Dialog sistem "Aktifkan lokasi"; bila tidak tersedia, buka Pengaturan.
      try { await Location.enableNetworkProviderAsync(); refresh(); return; } catch { /* lanjut ke Pengaturan */ }
    }
    void Linking.openSettings();
  };
  return (
    <Modal transparent animationType="fade" onRequestClose={onBack}>
      <View style={s.scrim}>
        <View style={s.box} accessibilityViewIsModal>
          <View style={s.icon}><Ionicons name="location" size={34} color={C.goldInk} /></View>
          <Text style={s.title}>{c.title}</Text>
          <Text style={s.msg}>{c.msg}</Text>
          <View style={{ gap: 10, alignSelf: 'stretch', marginTop: 18 }}>
            <Pressable onPress={() => void act()} accessibilityRole="button" style={[s.btn, { backgroundColor: C.green }]}><Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 16 }}>{c.action}</Text></Pressable>
            <Pressable onPress={refresh} accessibilityRole="button" style={[s.btn, { borderWidth: 1.5, borderColor: C.line }]}><Text style={{ color: C.ink, fontWeight: '600', fontSize: 16 }}>Saya sudah menyalakan</Text></Pressable>
            <Pressable onPress={onBack} accessibilityRole="button" hitSlop={8} style={{ alignItems: 'center', paddingVertical: 6 }}><Text style={{ color: C.muted, fontSize: 14 }}>Kembali ke keranjang</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,39,29,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: { backgroundColor: '#ffffff', borderRadius: 20, padding: 22, alignItems: 'center', width: '100%', maxWidth: 380 },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.warn[0], alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 19, fontWeight: '700', color: C.ink, textAlign: 'center' },
  msg: { fontSize: 15, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 22 },
  btn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
});
