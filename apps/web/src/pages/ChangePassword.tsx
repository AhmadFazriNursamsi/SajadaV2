import { useState, type FormEvent } from 'react';
import { ApiError, post } from '../api';
import { useSession } from '../session';
import { Btn, Modal } from '../ui';
import { useToast } from '../hooks';

const POLICY = 'Minimal 8 karakter, memuat huruf dan angka.';

/** Mengubah kata sandi sendiri; mengembalikan pesan galat (kosong = berhasil). */
function useChange(onDone: () => void) {
  const { refresh } = useSession();
  const toast = useToast();
  const [cur, setCur] = useState(''), [next, setNext] = useState(''), [again, setAgain] = useState('');
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const reset = () => { setCur(''); setNext(''); setAgain(''); setErr(''); };
  async function submit() {
    if (next !== again) return setErr('Kata sandi baru dan konfirmasinya tidak sama.');
    setBusy(true); setErr('');
    try { await post('/auth/change-password', { current: cur, next }); await refresh(); toast('Kata sandi diganti'); reset(); onDone(); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Tidak dapat terhubung ke server'); }
    finally { setBusy(false); }
  }
  const ok = !!cur && !!next && !!again && !busy;
  return { cur, setCur, next, setNext, again, setAgain, err, busy, ok, submit, reset };
}

function Fields({ c }: { c: ReturnType<typeof useChange> }) {
  return (
    <>
      <label className="field">Kata sandi sekarang<input type="password" value={c.cur} onChange={(e) => c.setCur(e.target.value)} autoComplete="current-password" /></label>
      <label className="field">Kata sandi baru<input type="password" value={c.next} onChange={(e) => c.setNext(e.target.value)} autoComplete="new-password" /><span className="hint">{POLICY}</span></label>
      <label className="field">Ulangi kata sandi baru<input type="password" value={c.again} onChange={(e) => c.setAgain(e.target.value)} autoComplete="new-password" /></label>
      {c.err && <div role="alert" style={{ color: 'var(--bad-fg)', fontSize: 13 }}>{c.err}</div>}
    </>
  );
}

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useChange(onClose);
  const close = () => { c.reset(); onClose(); };
  return (
    <Modal title="Ganti kata sandi" open={open} onClose={close} footer={<><Btn kind="g" onClick={close}>Batal</Btn><Btn disabled={!c.ok} onClick={() => void c.submit()}>Simpan</Btn></>}>
      <Fields c={c} />
    </Modal>
  );
}

/** Layar penuh untuk login pertama / setelah sandi diatur ulang: tidak bisa dilewati. */
export function ForcePasswordChange() {
  const { me, logout } = useSession();
  const c = useChange(() => {});
  return (
    <div className="login">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (c.ok) void c.submit(); }}>
        <div><b>Halo, {me!.name}</b><div className="hint">Demi keamanan, ganti kata sandi sementara Anda sebelum melanjutkan. Username Anda: <code>{me!.username}</code></div></div>
        <Fields c={c} />
        <button type="submit" className="btn" disabled={!c.ok}>{c.busy ? 'Menyimpan…' : 'Simpan & lanjut'}</button>
        <button type="button" className="btn" style={{ background: 'transparent', color: 'inherit', border: '1px solid currentColor' }} onClick={logout}>Keluar</button>
      </form>
    </div>
  );
}
