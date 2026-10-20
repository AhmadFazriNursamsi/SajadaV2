import { useState } from 'react';
import { Badge, Block, Btn, Field, Gate, Modal, PageHead, Table } from '../ui';
import { R, useAct, useData, useForm } from '../hooks';

interface Withdrawal {
  id: string; no: string; memberName: string; memberNo: string | null; amount: number; bank: string; accountNo: string; accountName: string;
  status: 'pending' | 'paid' | 'rejected'; reason: string | null; decidedAt: string | null; decidedByName: string | null; createdAt: string;
}

const STATUS = { pending: ['warn', 'Menunggu'], paid: ['ok', 'Sudah ditransfer'], rejected: ['bad', 'Ditolak'] } as const;
const stamp = (s: string) => new Date(s).toLocaleString('id-ID');

function RejectDialog({ w, onClose }: { w: Withdrawal; onClose: () => void }) {
  const act = useAct();
  const f = useForm({ reason: '' });
  return (
    <Modal title={`Tolak ${w.no}`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Kembali</Btn>
      <Btn kind="d" disabled={act.busy || f.v.reason.trim().length < 3} onClick={() => act.post(`/withdrawals/${w.id}/reject`, `${w.no} ditolak; saldo dikembalikan ke anggota`, { reason: f.v.reason.trim() }, onClose)}>Tolak penarikan</Btn>
    </>}>
      <p className="note">Saldo {R(w.amount)} otomatis kembali ke saldo penarikan {w.memberName}.</p>
      <Field {...f.bind('reason', 'Alasan (dilihat anggota)', 'mis. nomor rekening tidak sesuai')} focus />
    </Modal>
  );
}

function PayDialog({ w, onClose }: { w: Withdrawal; onClose: () => void }) {
  const act = useAct();
  return (
    <Modal title={`Tandai ${w.no} sudah ditransfer`} open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Kembali</Btn>
      <Btn disabled={act.busy} onClick={() => act.post(`/withdrawals/${w.id}/pay`, `${w.no} ditandai sudah ditransfer`, {}, onClose)}>Ya, sudah saya transfer</Btn>
    </>}>
      <p>Transfer <b>{R(w.amount)}</b> ke <b>{w.bank} {w.accountNo}</b> a.n. <b>{w.accountName}</b> lebih dulu di luar aplikasi, lalu tandai di sini. Tindakan ini tidak bisa dibatalkan.</p>
    </Modal>
  );
}

type Dialog = { kind: 'pay' | 'reject'; w: Withdrawal } | null;

/** Penarikan saldo anggota (pengurus): transfer di luar aplikasi, lalu tandai sudah dibayar; atau tolak dan saldo kembali. */
export default function WithdrawalsPage() {
  const q = useData<Withdrawal[]>('/withdrawals');
  const [dlg, setDlg] = useState<Dialog>(null);
  const rows = q.data ?? [];
  return (
    <>
      <PageHead title="Penarikan saldo" desc="Pengajuan tarik saldo penarikan anggota (20% dari belanja yang sudah diterima). Transfer dulu ke rekening anggota di luar aplikasi, lalu tandai sudah dibayar." />
      <div className="page">
        <Gate q={q}>
          <Block title="Pengajuan penarikan" note="Saldo anggota ditahan saat mengajukan. Bila ditolak, saldo otomatis kembali.">
            <Table rows={rows} empty="Belum ada pengajuan penarikan." cols={[
              { head: 'Pengajuan', cell: (x) => <><b>{x.no}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{stamp(x.createdAt)}</div></> },
              { head: 'Anggota', cell: (x) => <>{x.memberName}<div style={{ fontSize: 12, color: 'var(--muted)' }}>{x.memberNo ?? '—'}</div></> },
              { head: 'Jumlah', mono: true, right: true, cell: (x) => R(x.amount) },
              { head: 'Rekening', cell: (x) => <>{x.bank} {x.accountNo}<div style={{ fontSize: 12, color: 'var(--muted)' }}>a.n. {x.accountName}</div></> },
              { head: 'Status', cell: (x) => <><Badge tone={STATUS[x.status][0]}>{STATUS[x.status][1]}</Badge>{x.reason ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{x.reason}</div> : null}</> },
            ]} actions={(x) => (x.status === 'pending' ? (<>
              <Btn sm onClick={() => setDlg({ kind: 'pay', w: x })}>Sudah ditransfer…</Btn>
              <Btn sm kind="d" onClick={() => setDlg({ kind: 'reject', w: x })}>Tolak…</Btn>
            </>) : null)} />
          </Block>
        </Gate>
      </div>
      {dlg?.kind === 'pay' && <PayDialog key={dlg.w.id} w={dlg.w} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'reject' && <RejectDialog key={dlg.w.id} w={dlg.w} onClose={() => setDlg(null)} />}
    </>
  );
}
