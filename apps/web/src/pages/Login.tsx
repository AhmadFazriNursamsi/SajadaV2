import { useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { useSession } from '../session';

export default function Login() {
  const { login } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await login(username.trim(), password); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Tidak dapat terhubung ke server'); }
    finally { setBusy(false); }
  }
  return (
    <div className="login">
      <form onSubmit={submit}>
        <div><img className="login-logo" src="/brand/sajada-horizontal.png" alt="Sajadah" /><div className="hint" style={{ textAlign: 'center' }}>Koperasi Sajadah · masuk untuk melanjutkan</div></div>
        <label className="field">Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="mis. budi.santoso" required /></label>
        <label className="field">Kata sandi<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {err && <div role="alert" style={{ color: 'var(--bad-fg)', fontSize: 13 }}>{err}</div>}
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Masuk…' : 'Masuk'}</button>
        <div className="hint" style={{ textAlign: 'center' }}><a href="/m/">Buka versi mobile di browser</a></div>
        <div className="hint">Username dari pengurus (umumnya nama Anda, mis. <code>budi.santoso</code>). Demo: <code>admin.nasional</code>, <code>petugas.nasional</code>, <code>anggota.nasional</code>.</div>
      </form>
    </div>
  );
}
