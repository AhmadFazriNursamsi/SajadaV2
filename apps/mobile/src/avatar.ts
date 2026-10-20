import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export type Picked = { contentType: 'image/jpeg'; data: string } | 'denied' | null;

/** Pilih foto dari galeri, potong persegi, kecilkan ke 512 px (JPEG) agar jauh di bawah batas 1 MB server. */
export async function pickAvatar(): Promise<Picked> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return 'denied';
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  const uri = r.canceled ? null : r.assets[0]?.uri;
  if (!uri) return null;
  const out = await manipulateAsync(uri, [{ resize: { width: 512 } }], { compress: 0.8, format: SaveFormat.JPEG, base64: true });
  return out.base64 ? { contentType: 'image/jpeg', data: out.base64 } : null;
}
