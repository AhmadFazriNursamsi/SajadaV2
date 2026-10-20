/** Sesi web memakai cookie HttpOnly dari server (tidak disimpan di localStorage, jadi tidak terbaca JavaScript). */

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Base URL kosong = origin yang sama (satu port). Bisa ditimpa VITE_API_URL untuk pengembangan terpisah. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

async function readJson(res: Response) {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('sajadah:logout'));
    const data = await readJson(res);
    const msg = Array.isArray(data?.message) ? data.message[0] : data?.message;
    throw new ApiError(res.status, msg ?? `Permintaan gagal (${res.status})`);
  }
  const data = await readJson(res);
  return data as T;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
