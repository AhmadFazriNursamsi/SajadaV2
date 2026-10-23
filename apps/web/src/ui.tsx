import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ToastCtx } from './hooks';

export type Tone = 'ok' | 'warn' | 'bad' | '';

export const Badge = ({ tone = '', children }: { tone?: Tone; children: ReactNode }) => (tone ? <span className={`badge ${tone}`}>{children}</span> : <>{children}</>);

export function Kpi({ l, v, n, tone, to }: { l: string; v: ReactNode; n?: string; tone?: Tone; to?: string }) {
  const color = tone === 'bad' ? 'var(--bad-fg)' : tone === 'warn' ? 'var(--gold-ink)' : tone === 'ok' ? 'var(--green)' : 'var(--muted)';
  const body = <><div className="l">{l}</div><div className="v">{v}</div><div className="n" style={{ color }}>{n ?? '\u00a0'}</div></>;
  return to ? <Link to={to} className="kpi link" aria-label={`${l}: buka halaman terkait`}>{body}</Link> : <div className="kpi">{body}</div>;
}
export const Kpis = ({ children }: { children: ReactNode }) => <div className="kpis">{children}</div>;

export function PageHead({ title, desc }: { title: string; desc: string }) {
  return <div className="page-head"><h1>{title}</h1><p>{desc}</p></div>;
}

export function Block({ title, note, tools, children }: { title: string; note?: string; tools?: ReactNode; children?: ReactNode }) {
  return (
    <section className="block">
      <div className="block-h"><div><b>{title}</b>{note && <small>{note}</small>}</div>{tools && <div className="tools">{tools}</div>}</div>
      {children}
    </section>
  );
}

export interface Col<T> { head: string; cell: (r: T) => ReactNode; mono?: boolean; right?: boolean; /** lebar kolom (mis. '140px'); dipakai bersama `fixed` */ w?: string }
export function Table<T extends object>({ cols, rows, empty = 'Belum ada data.', actions, onRow, fixed, actionsW }: { cols: Col<T>[]; rows: T[]; empty?: string; actions?: (r: T) => ReactNode; onRow?: (r: T) => void; fixed?: boolean; actionsW?: string }) {
  const keys = useRef({ ids: new WeakMap<object, number>(), n: 0 });
  const keyOf = (r: T): string => {
    const id = (r as { id?: string }).id;
    if (id) return id;
    const k = keys.current;
    if (!k.ids.has(r)) k.ids.set(r, ++k.n);
    return `r${k.ids.get(r)}`;
  };
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="tbl-wrap">
      <table className={fixed ? 'fixed' : undefined}>
        <thead><tr>{cols.map((c) => <th key={c.head} className={c.right ? 'r' : ''} style={c.w ? { width: c.w } : undefined}>{c.head}</th>)}{actions && <th style={actionsW ? { width: actionsW } : undefined} />}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={keyOf(r)} className={onRow ? 'click' : undefined} tabIndex={onRow ? 0 : undefined} onClick={onRow ? () => onRow(r) : undefined} onKeyDown={onRow ? (e) => { if (e.key === 'Enter') onRow(r); } : undefined}>
              {cols.map((c) => <td key={c.head} className={`${c.mono ? 'mono' : ''} ${c.right ? 'r' : ''}`}>{c.cell(r)}</td>)}
              {actions && <td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><div className="acts">{actions(r)}</div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface FieldProps {
  label: string; value: string; onChange: (v: string) => void; ph?: string; type?: string; options?: { value: string; label: string }[];
  id?: string; /** fokus awal saat dialog dibuka */ focus?: boolean; /** dipanggil saat menekan Enter */ onEnter?: () => void; /** pesan kesalahan di bawah kolom */ error?: string; hint?: string;
}

/** Kontrol isian: pilihan (select), teks panjang (textarea), atau input biasa. */
function FieldControl({ value, onChange, ph, type = 'text', options, id, focus, onEnter, error }: FieldProps) {
  const af = focus ? '' : undefined;
  if (options) return <select id={id} value={value} data-autofocus={af} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  if (type === 'rupiah') {
    const digits = value.replace(/\D/g, '');
    return <input id={id} type="text" inputMode="numeric" value={digits ? Number(digits).toLocaleString('id-ID') : ''} placeholder={ph ?? '0'} data-autofocus={af}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } } : undefined} />;
  }
  if (type === 'textarea') return <textarea id={id} rows={4} value={value} placeholder={ph} data-autofocus={af} onChange={(e) => onChange(e.target.value)} />;
  return (
    <input id={id} type={type} value={value} placeholder={ph} data-autofocus={af} aria-invalid={error ? true : undefined}
      onChange={(e) => onChange(e.target.value)} onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } } : undefined} />
  );
}

export function Field(props: FieldProps) {
  const { label, error, hint } = props;
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <label className="field" htmlFor={id}>{label}
      <FieldControl {...props} id={id} />
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint-sm">{hint}</span> : null}
    </label>
  );
}
export const Fields = ({ children }: { children: ReactNode }) => <div className="fields">{children}</div>;

// ---- Toast + aksi -------------------------------------------------------------------------
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pop = useRef<HTMLDivElement>(null);
  // Lapisan teratas (popover) agar toast tetap terlihat walau dialog modal sedang terbuka.
  useEffect(() => {
    const el = pop.current;
    if (!t || !el) return;
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover();
  }, [t]);
  const show = useCallback((msg: string, ok = true) => {
    setT({ msg, ok });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div ref={pop} popover="manual" className={`toast ${t.ok ? '' : 'err'}`} role="status" aria-live="polite">{t.msg}</div>}
    </ToastCtx.Provider>
  );
}

export function Btn({ children, onClick, kind = 'p', sm, disabled }: { children: ReactNode; onClick: () => void; kind?: 'p' | 's' | 'g' | 'd'; sm?: boolean; disabled?: boolean }) {
  return <button type="button" className={`btn ${kind === 'p' ? '' : kind} ${sm ? 'sm' : ''}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

export const Loading = () => <div className="empty">Memuat…</div>;
export function Gate({ q, children }: { q: { isLoading: boolean; error: unknown; data: unknown }; children: ReactNode }) {
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="empty" role="alert">Gagal memuat: {(q.error as Error).message}</div>;
  return <>{children}</>;
}

/**
 * Dialog (pop up) bersama. Tutup dengan Esc, klik latar, atau tombol Batal. Fokus pindah ke kolom pertama dan
 * kembali ke pemicu saat ditutup; Tab tidak keluar dari dialog.
 */
export function Modal({ title, open, onClose, children, footer, wide, xl, lg }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; /** formulir lebar: header dan tombol tetap terlihat, isi bergulir */ lg?: boolean; /** lebar penuh untuk tabel kerja (mis. hitung opname, kartu stok) */ xl?: boolean }) {
  const box = useRef<HTMLDialogElement>(null);
  // `onClose` biasanya fungsi inline yang berubah tiap render; simpan di ref agar efek fokus hanya berjalan saat dialog dibuka/ditutup
  // (kalau tidak, fokus terus dipaksa kembali ke kolom pertama setiap isian berubah).
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const d = box.current;
    if (!open || !d) return;
    const onCancel = (e: Event) => { e.preventDefault(); closeRef.current(); };
    const onBackdrop = (e: MouseEvent) => { if (e.target === d) closeRef.current(); }; // klik di luar kotak dialog
    d.addEventListener('cancel', onCancel); d.addEventListener('mousedown', onBackdrop);
    d.showModal(); // dialog bawaan browser: fokus terkunci di dalam dialog, Esc menutup, fokus kembali ke pemicu
    (d.querySelector<HTMLElement>('[data-autofocus]') ?? d.querySelector<HTMLElement>('input:not([readonly]), select, textarea'))?.focus();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { d.removeEventListener('cancel', onCancel); d.removeEventListener('mousedown', onBackdrop); document.body.style.overflow = overflow; d.close(); };
  }, [open]);
  if (!open) return null;
  return (
    <dialog className={`modal ${wide ? 'wide' : ''} ${xl ? 'xl' : ''} ${lg ? 'lg' : ''}`} aria-label={title} ref={box}>
      <div className="modal-h"><b>{title}</b><button type="button" className="modal-x" aria-label="Tutup" onClick={onClose}>✕</button></div>
      <div className="modal-b">{children}</div>
      {footer && <div className="modal-f">{footer}</div>}
    </dialog>
  );
}

/** Kolom hanya-baca (mis. nomor anggota otomatis). */
export function ReadOnlyField({ label, value, placeholder, hint }: { label: string; value: string; placeholder?: string; hint?: string }) {
  return (
    <label className="field">{label}
      <input className="ro mono" readOnly aria-readonly="true" value={value} placeholder={placeholder} tabIndex={-1} />
      {hint && <span className="hint-sm">{hint}</span>}
    </label>
  );
}

/**
 * Combo box pilihan murni: kolom TIDAK bisa diketik. Klik (atau Enter/Spasi/panah bawah) membuka daftar; pilih dengan klik,
 * panah atas/bawah + Enter, atau ketik huruf awal untuk melompat ke item (seperti dropdown bawaan). Esc menutup daftar.
 * Nilai kosong ('') berarti belum memilih.
 */
export function Combobox({ label, value, onChange, options, placeholder = 'Pilih…', emptyText = 'Tidak ada pilihan' }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; emptyText?: string;
}) {
  const id = useId();
  const selected = options.find((o) => o.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef({ text: '', at: 0 });
  const list = useRef<HTMLUListElement>(null);

  const show = () => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const pick = (o: { value: string; label: string }) => { onChange(o.value); setOpen(false); };
  // gulir item aktif agar selalu terlihat
  useEffect(() => { if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [open, active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); else setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) setActive((a) => Math.max(a - 1, 0)); }
    else if ((e.key === 'Enter' || e.key === ' ') && !open) { e.preventDefault(); show(); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (options[active]) pick(options[active]!); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } // tutup daftar saja, jangan tutup dialog
    else if (e.key === 'Home' && open) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && open) { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // ketik huruf awal: lompat ke item yang diawali (gabungan huruf dalam 700 ms), lalu yang mengandung
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const t = typed.current.text;
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(t));
      const j = i >= 0 ? i : options.findIndex((o) => o.label.toLowerCase().includes(t));
      if (j >= 0) { setActive(j); setOpen(true); }
      e.preventDefault();
    }
  };

  return (
    <div className="field combo">
      <label htmlFor={id}>{label}</label>
      <div className="combo-box">
        <input
          id={id} role="combobox" readOnly aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="listbox" autoComplete="off"
          aria-activedescendant={open && options[active] ? `${id}-o${active}` : undefined}
          value={selected?.label ?? ''} placeholder={placeholder}
          onClick={() => (open ? setOpen(false) : show())} onBlur={() => setOpen(false)} onKeyDown={onKey}
        />
        <span className="combo-caret" aria-hidden="true" onMouseDown={(e) => { e.preventDefault(); const el = e.currentTarget.previousSibling as HTMLInputElement; if (open) setOpen(false); else { el.focus(); show(); } }}>▾</span>
        {open && (
          <ul id={`${id}-list`} ref={list} role="listbox" className="combo-list">
            {options.length === 0 && <li className="combo-empty">{emptyText}</li>}
            {options.map((o, i) => (
              <li key={o.value} id={`${id}-o${i}`} role="option" aria-selected={o.value === value} data-active={i === active} className={`combo-opt ${i === active ? 'active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}>{o.label}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Pilihan satu-dari-beberapa (segmented control), mis. mode isian. */
export function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="field" role="radiogroup" aria-label={label}>
      {label}
      <div className="seg">
        {options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
      </div>
    </div>
  );
}
