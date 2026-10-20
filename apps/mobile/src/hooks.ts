import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useDialog } from './dialog';

export const rupiah = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID');
export const mono = { fontFamily: 'Menlo' } as const;

export function useData<T = any>(path: string, enabled = true) {
  return useQuery({ queryKey: [path], queryFn: () => api<T>('GET', path), enabled });
}

/** Tindakan ke API: tampilkan hasil/penolakan dan segarkan semua data. */
export function useAct() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const m = useMutation({
    mutationFn: (v: { method: string; path: string; body?: unknown; ok: string }) => api(v.method, v.path, v.body),
    onSuccess: (_d, v) => { void dialog.alert({ title: 'Berhasil', message: v.ok, kind: 'success' }); void qc.invalidateQueries(); },
    onError: (e) => void dialog.fail(e),
  });
  return { post: (path: string, ok: string, body?: unknown) => m.mutate({ method: 'POST', path, body, ok }), busy: m.isPending };
}

