#!/usr/bin/env python3
"""
Mengubah dump SQL wilayah (tabel provinces/regencies/districts/villages; skema Laravel/BPS, kode 2/4/7/10 digit)
menjadi apps/api/data/wilayah.json.gz yang dimuat ke tabel `master_regions` saat server pertama kali jalan.

Pakai: python3 -I scripts/build-wilayah.py /path/ke/indonesia.sql
Berkas SQL hanya DIBACA sebagai data (tidak dieksekusi). Catatan data sumber (Oktober 2026): 34 provinsi — belum memuat 4 provinsi Papua baru;
penomoran Papua versi lama; 2 desa ber-ID ganda (yang pertama disimpan, sisanya dicatat di output).
"""
import collections, gzip, json, os, re, sys

KEEP_UPPER = {'DKI', 'DI', 'II', 'III', 'IV', 'RT', 'RW'}
SMALL = {'dan', 'di', 'ke', 'dari', 'atas', 'pada'}

def title(name):
    words = re.split(r'(\s+|-|/|\(|\))', name.strip().lower())
    out, first = [], True
    for w in words:
        if not w or re.fullmatch(r'\s+|-|/|\(|\)', w): out.append(w); continue
        up = w.upper()
        out.append(up if up in KEEP_UPPER else (w if (w in SMALL and not first) else w[:1].upper() + w[1:]))
        first = False
    return ''.join(out)

def table(txt, name, n):
    m = re.search(r"INSERT INTO `%s` VALUES\s*(.*?);\s*\n(?:/\*!|UNLOCK)" % name, txt, re.S)
    if not m: raise SystemExit(f'Tabel {name} tidak ditemukan')
    q = r"'((?:[^'\\]|\\.|'')*)'"
    rows = re.findall(r"\(\s*" + r"\s*,\s*".join([q] * n) + r"\s*\)", m.group(1))
    return [tuple(c.replace("''", "'").replace("\\'", "'") for c in r) for r in rows]

def dedupe(rows, label):
    seen, out, skipped = set(), [], []
    for r in rows:
        if r[0] in seen: skipped.append(r); continue
        seen.add(r[0]); out.append(r)
    if skipped: print(f'  {label}: {len(skipped)} ID ganda dilewati ->', [(r[0], r[-1]) for r in skipped])
    return out

def main(path):
    txt = open(path, encoding='utf8').read()
    P = dedupe(table(txt, 'provinces', 2), 'provinsi')
    R = dedupe(table(txt, 'regencies', 3), 'kab/kota')
    D = dedupe(table(txt, 'districts', 3), 'kecamatan')
    V = dedupe(table(txt, 'villages', 3), 'desa')
    data = {
        'source': 'indonesia.sql (BPS; dump Laravel) — bukan master resmi pemerintah',
        'provinces': sorted([a, title(b)] for a, b in P),
        'regencies': sorted([a, b, title(c)] for a, b, c in R),
        'districts': sorted([a, b, title(c)] for a, b, c in D),
        'villages': sorted([a, b, title(c)] for a, b, c in V),
    }
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'wilayah.json.gz')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with gzip.open(out, 'wt', encoding='utf8', compresslevel=9) as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print({k: len(v) for k, v in data.items() if isinstance(v, list)}, os.path.getsize(out), 'bytes ->', out)

if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit(__doc__)
    main(sys.argv[1])
