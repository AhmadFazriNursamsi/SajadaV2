import { useEffect, useState, type ReactElement } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '@sajadah/shared';
import { useSession } from './session';
import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import { useData } from './hooks';
import type { Overview } from './types';
import Login from './pages/Login';
import { ChangePasswordModal, ForcePasswordChange } from './pages/ChangePassword';
import OverviewPage from './pages/Overview';
import MembersPage from './pages/Members';
import InventoryPage from './pages/Inventory';
import NetworkPage from './pages/Network';
import RewardsPage from './pages/Rewards';
import { MLM_ENABLED } from './features';
import RegionPage from './pages/Region';
import DepotPage from './pages/Depot';
import AppDownloadPage from './pages/AppDownload';
import SettingsPage from './pages/Settings';
import MemberHome from './pages/MemberHome';
import SchemePage from './pages/Scheme';
import AuditLogPage from './pages/AuditLog';
import ReportPage from './pages/Report';
import MyNetworkPage from './pages/MyNetwork';
import ProductsPage from './pages/Products';
import OrdersPage from './pages/Orders';
import WithdrawalsPage from './pages/Withdrawals';
import VouchersPage from './pages/Vouchers';
import InstallmentsPage from './pages/Installments';

const ADMIN: Role[] = ['tenant_admin'];
/** Petugas toko (terkunci ke tokonya): tiap pekerjaan toko menjadi menu sendiri. Selebihnya hanya pengurus. */
const STAFF_ONLY: Role[] = ['staff'];
const ROUTES: { path: string; label: string; el: ReactElement; roles: Role[]; badge?: (o: Overview) => number; /** tetap bisa dibuka lewat alamat, tapi tidak tampil di sidebar */ hidden?: boolean; /** fitur MLM: hanya aktif bila MLM_ENABLED */ mlm?: boolean }[] = [
  { path: '/', label: 'Ringkasan', el: <OverviewPage />, roles: ADMIN },
  { path: '/anggota', label: 'Anggota koperasi', el: <MembersPage />, roles: ADMIN },
  { path: '/depot', label: 'Toko', el: <DepotPage />, roles: ADMIN },
  { path: '/pesanan', label: 'Pesanan', el: <OrdersPage />, roles: ADMIN, badge: (o) => o.actions.awaitingApproval },
  { path: '/persediaan', label: 'Persediaan', el: <InventoryPage />, roles: ADMIN, badge: (o) => o.actions.stockRequests },
  { path: '/pesanan', label: 'Pesanan', el: <OrdersPage />, roles: STAFF_ONLY },
  { path: '/persediaan', label: 'Stok toko', el: <InventoryPage view="stok" />, roles: STAFF_ONLY },
  { path: '/minta-stok', label: 'Minta stok ke pusat', el: <InventoryPage view="minta" />, roles: STAFF_ONLY },
  { path: '/opname', label: 'Stok opname', el: <InventoryPage view="opname" />, roles: STAFF_ONLY },
  { path: '/produk', label: 'Produk', el: <ProductsPage />, roles: ADMIN },
  { path: '/jaringan', label: 'Jaringan MLM', el: <NetworkPage />, roles: ADMIN, mlm: true },
  { path: '/penarikan', label: 'Penarikan saldo', el: <WithdrawalsPage />, roles: ADMIN, badge: (o) => o.actions.withdrawalsPending },
  { path: '/voucher', label: 'Voucher koin', el: <VouchersPage />, roles: ADMIN, badge: (o) => o.actions.redemptionsPending },
  { path: '/tagihan', label: 'Tagihan harian', el: <InstallmentsPage />, roles: ADMIN },
  { path: '/pendapatan', label: 'Imbalan anggota', el: <RewardsPage />, roles: ADMIN },
  { path: '/wilayah', label: 'Struktur daerah', el: <RegionPage />, roles: ADMIN },
  { path: '/log', label: 'Log aktivitas', el: <AuditLogPage />, roles: ADMIN },
  { path: '/aplikasi', label: 'Aplikasi HP', el: <AppDownloadPage />, roles: ADMIN },
  { path: '/pengaturan', label: 'Pengaturan', el: <SettingsPage />, roles: ADMIN, hidden: true },
  { path: '/saya', label: 'Hak saya', el: <MemberHome />, roles: ['member'] },
  { path: '/laporan', label: 'Laporan penjualan', el: <ReportPage />, roles: ['member'], mlm: true },
  { path: '/jaringan-saya', label: 'Jaringan saya', el: <MyNetworkPage />, roles: ['member'], mlm: true },
  { path: '/skema', label: 'Skema komisi', el: <SchemePage />, roles: ['tenant_admin', 'member'], hidden: true, mlm: true },
];

const ROLE_LABEL: Record<Role, string> = { tenant_admin: 'Pengurus', staff: 'Petugas', member: 'Anggota' };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

const NAV_KEY = 'sajadah.nav';
const isNarrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches;

/** Status sidebar: ingat pilihan pengguna; default tertutup di layar sempit. */
function useSidebar() {
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(NAV_KEY); if (v) return v === 'open'; } catch { /* storage diblokir */ }
    return !isNarrow();
  });
  useEffect(() => { try { localStorage.setItem(NAV_KEY, open ? 'open' : 'closed'); } catch { /* abaikan */ } }, [open]);
  return [open, setOpen] as const;
}


type DepotTasks = { actions: { awaitingApproval: number; paidNotShipped: number; memberReports: number }; opname?: { state: 'ok' | 'due' | 'locked'; month: string; dueDate: string | null; daysLeft: number | null } | null; opnameLocked?: { name: string; month: string }[] };

/** Kewajiban stok opname bulanan: petugas diperingatkan mendekati akhir bulan dan diberi tahu bila tokonya dikunci; pengurus melihat toko yang dikunci. */
function OpnameBanner({ t }: { t?: DepotTasks }) {
  const o = t?.opname;
  if (o?.state === 'locked') return <div className="optice bad" role="alert"><b>Transaksi toko dikunci.</b> Stok opname bulan {o.month} belum diajukan. Pesanan, pembayaran, pengiriman, dan stok masuk baru bisa dilanjutkan setelah opname diajukan. <NavLink to="/opname">Buka Stok opname →</NavLink></div>;
  if (o?.state === 'due') return <div className="optice warn" role="status"><b>Stok opname bulan {o.month} jatuh tempo {o.dueDate}</b> ({o.daysLeft} hari lagi). Bila terlewat, transaksi toko dikunci. <NavLink to="/opname">Buka Stok opname →</NavLink></div>;
  if (t?.opnameLocked?.length) return <div className="optice bad" role="alert"><b>Toko dikunci karena stok opname terlewat:</b> {t.opnameLocked.map((d) => `${d.name} (${d.month})`).join(', ')}. Petugas tokonya perlu mengajukan opname.</div>;
  return null;
}

function Shell() {
  const { me, logout } = useSession();
  const [open, setOpen] = useSidebar();
  const loc = useLocation();
  const [pwOpen, setPwOpen] = useState(false);
  // Layar sempit: tutup menu setelah berpindah halaman.
  useEffect(() => { if (isNarrow()) setOpen(false); }, [loc.pathname, setOpen]);
  const staff = me!.role === 'tenant_admin'; // lencana menu memakai ringkasan pengurus
  const ov = useData<Overview>('/overview', staff);
  // Petugas: angka pekerjaan toko untuk lencana menu Pesanan; diperbarui berkala agar pesanan baru anggota langsung terlihat.
  const tasks = useQuery({ queryKey: ['/overview/depot-tasks'], queryFn: () => get<DepotTasks>('/overview/depot-tasks'), enabled: me!.role !== 'member', refetchInterval: 20_000 });
  const routes = ROUTES.filter((r) => r.roles.includes(me!.role) && (MLM_ENABLED || !r.mlm));
  return (
    <div className="app">
      {!open && <button type="button" className="toggle float" aria-label="Buka menu" aria-expanded={false} aria-controls="sidebar" onClick={() => setOpen(true)}>☰</button>}
      <aside id="sidebar" className={`side ${open ? '' : 'closed'}`} aria-hidden={!open}>
        <div className="brand-row">
          <NavLink to={routes[0]!.path} className="logo-plate" aria-label="Sajadah — ke beranda"><img src="/brand/sajada-horizontal.png" alt="Sajadah" /></NavLink>
        </div>
        <div className="brand-sub">Tumbuh bersama, berdaya bersama.</div>
        {ov.data && <div className="label">{ov.data.tenant.name}</div>}
        <nav aria-label="Menu utama" style={{ display: 'contents' }}>
          {routes.filter((r) => !r.hidden).map((r) => {
            const n = r.path === '/pesanan' && me!.role === 'staff' ? (tasks.data ? tasks.data.actions.awaitingApproval + tasks.data.actions.paidNotShipped + tasks.data.actions.memberReports : 0) : ov.data && r.badge ? r.badge(ov.data) : 0;
            return <NavLink key={r.path} to={r.path} end className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}><span>{r.label}</span>{n > 0 && <span className="pill">{n}</span>}</NavLink>;
          })}
        </nav>
        <div className="who">
          <div className="who-card">
            <span className="avatar" aria-hidden="true">{initials(me!.name)}</span>
            <div className="who-text"><b title={me!.name}>{me!.name}</b><span className="role">{ROLE_LABEL[me!.role]}</span></div>
          </div>
          <div className="who-actions">
            <button type="button" className="who-btn" onClick={() => setPwOpen(true)}>
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="4.5" y="9" width="11" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>Ganti kata sandi
            </button>
            <button type="button" className="who-btn" aria-label="Tutup menu" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(false)}>
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Tutup menu
            </button>
            <button type="button" className="who-btn out" onClick={logout}>
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8M12 6.5 15.5 10 12 13.5M15.5 10H8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>Keluar
            </button>
          </div>
        </div>
      </aside>
      <main className={`main ${open ? '' : 'sidebar-closed'}`}>
        <OpnameBanner t={tasks.data} />
        <Routes>
          {routes.map((r) => <Route key={r.path} path={r.path} element={r.el} />)}
          <Route path="/pengadaan" element={<Navigate to="/persediaan" replace />} />
          <Route path="/stok-pusat" element={<Navigate to="/persediaan" replace />} />
          <Route path="*" element={<Navigate to={routes[0]!.path} replace />} />
        </Routes>
      </main>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

export default function App() {
  const { me, loading } = useSession();
  if (loading) return <div className="login">Memuat…</div>;
  if (!me) return <Login />;
  return me.mustChangePassword ? <ForcePasswordChange /> : <Shell />;
}
