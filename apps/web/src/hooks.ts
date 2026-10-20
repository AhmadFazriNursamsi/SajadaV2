import { createContext, useContext, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupiah } from '@sajadah/shared';
import { ApiError, api, get } from './api';

export const R = formatRupiah;

export function useForm<T extends Record<string, string>>(initial: T) {
  const [v, setV] = useState(initial);
  const bind = (k: keyof T & string, label: string, ph?: string) => ({ label, value: v[k]!, ph, onChange: (x: string) => setV((s) => ({ ...s, [k]: x })) });
  return { v, bind, set: (k: keyof T & string, x: string) => setV((s) => ({ ...s, [k]: x })) };
}

export const ToastCtx = createContext<(msg: string, ok?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

/** Jalankan tindakan ke API: toast hasil (sukses/ditolak) lalu segarkan semua data. */
export function useAct() {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: ({ method, path, body }: { method: string; path: string; body?: unknown; ok: string }) => api(method, path, body),
    onSuccess: (_d, v) => { toast(v.ok); void qc.invalidateQueries(); },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Terjadi kesalahan', false),
  });
  /** `onDone` hanya dipanggil bila server menerima tindakan (mis. untuk menutup dialog). */
  const run = (method: string, path: string, ok: string, body?: unknown, onDone?: () => void) => m.mutate({ method, path, body, ok }, { onSuccess: onDone });
  return { run, post: (path: string, ok: string, body?: unknown, onDone?: () => void) => run('POST', path, ok, body, onDone), busy: m.isPending };
}

export function useData<T = any>(path: string, enabled = true) {
  return useQuery({ queryKey: [path], queryFn: () => get<T>(path), enabled });
}
