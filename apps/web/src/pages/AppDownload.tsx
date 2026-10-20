import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Badge, Block, Btn, Gate, PageHead } from '../ui';
import { useData, useToast } from '../hooks';

interface Info { available: boolean; size: number; updatedAt: string | null; url: string }

export default function AppDownloadPage() {
  const q = useData<Info>('/app/info');
  const toast = useToast();
  const [qr, setQr] = useState('');
  const info = q.data;
  useEffect(() => {
    if (!info) return;
    QRCode.toDataURL(info.url, { width: 320, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#005641', light: '#ffffff' } }).then(setQr, () => setQr(''));
  }, [info?.url]);
  const copy = async () => { try { await navigator.clipboard.writeText(info!.url); toast('Tautan disalin'); } catch { toast('Tidak dapat menyalin; salin manual', false); } };
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return (
    <>
      <PageHead title="Aplikasi HP" desc="Pindai kode QR dengan kamera HP Android untuk mengunduh aplikasi Sajadah (anggota dan petugas toko)." />
      <div className="page">
        <Gate q={q}>
          {info && (
            <Block title="Unduh aplikasi Android" note="HP harus satu jaringan Wi-Fi dengan server. Setelah terunduh, buka berkas lalu izinkan pemasangan dari sumber ini jika diminta.">
              <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, background: '#fff', width: 344, height: 344, display: 'grid', placeItems: 'center' }}>
                  {qr ? <img src={qr} width={320} height={320} alt="Kode QR unduh aplikasi Sajadah" /> : <span className="note">Membuat kode QR…</span>}
                </div>
                <div style={{ display: 'grid', gap: 12, minWidth: 260, flex: 1 }}>
                  <div>{info.available ? <Badge tone="ok">Berkas tersedia</Badge> : <Badge tone="warn">Berkas belum tersedia</Badge>}</div>
                  {info.available
                    ? <p className="note">APK {mb(info.size)} · diperbarui {new Date(info.updatedAt!).toLocaleString('id-ID')}</p>
                    : <p className="note" role="alert">Belum ada APK di server. Letakkan berkas hasil build di <code>apps/api/.data/apk/sajadah.apk</code> (atau atur lewat variabel APK_PATH), lalu muat ulang halaman ini. Sebelum itu, kode QR akan menghasilkan pesan "belum tersedia".</p>}
                  <div className="note" style={{ wordBreak: 'break-all' }}>Tautan: <code>{info.url}</code></div>
                  <div><Btn kind="g" onClick={() => void copy()}>Salin tautan</Btn></div>
                  {/(localhost|127\.0\.0\.1)/.test(info.url) && <p className="note" role="alert">Tautan memakai alamat lokal; HP tidak bisa membukanya. Atur APP_PUBLIC_URL di server ke alamat yang bisa dijangkau HP.</p>}
                </div>
              </div>
            </Block>
          )}
          <Block title="Versi mobile di browser" note="Aplikasi yang sama (layar anggota dan petugas) bisa dibuka langsung di browser tanpa memasang apa pun. Sesinya terpisah dari web admin ini.">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0' }}>
              <a className="btn" href="/m/" target="_blank" rel="noreferrer">Buka versi mobile</a>
              <span className="note">Alamat: <code>{`${window.location.origin}/m/`}</code></span>
            </div>
          </Block>
        </Gate>
      </div>
    </>
  );
}
