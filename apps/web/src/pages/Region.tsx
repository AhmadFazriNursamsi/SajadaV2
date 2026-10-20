import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { REGION_LABEL, REGION_LEVELS, type RegionLevel } from '@sajadah/shared';
import { Badge, Block, Btn, Combobox, Field, Gate, Kpi, Kpis, Modal, PageHead, ReadOnlyField, Segmented } from '../ui';
import { useAct, useData } from '../hooks';
import { get } from '../api';
import type { MasterItem, MemberRow, RegionRow } from '../types';
import { useSession } from '../session';

const PARENT: Record<RegionLevel, RegionLevel | null> = { province: null, regency: 'province', district: 'regency', village: 'district' };
const CHILD: Record<RegionLevel, RegionLevel | null> = { province: 'regency', regency: 'district', district: 'village', village: null };
const EXAMPLE: Record<RegionLevel, string> = { province: 'mis. Jawa Barat', regency: 'mis. Kabupaten Bandung', district: 'mis. Cileunyi', village: 'mis. Cibiru Hilir' };

const MANUAL = '__manual__';

/** Data referensi wilayah dari database server (tanpa jaringan). Nonaktif bila `enabled` false. */
function useMaster(level: RegionLevel, parent: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['master', level, parent ?? ''],
    queryFn: () => get<{ source: string; available: boolean; items: MasterItem[] }>(`/master/wilayah?level=${level}${parent ? `&parent=${parent}` : ''}`),
    enabled,
    staleTime: 10 * 60_000,
  });
}
const CHILD_LABEL: Record<RegionLevel, string> = { province: 'kabupaten/kota', regency: 'kecamatan', district: 'kelurahan/desa', village: '' };
const byCodeName = (a: RegionRow, b: RegionRow) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name);


interface NodeProps { r: RegionRow; rows: RegionRow[]; depth: number; collapsed: Set<string>; toggle: (id: string) => void; canEdit: boolean; onAdd: (l: RegionLevel, p: RegionRow) => void; onDelete: (r: RegionRow) => void }

/** Satu baris pohon + anak-anaknya (rekursif). */
function TreeNode({ r, rows, depth, collapsed, toggle, canEdit, onAdd, onDelete }: NodeProps) {
  const kids = rows.filter((k) => k.parentId === r.id).sort(byCodeName);
  const open = !collapsed.has(r.id);
  const child = CHILD[r.level];
  return (
    <div role="treeitem" aria-level={depth + 1} aria-expanded={kids.length ? open : undefined} className="tnode">
      <div className="trow">
        {kids.length ? <button type="button" className="ttoggle" aria-label={`${open ? 'Lipat' : 'Buka'} ${r.name}`} onClick={() => toggle(r.id)}>{open ? '▾' : '▸'}</button> : <span className="tdot" aria-hidden="true" />}
        <span className="tname">{r.name}</span>
        <span className="lvl">{REGION_LABEL[r.level]}</span>
        <span className="tcode" title="Kode lokal; membentuk nomor anggota">kode {r.code}</span>
        {kids.length > 0 && <span className="tmeta">{kids.length} {CHILD_LABEL[r.level]}</span>}
        {r.level === 'village' && <span className="tmeta">{r.members} anggota</span>}
        {canEdit && (
          <span className="tacts">
            {child && <Btn sm kind="g" onClick={() => onAdd(child, r)}>+ Sub-wilayah</Btn>}
            {kids.length === 0 && r.members === 0 && <Btn sm kind="d" onClick={() => onDelete(r)}>Hapus</Btn>}
          </span>
        )}
      </div>
      {kids.length > 0 && open && (
        <div role="group" className="tchildren">
          {kids.map((k) => <TreeNode key={k.id} r={k} rows={rows} depth={depth + 1} collapsed={collapsed} toggle={toggle} canEdit={canEdit} onAdd={onAdd} onDelete={onDelete} />)}
        </div>
      )}
    </div>
  );
}

type Master = ReturnType<typeof useMaster>;
const exampleOf = (l: RegionLevel) => EXAMPLE[l];

// ---- Dialog tambah wilayah ----------------------------------------------------------------------

/** Validasi langsung untuk isian manual: nama tidak boleh sama dengan wilayah lain pada induk yang sama. */
function duplicateName(level: RegionLevel, name: string, siblings: RegionRow[]): string {
  const n = name.trim();
  if (!n || !siblings.some((s) => s.name.toLowerCase() === n.toLowerCase())) return '';
  return `${REGION_LABEL[level]} “${n}” sudah ada pada induk ini.`;
}

/** Daftar nama dari data referensi (BPS) untuk satu tingkat, tanpa yang sudah ada pada induk yang sama. */
function useRegionChoices(level: RegionLevel, parent: RegionRow | undefined, siblings: RegionRow[], pick: string) {
  // Data referensi: hanya bila induknya juga dari data referensi (punya sourceCode).
  const canList = PARENT[level] === null || !!parent?.sourceCode;
  const master = useMaster(level, parent?.sourceCode ?? undefined, canList);
  const loadingList = canList && master.isLoading;
  const unavailable = !!master.data && !master.data.available;
  const listDown = listProblem(level, parent, master);
  const choices = availableItems(master.data?.items ?? [], siblings);
  const manual = !!listDown || pick === MANUAL || (canList && !loadingList && !master.isError && choices.length === 0);
  return { master, canList, loadingList, unavailable, listDown, choices, manual, chosen: choices.find((c) => c.code === pick) };
}

/** Mengapa daftar referensi tidak bisa dipakai ('' = bisa). */
function listProblem(level: RegionLevel, parent: RegionRow | undefined, master: Master): '' | 'induk-manual' | 'galat' | 'kosong' {
  if (PARENT[level] !== null && parent && !parent.sourceCode) return 'induk-manual';
  if (master.isError) return 'galat';
  return master.data && !master.data.available ? 'kosong' : '';
}

/** Item referensi yang belum ada pada induk yang sama (cocok menurut kode atau nama). */
function availableItems(items: MasterItem[], siblings: RegionRow[]): MasterItem[] {
  return items.filter((i) => !siblings.some((s) => s.sourceCode === i.code || s.name.toLowerCase() === i.name.toLowerCase()));
}

/** Induk yang berlaku untuk tingkat terpilih; dipilih otomatis bila hanya ada satu pilihan (ramah pengguna). */
function resolveParent(rows: RegionRow[], level: RegionLevel, pickedParent: string) {
  const parentLevel = PARENT[level];
  const parents = parentLevel ? rows.filter((r) => r.level === parentLevel) : [];
  const parentId = pickedParent || (parents.length === 1 ? parents[0]!.id : '');
  const parent = parentLevel ? parents.find((r) => r.id === parentId) : undefined;
  return { parentLevel, parents, parentId, parent, parentOk: parentLevel === null || !!parent };
}

/** Pilihan nama dari data referensi, kondisi daftar, dan validasi untuk dialog tambah. */
function useAddRegion(rows: RegionRow[], preset: { level: RegionLevel; parent?: RegionRow }, expand: (id?: string) => void, onClose: () => void) {
  const act = useAct();
  const [level, setLevel] = useState<RegionLevel>(preset.level);
  const [pickedParent, setPickedParent] = useState(preset.parent?.id ?? '');
  const [name, setName] = useState('');
  const [pick, setPick] = useState(''); // kode referensi yang dipilih, atau MANUAL
  const [again, setAgain] = useState(false);
  const { parentLevel, parents, parentId, parent, parentOk } = resolveParent(rows, level, pickedParent);
  const siblings = rows.filter((r) => r.level === level && r.parentId === (parent?.id ?? null));
  const { master, canList, loadingList, unavailable, listDown, choices, manual, chosen } = useRegionChoices(level, parent, siblings, pick);
  const nameErr = manual ? duplicateName(level, name, siblings) : '';
  const canSave = !act.busy && parentOk && (manual ? !!name.trim() && !nameErr : !!chosen);
  const changeLevel = (l: RegionLevel) => { setLevel(l); setPickedParent(''); setName(''); setPick(''); };
  const changeParent = (id: string) => { setPickedParent(id); setName(''); setPick(''); };

  const done = () => {
    if (parent) expand(parent.id);
    if (!again) return onClose();
    setName(''); setPick(''); // tetap di tingkat & induk yang sama untuk menambah berikutnya
    setTimeout(() => document.getElementById('region-name')?.focus(), 60);
  };
  const save = () => {
    if (!canSave) return;
    const base = { level, parentId: parent?.id ?? null };
    if (manual) act.post('/regions', `${REGION_LABEL[level]} ${name.trim()} ditambahkan`, { ...base, name: name.trim() }, done);
    else act.post('/regions/from-master', `${REGION_LABEL[level]} ${chosen!.name} ditambahkan`, { ...base, sourceCode: chosen!.code }, done);
  };
  return { level, parentLevel, parents, parentId, parentOk, name, setName, pick, setPick, again, setAgain, master, canList, loadingList, unavailable, listDown, choices, manual, nameErr, canSave, changeLevel, changeParent, save };
}
type AddState = ReturnType<typeof useAddRegion>;

function ListNotices({ a }: { a: AddState }) {
  const { listDown, master, canList, loadingList, unavailable, choices, pick } = a;
  const allAdded = canList && !master.isError && !loadingList && !unavailable && choices.length === 0 && (master.data?.items.length ?? 0) > 0;
  return (
    <>
      {listDown === 'induk-manual' && <p className="note">Induk ini ditambahkan manual, sehingga daftar wilayah tidak tersedia untuk isinya. Isi nama secara manual.</p>}
      {listDown === 'galat' && <p className="note" role="alert">{(master.error as Error)?.message ?? 'Daftar wilayah tidak dapat dimuat.'}</p>}
      {listDown === 'kosong' && <p className="note">Data referensi wilayah belum tersedia di server. Isi nama secara manual.</p>}
      {allAdded && <p className="note">Semua wilayah pada daftar untuk induk ini sudah ditambahkan. Isi manual bila perlu.</p>}
      {pick && pick !== MANUAL && <p className="note">Nama dan kode lokal diambil dari data referensi wilayah (BPS).</p>}
    </>
  );
}

function NameFields({ a }: { a: AddState }) {
  const { level, master, canList, loadingList, choices, manual, listDown, pick } = a;
  const showPicker = !loadingList && canList && !master.isError && choices.length > 0;
  return (
    <>
      {loadingList && <p className="note">Memuat daftar wilayah…</p>}
      {showPicker && (
        <Combobox label={`Nama ${REGION_LABEL[level].toLowerCase()}`} value={pick} onChange={a.setPick} placeholder="Pilih nama wilayah…"
          options={[...choices.map((c) => ({ value: c.code, label: c.name })), { value: MANUAL, label: '✎ Tidak ada di daftar — isi manual' }]} />
      )}
      {manual && !loadingList && (
        <Field id="region-name" focus label={`Nama ${REGION_LABEL[level].toLowerCase()}${showPicker ? ' (manual)' : ''}`} value={a.name} onChange={a.setName} ph={exampleOf(level)} onEnter={a.save} error={a.nameErr} hint={pick === MANUAL || listDown ? 'Kode lokal ditetapkan otomatis.' : undefined} />
      )}
      <ListNotices a={a} />
    </>
  );
}

function ParentFields({ a }: { a: AddState }) {
  const pl = a.parentLevel;
  if (!pl) return null;
  return (
    <>
      <Combobox label={`Berada di bawah (${REGION_LABEL[pl]})`} value={a.parentId} onChange={a.changeParent} options={a.parents.map((p) => ({ value: p.id, label: p.path.join(', ') }))} placeholder="Pilih induk…" emptyText={`Belum ada ${REGION_LABEL[pl]}`} />
      {a.parents.length === 0 && <p className="note">Belum ada {REGION_LABEL[pl]}. <Btn sm kind="g" onClick={() => a.changeLevel(pl)}>Tambah {REGION_LABEL[pl]} dulu</Btn></p>}
    </>
  );
}

/** Dialog tambah wilayah; dipasang hanya saat terbuka sehingga isian selalu mulai dari awal. */
function AddRegionDialog({ rows, preset, expand, onClose }: { rows: RegionRow[]; preset: { level: RegionLevel; parent?: RegionRow }; expand: (id?: string) => void; onClose: () => void }) {
  const a = useAddRegion(rows, preset, expand, onClose);
  return (
    <Modal wide title="Tambah wilayah" open onClose={onClose} footer={<>
      <label className="check" style={{ marginRight: 'auto' }}><input type="checkbox" checked={a.again} onChange={(e) => a.setAgain(e.target.checked)} />Tambah wilayah lain setelah ini</label>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={!a.canSave} onClick={a.save}>Simpan wilayah</Btn>
    </>}>
      <Segmented label="Tingkat wilayah" value={a.level} onChange={a.changeLevel} options={REGION_LEVELS.map((l) => ({ value: l, label: REGION_LABEL[l] }))} />
      <ParentFields a={a} />
      {a.parentOk && <NameFields a={a} />}
      {!a.parentOk && a.parents.length > 0 && <p className="note">Pilih induk terlebih dahulu.</p>}
    </Modal>
  );
}

// ---- Dialog tempatkan anggota -------------------------------------------------------------------

const optionsOf = (q: Master) => (q.data?.items ?? []).map((i) => ({ value: i.code, label: i.name }));
const nameOf = (q: Master, code: string) => q.data?.items.find((i) => i.code === code)?.name;

function PlaceCascade({ pick, setPick, qs }: { pick: { prov: string; reg: string; dist: string; vill: string }; setPick: (p: { prov: string; reg: string; dist: string; vill: string }) => void; qs: { prov: Master; reg: Master; dist: Master; vill: Master } }) {
  const { prov, reg, dist, vill } = pick;
  const { prov: qProv, reg: qReg, dist: qDist, vill: qVill } = qs;
  const loading = (q: Master, text: string) => (q.isLoading ? 'Memuat…' : text);
  return (
    <>
      {qProv.isLoading && <p className="note">Memuat daftar wilayah…</p>}
      {!qProv.isLoading && <Combobox label="Provinsi" value={prov} onChange={(v) => setPick({ prov: v, reg: '', dist: '', vill: '' })} options={optionsOf(qProv)} placeholder="Pilih provinsi…" />}
      {prov && <Combobox label="Kabupaten / kota" value={reg} onChange={(v) => setPick({ ...pick, reg: v, dist: '', vill: '' })} options={optionsOf(qReg)} placeholder={loading(qReg, 'Pilih kabupaten / kota…')} />}
      {reg && <Combobox label="Kecamatan" value={dist} onChange={(v) => setPick({ ...pick, dist: v, vill: '' })} options={optionsOf(qDist)} placeholder={loading(qDist, 'Pilih kecamatan…')} />}
      {dist && <Combobox label="Kelurahan / desa" value={vill} onChange={(v) => setPick({ ...pick, vill: v })} options={optionsOf(qVill)} placeholder={loading(qVill, 'Pilih kelurahan / desa…')} />}
      {vill && <p className="note">Tujuan: {[nameOf(qVill, vill), nameOf(qDist, dist), nameOf(qReg, reg), nameOf(qProv, prov)].filter(Boolean).join(', ')}. Wilayah yang belum ada di Struktur daerah dibuatkan otomatis.</p>}
    </>
  );
}

function PlaceDialog({ m, rows, onClose }: { m: MemberRow; rows: RegionRow[]; onClose: () => void }) {
  const act = useAct();
  const [villageId, setVillageId] = useState(''); // cadangan: kelurahan yang sudah ada di Struktur daerah
  const [pick, setPick] = useState(() => {
    const src = rows.find((r) => r.id === m.villageId)?.sourceCode ?? '';
    const full = /^\d{10}$/.test(src);
    return { prov: full ? src.slice(0, 2) : '', reg: full ? src.slice(0, 4) : '', dist: full ? src.slice(0, 7) : '', vill: full ? src : '' };
  });
  const qs = {
    prov: useMaster('province', undefined, true),
    reg: useMaster('regency', pick.prov, !!pick.prov),
    dist: useMaster('district', pick.reg, !!pick.reg),
    vill: useMaster('village', pick.dist, !!pick.dist),
  };
  const apiDown = qs.prov.isError || (!!qs.prov.data && !qs.prov.data.available);
  const villages = rows.filter((r) => r.level === 'village').map((r) => ({ value: r.id, label: r.path.join(', ') }));
  const ready = apiDown ? !!villageId : !!pick.vill;
  return (
    <Modal title="Tempatkan anggota" open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn disabled={act.busy || !ready} onClick={() => act.post(`/members/${m.id}/placement`, `Penempatan disimpan: ${m.name}`, apiDown ? { villageId } : { villageSourceCode: pick.vill }, onClose)}>Simpan penempatan</Btn>
    </>}>
      <ReadOnlyField label="Anggota" value={m.name} />
      {m.regionPath && <ReadOnlyField label="Penempatan sekarang" value={m.regionPath} />}
      {apiDown ? (
        <>
          <p className="note" role="alert">Data referensi wilayah tidak tersedia. Pilih dari wilayah yang sudah ada di Struktur daerah.</p>
          <Combobox label="Kelurahan / desa tujuan" value={villageId} onChange={setVillageId} options={villages} placeholder="Pilih kelurahan / desa…" emptyText="Belum ada kelurahan/desa — tambahkan dulu di Hierarki wilayah" />
        </>
      ) : <PlaceCascade pick={pick} setPick={setPick} qs={qs} />}
      <p className="note">Mengubah penempatan tidak mengubah nomor anggota yang sudah terbit.</p>
    </Modal>
  );
}

function DeleteDialog({ r, onClose }: { r: RegionRow; onClose: () => void }) {
  const act = useAct();
  return (
    <Modal title="Hapus wilayah?" open onClose={onClose} footer={<>
      <Btn kind="g" onClick={onClose}>Batal</Btn>
      <Btn kind="d" disabled={act.busy} onClick={() => act.run('DELETE', `/regions/${r.id}`, 'Wilayah dihapus', undefined, onClose)}>Ya, hapus</Btn>
    </>}>
      <p className="note" style={{ fontSize: 14, color: 'var(--ink)' }}>{`${REGION_LABEL[r.level]} “${r.name}” (kode ${r.code}) akan dihapus. Nomor anggota yang sudah terbit tidak terpengaruh.`}</p>
    </Modal>
  );
}

// ---- Halaman ------------------------------------------------------------------------------------

function RegionKpis({ rows, ms }: { rows: RegionRow[]; ms: MemberRow[] }) {
  const count = (l: RegionLevel) => rows.filter((r) => r.level === l).length;
  const unplaced = ms.filter((m) => !m.placed).length;
  return (
    <Kpis>
      <Kpi l="Provinsi" v={count('province')} /><Kpi l="Kabupaten / kota" v={count('regency')} />
      <Kpi l="Kecamatan" v={count('district')} /><Kpi l="Kelurahan / desa" v={count('village')} />
      <Kpi l="Anggota belum ditempatkan" v={unplaced} tone={unplaced ? 'bad' : 'ok'} />
    </Kpis>
  );
}

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

function PlacementList({ ms, canEdit, onPlace }: { ms: MemberRow[]; canEdit: boolean; onPlace: (m: MemberRow) => void }) {
  if (ms.length === 0) return <div className="empty">Belum ada anggota.</div>;
  return (
    <ul className="plist">
      {ms.map((m) => (
        <li key={m.id} className="prow">
          <span className="avatar sm" aria-hidden="true">{initials(m.name)}</span>
          <div className="pmain"><b>{m.name}</b><span className={m.regionPath ? '' : 'muted'}>{m.regionPath ?? 'Belum ditempatkan'}</span></div>
          <Badge tone={m.placed ? 'ok' : 'warn'}>{m.placed ? 'Ditempatkan' : 'Belum'}</Badge>
          {canEdit && <Btn sm kind={m.placed ? 'g' : 's'} onClick={() => onPlace(m)}>{m.placed ? 'Pindahkan…' : 'Tempatkan…'}</Btn>}
        </li>
      ))}
    </ul>
  );
}

type RegionDlg = { kind: 'add'; level: RegionLevel; parent?: RegionRow } | { kind: 'place'; m: MemberRow } | { kind: 'delete'; r: RegionRow } | null;

export default function RegionPage() {
  const reg = useData<RegionRow[]>('/regions');
  const mem = useData<MemberRow[]>('/members');
  const { me } = useSession();
  const canEdit = me?.role === 'tenant_admin' || me?.role === 'staff';
  const rows = reg.data ?? [], ms = mem.data ?? [];
  const [dlg, setDlg] = useState<RegionDlg>(null);
  // Pohon: id wilayah yang sedang dilipat (default semua terbuka)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expand = (id?: string) => setCollapsed((c) => { if (!id) return new Set(); const n = new Set(c); n.delete(id); return n; });
  const openAdd = (level: RegionLevel = 'province', parent?: RegionRow) => { if (parent) expand(parent.id); setDlg({ kind: 'add', level, parent }); };
  const close = () => setDlg(null);

  return (
    <>
      <PageHead title="Struktur daerah" desc="Hierarki wilayah koperasi dan penempatan anggota. Kode lokal 2 digit (provinsi, kabupaten, kecamatan) membentuk nomor anggota; kelurahan/desa tidak ikut dalam nomor." />
      <div className="page">
        <Gate q={reg}>
          <RegionKpis rows={rows} ms={ms} />
          <Block title="Hierarki wilayah" note="Klik ▸ / ▾ untuk membuka atau melipat. Gunakan “+ Sub-wilayah” pada wilayah induknya. Wilayah yang masih punya isi atau anggota tidak dapat dihapus."
            tools={<><Btn sm kind="g" onClick={() => expand()}>Buka semua</Btn><Btn sm kind="g" onClick={() => setCollapsed(new Set(rows.filter((r) => r.children > 0).map((r) => r.id)))}>Tutup semua</Btn>{canEdit && <Btn onClick={() => openAdd()}>+ Tambah wilayah</Btn>}</>}>
            {rows.length === 0 ? <div className="empty">Belum ada wilayah. Mulailah dengan menambahkan provinsi.</div> : (
              <div className="tree" role="tree" aria-label="Hierarki wilayah">
                {rows.filter((r) => r.parentId === null).sort(byCodeName).map((r) => (
                  <TreeNode key={r.id} r={r} rows={rows} depth={0} collapsed={collapsed} toggle={toggle} canEdit={canEdit} onAdd={openAdd} onDelete={(x) => setDlg({ kind: 'delete', r: x })} />
                ))}
              </div>
            )}
          </Block>
          <Block title="Penempatan anggota" note="Mengubah penempatan tidak mengubah nomor anggota yang sudah terbit.">
            <PlacementList ms={ms} canEdit={canEdit} onPlace={(m) => setDlg({ kind: 'place', m })} />
          </Block>
        </Gate>
      </div>
      {dlg?.kind === 'add' && <AddRegionDialog rows={rows} preset={{ level: dlg.level, parent: dlg.parent }} expand={expand} onClose={close} />}
      {dlg?.kind === 'place' && <PlaceDialog key={dlg.m.id} m={dlg.m} rows={rows} onClose={close} />}
      {dlg?.kind === 'delete' && <DeleteDialog r={dlg.r} onClose={close} />}
    </>
  );
}
