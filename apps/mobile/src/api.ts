import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'sajadah.token';
const USER_KEY = 'sajadah.username';
let memoryToken: string | null = null;

/**
 * Alamat server (satu port dengan web). Urutan: EXPO_PUBLIC_API_URL → host dev Expo (port 3000) → localhost.
 * Emulator Android memakai 10.0.2.2; perangkat fisik memakai IP LAN mesin dev dari host Expo.
 */
export function apiBase(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  if (Platform.OS === 'web') return ''; // versi web dilayani server yang sama (di /m), jadi alamat relatif
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:3000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

export const storage = {
  async get() { try { return memoryToken ?? (memoryToken = await SecureStore.getItemAsync(TOKEN_KEY)); } catch { return memoryToken; } },
  async set(t: string | null) {
    memoryToken = t;
    try { t ? await SecureStore.setItemAsync(TOKEN_KEY, t) : await SecureStore.deleteItemAsync(TOKEN_KEY); } catch { /* secure store tidak tersedia (web) */ }
  },
};

/** Username terakhir (bukan rahasia) agar tidak perlu mengetik ulang. */
export const lastUser = {
  async get() { try { return (await SecureStore.getItemAsync(USER_KEY)) ?? ''; } catch { return ''; } },
  async set(u: string) { try { await SecureStore.setItemAsync(USER_KEY, u); } catch { /* abaikan */ } },
};

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const web = Platform.OS === 'web';
  const token = web ? null : await storage.get(); // web: sesi di cookie HttpOnly dari server
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000); // jaringan macet tidak boleh membuat layar menggantung
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api${path}`, {
      method,
      signal: ctl.signal,
      credentials: web ? 'include' : undefined,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(web ? { 'X-Client': 'mobile-web' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi internet/Wi‑Fi Anda lalu coba lagi.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const data = await readJson(res);
    throw new ApiError(res.status, (Array.isArray(data?.message) ? data.message[0] : data?.message) ?? `Permintaan gagal (${res.status})`);
  }
  return (await readJson(res)) as T;
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text().catch(() => '');
  try { return text ? JSON.parse(text) : null; } catch { return null; /* balasan bukan JSON (mis. halaman galat proxy) */ }
}
