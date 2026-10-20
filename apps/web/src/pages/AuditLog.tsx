import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../api';
import { Btn, Field, Gate, PageHead, Block, Table } from '../ui';
import { useForm } from '../hooks';

interface Row { id: string; at: string; actor: string | null; message: string }
interface Page { rows: Row[]; next: string | null }
const PAGE = 50;

/** Log aktivitas lengkap (hanya baca): cari teks/pelaku, lalu muat halaman yang lebih lama. */
export default function AuditLogPage() {
  const f = useForm({ q: '' });
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(f.v.q.trim()), 350); return () => clearTimeout(t); }, [f.v.q]); // tunda pencarian saat mengetik
  const first = useQuery({ queryKey: ['audit', q], queryFn: () => get<Page>(`/audit-log?limit=${PAGE}${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  const [more, setMore] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMore([]); setNext(first.data?.next ?? null); }, [first.data]);
  const rows = [...(first.data?.rows ?? []), ...more];
  const loadMore = async () => {
    if (!next) return;
    setBusy(true);
    try { const p = await get<Page>(`/audit-log?limit=${PAGE}&before=${encodeURIComponent(next)}${q ? `&q=${encodeURIComponent(q)}` : ''}`); setMore((m) => [...m, ...p.rows]); setNext(p.next); }
    finally { setBusy(false); }
  };
  return (
    <>
      <PageHead title="Log aktivitas" desc="Catatan semua tindakan penting di koperasi: siapa, kapan, dan apa. Hanya bisa dibaca; tidak ada yang dapat diubah atau dihapus dari sini." />
      <div className="page">
        <Block title="Cari" note="Cari pada isi pesan atau nama pelaku, mis. “dinonaktifkan”, “Tarif komisi”, atau nama anggota.">
          <div style={{ padding: '0 18px 14px', maxWidth: 520 }}><Field {...f.bind('q', 'Kata kunci', 'mis. Tarif komisi')} /></div>
        </Block>
        <Gate q={first}>
          <Block title={`Aktivitas${q ? ` · “${q}”` : ''}`} note={`${rows.length} entri ditampilkan${next ? ' · masih ada yang lebih lama' : ''}`}>
            <Table empty="Tidak ada aktivitas yang cocok." rows={rows} fixed cols={[
              { head: 'Waktu', mono: true, w: '170px', cell: (r) => new Date(r.at).toLocaleString('id-ID') },
              { head: 'Pelaku', w: '190px', cell: (r) => r.actor ?? '—' },
              { head: 'Aktivitas', cell: (r) => r.message },
            ]} />
            {next && <div style={{ padding: 14, textAlign: 'center' }}><Btn kind="g" disabled={busy} onClick={() => void loadMore()}>{busy ? 'Memuat…' : 'Muat lebih banyak'}</Btn></div>}
          </Block>
        </Gate>
      </div>
    </>
  );
}
