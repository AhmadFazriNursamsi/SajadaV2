import { useEffect, useState } from 'react';
import { Combobox } from './ui';
import { useData } from './hooks';
import { useSession } from './session';
import type { DepotRow } from './types';

/**
 * Toko yang sedang dilihat. Petugas toko terkunci ke tokonya; pengurus memilih (default: toko aktif pertama).
 * `ready` false selama daftar toko belum dimuat, supaya data stok tidak diminta tanpa toko.
 */
export function useDepot() {
  const { me } = useSession();
  const q = useData<DepotRow[]>('/depots');
  const list = (q.data ?? []).filter((d) => d.active);
  const [sel, setSel] = useState('');
  const locked = !!q.data && me?.role === 'staff' && list.length === 1;
  const current = list.find((d) => d.id === sel) ?? list[0];
  useEffect(() => { if (!sel && list[0]) setSel(list[0].id); }, [sel, list]);
  return { depots: list, depot: current, depotId: current?.id ?? '', setDepotId: setSel, locked, ready: !!current, query: q };
}

/** Combo pilih toko (disembunyikan bila hanya ada satu toko). */
export function DepotPicker({ d }: { d: ReturnType<typeof useDepot> }) {
  if (d.depots.length < 2) return d.depot ? <p className="note" style={{ margin: 0 }}>Toko: <b>{d.depot.name}</b></p> : null;
  return <Combobox label="Toko" value={d.depotId} onChange={d.setDepotId} options={d.depots.map((x) => ({ value: x.id, label: x.name }))} />;
}
