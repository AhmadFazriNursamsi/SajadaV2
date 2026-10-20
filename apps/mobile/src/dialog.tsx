import { createContext, useCallback, useContext, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from './api';
import { C } from './theme';

type Kind = 'success' | 'error' | 'confirm' | 'info';
export interface DialogOptions { title: string; message?: string; kind?: Kind; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
interface Pending { opts: DialogOptions; ask: boolean; resolve: (ok: boolean) => void }
interface Api { alert: (o: DialogOptions) => Promise<void>; confirm: (o: DialogOptions) => Promise<boolean>; fail: (e: unknown, title?: string) => Promise<void> }

const Ctx = createContext<Api | null>(null);

const LOOK: Record<Kind, { icon: ComponentProps<typeof Ionicons>['name']; fg: string; bg: string }> = {
  success: { icon: 'checkmark-circle', fg: C.green, bg: C.ok[0] },
  error: { icon: 'alert-circle', fg: C.bad[1], bg: C.bad[0] },
  confirm: { icon: 'help-circle', fg: C.goldInk, bg: C.warn[0] },
  info: { icon: 'information-circle', fg: C.green, bg: C.ok[0] },
};

/** Pesan galat yang ramah: pesan dari server sudah berbahasa Indonesia; selain itu pakai kalimat umum. */
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Terjadi kendala. Coba lagi sebentar lagi.');

function Box({ p, onClose }: { p: Pending; onClose: (ok: boolean) => void }) {
  const kind = p.opts.kind ?? (p.ask ? 'confirm' : 'info');
  const look = LOOK[kind];
  const danger = p.opts.danger;
  return (
    <Modal transparent animationType="fade" onRequestClose={() => onClose(false)}>
      <View style={s.scrim}>
        <View style={s.box} accessibilityViewIsModal>
          <View style={[s.icon, { backgroundColor: look.bg }]}><Ionicons name={look.icon} size={34} color={look.fg} /></View>
          <Text style={s.title}>{p.opts.title}</Text>
          {p.opts.message ? <Text style={s.msg}>{p.opts.message}</Text> : null}
          <View style={{ gap: 10, alignSelf: 'stretch', marginTop: 18 }}>
            <Pressable onPress={() => onClose(true)} accessibilityRole="button" style={[s.btn, { backgroundColor: danger ? C.bad[1] : C.green }]}>
              <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 16 }}>{p.opts.confirmLabel ?? (p.ask ? 'Ya, lanjutkan' : 'OK')}</Text>
            </Pressable>
            {p.ask && (
              <Pressable onPress={() => onClose(false)} accessibilityRole="button" style={[s.btn, { borderWidth: 1.5, borderColor: C.line }]}>
                <Text style={{ color: C.ink, fontWeight: '600', fontSize: 16 }}>{p.opts.cancelLabel ?? 'Batal'}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Dialog bermerek (menggantikan Alert bawaan yang tidak tampil di web): kartu tengah dengan ikon, judul, pesan, dan tombol jelas. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Pending[]>([]);
  const push = useCallback((opts: DialogOptions, ask: boolean) => new Promise<boolean>((resolve) => setQueue((q) => [...q, { opts, ask, resolve }])), []);
  const api = useMemo<Api>(() => ({
    alert: async (o) => { await push(o, false); },
    confirm: (o) => push(o, true),
    fail: async (e, title = 'Belum berhasil') => { await push({ title, message: errorText(e), kind: 'error' }, false); },
  }), [push]);
  const cur = queue[0];
  const close = (ok: boolean) => { cur?.resolve(ok); setQueue((q) => q.slice(1)); };
  return <Ctx.Provider value={api}>{children}{cur && <Box key={queue.length + cur.opts.title} p={cur} onClose={close} />}</Ctx.Provider>;
}

export function useDialog() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useDialog harus di dalam DialogProvider');
  return c;
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,39,29,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: { backgroundColor: '#ffffff', borderRadius: 20, padding: 22, alignItems: 'center', width: '100%', maxWidth: 380 },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 19, fontWeight: '700', color: C.ink, textAlign: 'center' },
  msg: { fontSize: 15, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 22 },
  btn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
});
