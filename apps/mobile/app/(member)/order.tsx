import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../src/api';
import { C } from '../../src/theme';
import { useRates } from '../../src/rates';
import { useLocation, type Fix, type Perm } from '../../src/location';
import { Button, Card, Chips, Note, Row, Screen } from '../../src/ui';
import { rupiah, useData } from '../../src/hooks';

interface Depot { id: string; name: string; address: string | null; productsAvailable: number; distanceKm: number | null; nearest: boolean }
const km = (n: number) => `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`;
interface Item { id: string; sku: string; name: string; price: number; available: number }

const input = { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink } as const;

type Mode = 'beli' | 'jual';
type Result = { ok: boolean; text: string } | null;
const MODE_OPTIONS: { v: Mode; l: string }[] = [{ v: 'beli', l: 'Belanja untuk saya' }, { v: 'jual', l: 'Jual ke pelanggan' }];
const qtyOf = (list: Item[], qty: Record<string, number>) => list.filter((i) => (qty[i.id] ?? 0) > 0);

function ModeChips({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return <Chips value={mode} onChange={onChange} options={MODE_OPTIONS} />;
}

function LocationNotice({ perm, fix, depots, allow }: { perm: Perm; fix: Fix; depots: Depot[]; allow: () => void }) {
  if (perm === 'ask') {
    return (
      <View style={{ backgroundColor: C.warn[0], borderRadius: 8, padding: 12, gap: 8 }}>
        <Text style={{ color: C.warn[1] }}>Izinkan lokasi agar toko terdekat ditampilkan paling atas. Lokasi hanya dipakai untuk menghitung jarak dan tidak disimpan.</Text>
        <Button label="Izinkan lokasi" onPress={allow} />
      </View>
    );
  }
  if (perm === 'denied') return <Note>Izin lokasi ditolak, jadi jarak tidak ditampilkan. Aktifkan lagi di Pengaturan HP bila ingin melihat toko terdekat.</Note>;
  if (perm === 'unavailable') return <Note>Lokasi tidak tersedia saat ini (GPS mati?), jadi jarak tidak ditampilkan.</Note>;
  if (perm !== 'granted') return null;
  if (!fix) return <Note>Mencari lokasi Anda…</Note>;
  return depots.some((d) => d.distanceKm != null) ? null : <Note>Lokasi toko belum diisi pengurus, jadi jarak belum bisa dihitung.</Note>;
}

const depotSub = (d: Depot) => `${d.distanceKm != null ? `${km(d.distanceKm)} dari Anda · ` : ''}${d.address ?? 'Alamat belum diisi'} · ${d.productsAvailable} barang`;

function DepotList({ depots, onPick }: { depots: Depot[]; onPick: (d: Depot) => void }) {
  return (
    <Card>
      {depots.length === 0 ? <Row title="Belum ada toko aktif" /> : depots.map((d) => (
        <Pressable key={d.id} accessibilityRole="button" onPress={() => onPick(d)}>
          <Row title={d.name} sub={depotSub(d)} right={d.nearest ? 'Terdekat' : undefined} tone="ok" />
        </Pressable>
      ))}
    </Card>
  );
}

function DepotStep({ mode, onMode, onPick }: { mode: Mode; onMode: (m: Mode) => void; onPick: (d: Depot) => void }) {
  const { fix, perm, allow } = useLocation();
  const depots = useData<Depot[]>(`/me/toko${fix ? `?lat=${fix.lat}&lng=${fix.lng}` : ''}`);
  const prof = useData<any>('/me');
  const list = depots.data ?? [];
  return (
    <Screen queries={[depots, prof]}>
      <ModeChips mode={mode} onChange={onMode} />
      <Text style={{ fontSize: 18, fontWeight: '600', color: C.green }}>Pilih toko</Text>
      {mode === 'jual' && <Note>Mode jual: barang diambil dari stok toko yang Anda pilih untuk pelanggan Anda. Komisi dihitung setelah pelanggan menerima barang.</Note>}
      <Note>Stok dan persetujuan pesanan dikelola oleh masing-masing toko. Pilih toko tempat Anda mengambil barang.</Note>
      <LocationNotice perm={perm} fix={fix} depots={list} allow={allow} />
      <DepotList depots={list} onPick={onPick} />
    </Screen>
  );
}

const stepBtn = { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' } as const;

function Stepper({ item, n, onStep }: { item: Item; n: number; onStep: (d: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Pressable accessibilityLabel={`Kurangi ${item.name}`} disabled={n === 0} onPress={() => onStep(-1)} style={[stepBtn, { borderWidth: 1, borderColor: C.line, opacity: n === 0 ? 0.4 : 1 }]}><Text style={{ fontSize: 20, color: C.green }}>−</Text></Pressable>
      <Text style={{ minWidth: 28, textAlign: 'center', fontWeight: '600', color: C.ink }}>{n}</Text>
      <Pressable accessibilityLabel={`Tambah ${item.name}`} disabled={n >= item.available} onPress={() => onStep(1)} style={[stepBtn, { backgroundColor: C.green, opacity: n >= item.available ? 0.4 : 1 }]}><Text style={{ fontSize: 20, color: '#fff' }}>+</Text></Pressable>
    </View>
  );
}

function ProductRow({ item, n, onStep }: { item: Item; n: number; onStep: (d: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10, borderTopWidth: 0.5, borderTopColor: C.line }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.ink, fontWeight: '500' }}>{item.name}</Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>{rupiah(item.price)} · {item.available > 0 ? `stok ${item.available}` : 'stok habis'}</Text>
      </View>
      {item.available > 0 && <Stepper item={item} n={n} onStep={onStep} />}
    </View>
  );
}

function CustomerForm({ name, phone, onName, onPhone }: { name: string; phone: string; onName: (v: string) => void; onPhone: (v: string) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 16, fontWeight: '600', color: C.green }}>Pelanggan</Text>
      <TextInput value={name} onChangeText={onName} placeholder="Nama pelanggan" placeholderTextColor="#8aa59d" autoCapitalize="words" style={input} />
      <TextInput value={phone} onChangeText={onPhone} placeholder="Telepon (opsional)" placeholderTextColor="#8aa59d" keyboardType="phone-pad" style={input} />
      <Note>Penjualan hanya ke pelanggan umum (bukan anggota koperasi). Pelanggan membayar tunai langsung kepada Anda. Begitu toko menyetujui, saldo belanja Anda terpotong sebesar total pesanan, lalu barang dikirim ke pelanggan.</Note>
    </View>
  );
}

function TotalCard({ mode, packs, total, sellRate, balance }: { mode: Mode; packs: number; total: number; sellRate: number; balance: number }) {
  const sub = mode === 'jual' ? `${packs} · komisi Anda ${sellRate}% = ${rupiah(Math.round((total * sellRate) / 100))} setelah diterima pembeli` : `${packs} · saldo belanja Anda ${rupiah(balance)}`;
  return <Card><Row title="Total" sub={sub} right={rupiah(total)} tone={mode === 'beli' && total > balance ? 'warn' : 'ok'} /></Card>;
}

function BalanceNotice({ prof, total }: { prof: { active: boolean; balance: number } | undefined; total: number }) {
  if (!prof) return null;
  if (!prof.active) return <Note>Saldo belanja Anda belum aktif, jadi pesanan tidak bisa disetujui toko. Hubungi pengurus untuk aktivasi.</Note>;
  return total > prof.balance ? <Note>Total melebihi saldo belanja, jadi toko tidak bisa menyetujui pesanan ini. Kurangi jumlahnya.</Note> : null;
}

function ResultBox({ result }: { result: Result }) {
  if (!result) return null;
  return <View style={{ backgroundColor: result.ok ? C.ok[0] : C.bad[0], borderRadius: 8, padding: 12 }}><Text style={{ color: result.ok ? C.green : C.bad[1] }}>{result.text}</Text></View>;
}

const MODE_NOTE: Record<Mode, string> = {
  beli: 'Pesanan baru menunggu persetujuan petugas toko. Begitu disetujui, saldo belanja Anda otomatis terpotong; tidak perlu membayar lagi.',
  jual: 'Penjualan baru menunggu persetujuan petugas toko. Komisi Anda dihitung setelah pelanggan membayar dan menerima barang. Belanja untuk diri sendiri tidak berkomisi.',
};

function successText(mode: Mode, depot: Depot, cust: string) {
  return mode === 'beli'
    ? `Pesanan terkirim. Menunggu persetujuan ${depot.name}; statusnya ada di tab Pesanan.`
    : `Penjualan dicatat untuk ${cust}. Menunggu persetujuan ${depot.name}. Komisi Anda dihitung otomatis setelah pesanan lunas dan diterima pembeli; pantau di tab Laporan.`;
}

/** Keranjang, data pelanggan, dan pengiriman pesanan untuk satu toko. */
function useShop(depot: Depot, mode: Mode) {
  const qc = useQueryClient();
  const items = useData<Item[]>(`/me/depots/${depot.id}/products`);
  const prof = useData<any>('/me');
  const sellRate = useRates()[0] ?? 0;
  const [qty, setQty] = useState<Record<string, number>>({});
  const [custName, setCustNameRaw] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const list = items.data ?? [];
  const chosen = qtyOf(list, qty);
  const total = chosen.reduce((sum, i) => sum + i.price * qty[i.id]!, 0);
  const packs = chosen.reduce((a, i) => a + qty[i.id]!, 0);
  const payload = () => Object.entries(qty).filter(([, n]) => n > 0).map(([productId, n]) => ({ productId, qty: n }));
  const place = useMutation({
    mutationFn: () => (mode === 'beli'
      ? api('POST', '/me/orders', { depotId: depot.id, items: payload() })
      : api('POST', '/me/sales', { depotId: depot.id, items: payload(), customerName: custName.trim(), customerPhone: custPhone.trim() || undefined })),
    onSuccess: () => {
      setResult({ ok: true, text: successText(mode, depot, custName.trim()) });
      setQty({}); setConfirming(false);
      if (mode === 'jual') { setCustNameRaw(''); setCustPhone(''); }
      void qc.invalidateQueries();
    },
    onError: (e) => { setConfirming(false); setResult({ ok: false, text: e instanceof ApiError ? e.message : 'Pesanan belum bisa dibuat. Coba lagi.' }); },
  });
  const step = (i: Item, d: number) => { setResult(null); setConfirming(false); setQty((q) => ({ ...q, [i.id]: Math.max(0, Math.min(i.available, (q[i.id] ?? 0) + d)) })); };
  const reset = () => { setResult(null); setConfirming(false); };
  return {
    items, prof, sellRate, qty, list, chosen, total, packs, custName, custPhone, confirming, result, step, reset,
    setCustName: (v: string) => { setCustNameRaw(v); setConfirming(false); },
    setCustPhone, setConfirming, setResult, placing: place.isPending, place: () => place.mutate(),
    canOrder: chosen.length > 0 && (mode === 'beli' || custName.trim().length >= 2),
  };
}
type Shop = ReturnType<typeof useShop>;

function ConfirmBox({ k, mode, depot }: { k: Shop; mode: Mode; depot: Depot }) {
  const q = mode === 'beli' ? `Kirim pesanan ${k.chosen.length} jenis barang senilai ${rupiah(k.total)} ke ${depot.name}?` : `Catat penjualan ${rupiah(k.total)} untuk ${k.custName.trim()} dari ${depot.name}?`;
  const go = mode === 'beli' ? 'Ya, kirim pesanan' : 'Ya, catat penjualan';
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: C.ink }}>{q}</Text>
      <Button label={k.placing ? 'Mengirim…' : go} disabled={k.placing} onPress={k.place} />
      <Button label="Batal" kind="ghost" onPress={() => k.setConfirming(false)} />
    </View>
  );
}

function SubmitArea({ k, mode, depot }: { k: Shop; mode: Mode; depot: Depot }) {
  if (k.confirming) return <ConfirmBox k={k} mode={mode} depot={depot} />;
  return <Button label={mode === 'beli' ? 'Pesan sekarang' : 'Catat penjualan'} disabled={!k.canOrder} onPress={() => { k.setResult(null); k.setConfirming(true); }} />;
}

function DepotHeader({ depot, onChange }: { depot: Depot; onChange: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', color: C.green }}>{depot.name}</Text>
        {depot.address ? <Text style={{ color: C.muted, fontSize: 12 }}>{depot.address}</Text> : null}
      </View>
      <Pressable accessibilityRole="button" onPress={onChange} hitSlop={8}><Text style={{ color: C.green, fontWeight: '600' }}>Ganti toko</Text></Pressable>
    </View>
  );
}

function ShopStep({ depot, mode, onMode, onLeave }: { depot: Depot; mode: Mode; onMode: (m: Mode) => void; onLeave: () => void }) {
  const k = useShop(depot, mode);
  return (
    <Screen queries={[k.items]}>
      <ModeChips mode={mode} onChange={(m) => { onMode(m); k.reset(); }} />
      <DepotHeader depot={depot} onChange={onLeave} />
      <Card>
        {k.list.length === 0 ? <Row title="Belum ada barang" /> : k.list.map((i) => <ProductRow key={i.id} item={i} n={k.qty[i.id] ?? 0} onStep={(d) => k.step(i, d)} />)}
      </Card>
      {mode === 'jual' && <CustomerForm name={k.custName} phone={k.custPhone} onName={k.setCustName} onPhone={k.setCustPhone} />}
      <TotalCard mode={mode} packs={k.packs} total={k.total} sellRate={k.sellRate} balance={k.prof.data?.balance ?? 0} />
      <BalanceNotice prof={k.prof.data} total={k.total} />
      <ResultBox result={k.result} />
      <SubmitArea k={k} mode={mode} depot={depot} />
      <Note>{MODE_NOTE[mode]}</Note>
    </Screen>
  );
}

/**
 * Dua mode: "Belanja untuk saya" (pesanan sendiri, tanpa komisi) dan "Jual ke pelanggan" (anggota mencatat penjualan ke pelanggan umum;
 * anggota tidak menjual ke anggota lain; komisi dihitung setelah pesanan lunas dan diterima pelanggan). Keduanya: pilih toko, atur jumlah (maks. stok toko), kirim; toko menyetujui.
 */
export default function Order() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'jual' ? 'jual' : 'beli');
  useEffect(() => { if (params.mode === 'jual' || params.mode === 'beli') setMode(params.mode); }, [params.mode]);
  const [depot, setDepot] = useState<Depot | null>(null);
  if (!depot) return <DepotStep mode={mode} onMode={setMode} onPick={setDepot} />;
  return <ShopStep depot={depot} mode={mode} onMode={setMode} onLeave={() => setDepot(null)} />;
}
