import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export type ReceiptPhoto = { dataUrl: string; uri: string } | 'denied' | null;

/**
 * Foto barang yang diterima: ambil dengan kamera atau pilih dari galeri, kecilkan ke lebar 1280 px (JPEG)
 * agar jauh di bawah batas server (~1,3 MB), lalu kembalikan sebagai data URL.
 */
export async function pickReceiptPhoto(source: 'camera' | 'library'): Promise<ReceiptPhoto> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return 'denied';
  const opts = { mediaTypes: ['images'] as ImagePicker.MediaType[], quality: 1 };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const uri = r.canceled ? null : r.assets[0]?.uri;
  if (!uri) return null;
  const out = await manipulateAsync(uri, [{ resize: { width: 1280 } }], { compress: 0.7, format: SaveFormat.JPEG, base64: true });
  return out.base64 ? { dataUrl: `data:image/jpeg;base64,${out.base64}`, uri: out.uri } : null;
}
