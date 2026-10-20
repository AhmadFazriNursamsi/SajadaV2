# Sajadah — Koperasi

Monorepo TypeScript: **NestJS + Drizzle** (backend), **React + Vite** (web), **React Native + Expo** (mobile).
Backend dan web berjalan di **satu port**; aplikasi mobile memanggil API di port yang sama.

```
apps/api      NestJS 11 (Fastify) + Drizzle ORM — API di /api, menyajikan build web di /
apps/web      React 19 + Vite — dashboard pengurus/petugas (12 halaman) + halaman anggota (Hak saya, Laporan, Jaringan)
apps/mobile   Expo SDK 57 + expo-router — tab anggota (hanya lihat) dan tab petugas
packages/shared  Logika domain murni + skema zod, dipakai ketiganya (bagi hasil, stok, komisi, nomor anggota)
```

## Menjalankan

```bash
pnpm install
pnpm build          # shared → web → api
pnpm start          # http://localhost:3000  (web di /, API di /api, health di /api/health)
```

Tanpa konfigurasi apa pun, API memakai **PGlite** (PostgreSQL embedded, data di `.data/pglite`) dan mengisi data demo
satu koperasi (*Koperasi Sajadah*) saat pertama kali jalan. Untuk PostgreSQL sungguhan cukup isi `DATABASE_URL` di `apps/api/.env` (dibaca otomatis saat start; contoh di `.env.example`, mis. container `postgres:17` lewat Docker);
migrasi dijalankan otomatis saat boot.

Login demo (kata sandi `sajadah123`): `admin.nasional` (pengurus), `petugas.nasional` (toko 1), `petugas2.nasional` (toko 2),
`anggota.nasional`. Hanya ada satu koperasi; struktur data tetap per-tenant di basis data, tetapi tidak ada pilihan koperasi di layar.

### Pengembangan
```bash
pnpm dev            # API :3000 (watch) + Vite :5173 dengan proxy /api → :3000
pnpm dev:mobile     # Expo; otomatis memakai host dev + port 3000, atau set EXPO_PUBLIC_API_URL
pnpm test           # unit (shared) + e2e API (PGlite in-memory)
pnpm typecheck
pnpm db:generate    # buat migrasi SQL baru setelah mengubah apps/api/src/db/schema.ts
```

> Mobile adalah klien, jadi tidak punya "port" produksi. Satu-satunya port tambahan hanya Metro/Expo (8081) saat
> pengembangan. Perangkat fisik harus bisa menjangkau IP mesin dev di port 3000.

## Master data

- **Wilayah** (menu *Struktur daerah*): pohon provinsi → kabupaten/kota → kecamatan → kelurahan/desa per tenant, ditambahkan lewat popup.
  Nama dipilih dari **data referensi di database** (`master_regions`, offline; tanpa pemanggilan jaringan) atau diisi manual bila tidak ada.
  Data berasal dari dump `indonesia.sql` (BPS) yang diubah dengan `apps/api/scripts/build-wilayah.py` menjadi `apps/api/data/wilayah.json.gz`
  dan dimuat otomatis saat server pertama jalan (~2 detik; 34 provinsi, 514 kab/kota, 7.215 kecamatan, 80.532 desa).
  **Kode lokal** (membentuk nomor anggota `PPKKCCYYNNNNNN`): provinsi = kode 2 digit; kab/kota = 2 digit terakhir kode 4 digit;
  kecamatan = 2 digit pertama dari 3 digit akhir kode BPS (bila sudah dipakai kecamatan lain pada kabupaten yang sama — mis. pemekaran —
  diambil nomor bebas berikutnya); kelurahan/desa = 3 digit akhir (tidak ikut nomor). Contoh: Jawa Tengah 33 · Kota Semarang 74 · Semarang Tengah 13.
  Anggota ditempatkan lewat pilihan bertingkat; wilayah yang belum ada di pohon dibuat otomatis, dan wilayah manual bernama sama ditautkan.
  Nomor yang sudah terbit tidak berubah saat penempatan diganti.
  **Batasan data sumber:** snapshot 34 provinsi — belum memuat 4 provinsi Papua baru, penomoran Papua versi lama; 2 desa ber-ID ganda
  dilewati (satu per ID); nama diubah ke huruf kapital judul. Bukan master resmi pemerintah — validasi sebelum produksi.
  Perbarui data: `python3 -I apps/api/scripts/build-wilayah.py /path/indonesia.sql`, lalu kosongkan tabel `master_regions` (dimuat ulang saat boot).
- **Investor** (menu *Dashboard investor*): master investor per tenant dan alokasi penyertaan per anggota
  (total harus Rp12.500.000, dengan referensi dan tanggal). Aktivasi saldo menyimpan tanggal, referensi, dan snapshot anggaran awal.

## Stok opname & kartu stok (modul Persediaan)

- **Kartu stok**: setiap perubahan stok fisik (penerimaan, penerimaan PO, pengiriman, transfer masuk, opname) dicatat sebagai mutasi (jumlah +/-, saldo sesudahnya, referensi dokumen, pelaku). Lihat lewat tombol *Kartu stok…* pada baris produk. Cek konsistensi memastikan jumlah mutasi selalu sama dengan stok fisik.
- **Stok opname** memakai dokumen per toko (`OPN-0001`, …) dengan alur umum: **draf (menghitung) → diajukan → disetujui & diposting** (atau dikembalikan untuk hitung ulang / dibatalkan).
  - Saat dibuka, sistem membekukan *stok sistem* dan *harga beli* tiap produk (snapshot). Petugas toko mengisi **hitung fisik**; selisih = hitung − sistem, dinilai dengan harga beli.
  - **Setiap selisih wajib beralasan** (rusak/cacat, kedaluwarsa, hilang/susut, salah pencatatan, lainnya + catatan). Hasil hitung tidak boleh di bawah jumlah yang sudah dipesan.
  - **Persetujuan pengurus**: petugas menghitung dan mengajukan, pengurus menyetujui atau mengembalikan untuk dihitung ulang. Baru saat disetujui, selisih diposting sebagai penyesuaian ke kartu stok.
  - Penyesuaian = hitung − snapshot, diterapkan ke stok *saat ini*, sehingga penerimaan/pengiriman yang terjadi selama penghitungan tidak hilang; penyesuaian yang membuat stok di bawah jumlah dipesan ditolak.
  - **Toleransi selisih** (pengurus mengatur di *Pengaturan*; bawaan 5% per produk dan Rp500.000 nilai per dokumen): selisih yang melebihi salah satu batas ditandai *Di atas toleransi* (hanya peringatan; persetujuan tetap oleh pengurus).
    Tanda ini hanya peringatan agar diperiksa teliti; tidak ada pemisahan tugas (pengurus boleh menyetujui dokumen yang ia ajukan sendiri). Status dibekukan saat diajukan; perubahan toleransi tercatat di log.
  - **Opname di mobile** (petugas/pengurus, tab *Stok* → *Stok opname*): mulai/lanjutkan hitung dengan kolom angka, pilih alasan selisih, ajukan, dan persetujuan/pengembalian — aturannya sama karena ditegakkan server.
  - Satu opname berjalan per toko; petugas hanya untuk tokonya. Berita acara dapat diunduh sebagai CSV. Cara lama (mengubah stok langsung tanpa dokumen) sudah dihapus.

## Toko

Satu koperasi (tenant) punya beberapa **toko**; stok, pesanan, dan PO dipisah per toko (menu *Toko*, hanya pengurus yang menambah/menonaktifkan).
- **Stok per toko:** penerimaan, opname, dan transfer dicatat di toko yang dipilih. Ketersediaan = fisik toko − reservasi toko itu; toko lain tidak menutup kekurangan.
- **Petugas toko** (akun `staff` yang terhubung ke satu toko, dibuat pengurus di menu Toko dengan username dari nama + sandi acak) hanya melihat dan bekerja di tokonya (403 untuk toko lain).
  Pengurus melihat semua toko.
- **Toko anggota (mobile, bergaya Klik Indomaret):** Beranda (cari, dompet, promo, kategori, produk), daftar produk (cari + kategori + diskon), detail produk (foto, harga coret + persen diskon, deskripsi, *Cari Toko yang Menjual* = toko yang punya stok), **Keranjang**, **Checkout** (pilih toko yang bisa memenuhi seluruh keranjang, terdekat dulu bila lokasi diizinkan), dan **Transaksi**. Pesanan tetap lewat persetujuan toko dan saldo terpotong setelah disetujui. Jual ke pelanggan, komisi, jaringan, dan laporan **disembunyikan dari tampilan anggota** (layar dan API-nya tetap ada). Data tampilan produk (kategori, deskripsi, harga normal, foto) diisi pengurus di web, menu *Produk* → *Ubah…*; foto otomatis dikecilkan di browser dan disimpan di `.data/products` (`PRODUCT_IMAGE_DIR`). API: `GET /me/shop`, `POST /central/products/:id/image`, `GET /products/image/:file` (publik).
- **Saldo penarikan:** selain saldo belanja, anggota punya saldo penarikan. Setiap belanja sendiri yang **sudah diterima** (konfirmasi petugas atau pemeriksaan anggota) memberi 20% dari nilainya (`REWARD_PERCENT` di `packages/shared`), sekali per pesanan (`orders.reward`); pesanan yang dibatalkan/ditolak tidak memberi apa pun, dan pesanan lama sebelum fitur ini tidak dikreditkan mundur. Anggota membukanya dengan mengetuk *Saldo penarikan* di Beranda: **pindah ke saldo belanja** (langsung) atau **tarik ke rekening** (saldo ditahan; pengurus transfer di luar aplikasi lalu tandai dibayar di web *Penarikan saldo*, atau tolak dan saldo kembali). Semua perubahan tercatat di buku `reward_entries` dan log aktivitas. API: `GET /me/rewards`, `POST /me/rewards/transfer`, `POST /me/withdrawals`, `GET /withdrawals`, `POST /withdrawals/:id/pay|reject`.
- **Pemesanan anggota (mobile, tab *Pesan*):** anggota memilih toko, mengatur jumlah (maks. stok toko itu), lalu mengirim. Stok langsung direservasi,
  pesanan berstatus *Menunggu persetujuan toko*. Petugas toko **menyetujui** atau **menolak (dengan alasan; reservasi dilepas)**. Pembayaran dan pengiriman baru boleh setelah disetujui.
  Pesanan yang dibuat petugas dari web/mobile langsung dianggap disetujui. Pada pesanan anggota, penjual = pembeli = anggota itu (rantai sponsor dihitung dari dirinya).
- **Toko terdekat:** pengurus mengisi koordinat toko (menu Toko → Ubah…). Di tab *Pesan*, aplikasi meminta izin lokasi lalu mengurutkan toko
  dari yang terdekat (jarak lurus dalam km, lencana *Terdekat*). Posisi hanya dikirim untuk menghitung jarak dan **tidak disimpan**;
  tanpa izin lokasi atau tanpa koordinat toko, daftar tetap tampil tanpa jarak.
- **Fitur retur sudah dihapus** (tidak ada pengajuan atau proses retur; endpoint `return` dan `return-request` tidak ada). Masalah barang ditangani lewat *Cek barang yang dikirim* (laporan anggota + tanggapan toko) atau pembatalan sebelum kirim. Kolom retur lama di basis data dibiarkan untuk riwayat.
- **Detail pesanan:** web (menu *Pesanan*, tombol/klik baris *Detail*) dan mobile (anggota dan petugas, tombol *Detail pesanan*) menampilkan perjalanan pesanan (dipesan → disetujui → dibayar → dikirim → diterima, beserta waktu/penyetuju/surat jalan/penerima), isi pesanan per produk (jumlah, harga satuan, subtotal, total), pembeli dan penjual, serta status pemeriksaan anggota.
- **Satu checkout = satu pesanan:** beberapa produk dalam satu pesanan berbagi satu nomor (mis. `SO-0007`; barisnya `SO-0007-1…`) dan satu `groupId`. Semua tindakan (setujui, potong saldo, kirim, konfirmasi diterima, batal, persetujuan komisi) berlaku untuk pesanan utuh dan saldo dipotong/dikembalikan sebesar total. Hitungan pesanan di ringkasan dan laporan memakai pesanan, bukan baris produk.
- **Saldo terpotong otomatis saat disetujui:** petugas toko menyetujui pesanan anggota (belanja sendiri maupun penjualan ke pelanggan) → saldo belanja anggota penjual langsung terpotong dan pesanan berstatus lunas (tanpa konfirmasi bayar lagi). Saldo harus aktif dan cukup; bila tidak, persetujuan ditolak dengan alasan jelas (pesanan tetap menunggu dan bisa ditolak). Saldo dikembalikan penuh bila pesanan dibatalkan sebelum kirim. Pesanan lama yang sudah menunggu pembayaran masih bisa dibayar manual (anggota di aplikasi atau petugas).
- **Batasan:** belum ada transfer antar-toko; aturan safety stock/target masih per produk (berlaku sama di setiap toko).
  Bila `depotId` tidak dikirim, API memakai toko petugas, atau toko aktif tertua untuk pengurus.

## Anggota mencatat penjualan

Anggota tidak mengetik angka penjualan. Di mobile (tab *Pesan* → **Jual ke pelanggan**, juga tombol *+ Catat penjualan* di Beranda/Laporan) anggota memilih toko, barang, dan pembeli,
lalu sistem membuat **pesanan sungguhan** atas nama anggota sebagai penjual (`POST /me/sales`):
- Pembeli selalu **pelanggan umum** (nama + telepon opsional; pelanggan membayar tunai langsung kepada anggota penjual, sedangkan koperasi menerima pembayaran dari saldo belanja anggota itu saat pesanan disetujui). **Anggota tidak menjual ke anggota lain**: server menolak pesanan dengan penjual dan pembeli anggota yang berbeda (juga dari petugas).
  Anggota yang membeli untuk dirinya sendiri (mode *Belanja untuk saya*, bayar dari saldo) dicatat sebagai belanja sendiri: **tanpa komisi**.
- Stok toko langsung direservasi; pesanan menunggu persetujuan petugas toko; komisi baru terhitung setelah pesanan lunas dan **diterima pembeli** (bukti terima oleh petugas). Karena itu laporan harian tidak bisa dimanipulasi dengan input manual.
- Pesanan pelanggan umum disimpan dengan `buyer_id` kosong + `customer_name`; pelanggan tidak punya saldo; yang dipotong adalah saldo belanja anggota penjual (pelanggan membayar tunai langsung ke anggota, di luar sistem). Pembatalan sebelum kirim mengembalikan saldo ke anggota penjual.
- Catatan kontrol: penerimaan kas tetap dicatat bagian keuangan (bukan petugas toko).

## Referal & bonus jaringan

- Setiap anggota punya **kode referal** 8 karakter (mis. `73E0-4D41`), tampil di mobile (tab *Jaringan*, dengan tombol *Bagikan ajakan*) dan web (*Jaringan saya*).
- Calon anggota dibuat anggota lewat petugas: di *Tambah anggota* petugas mengisi **Kode referal (opsional)**; sistem menampilkan pratinjau nama pengajak dan otomatis menjadikannya **sponsor** (kode salah ditolak).
  Kode dibaca tanpa tanda hubung dan huruf besar/kecil. Pengurus tetap bisa mengubah sponsor di *Jaringan MLM* (berlaku untuk pesanan baru).
- **Bonus**: pengajak mendapat 3% dari setiap penjualan anggota yang diajaknya ke pelanggan umum (tingkat 1), 2% dari tingkat 2, dan 1% dari tingkat 3 — setelah pesanan lunas, diterima, dan disetujui/dibayar keuangan; pembatalan pesanan membatalkannya. Bonus per orang dan per tingkat
  tampil di *Jaringan* (menunggu persetujuan / siap dibayar / dibayar, serta total bulan ini) dan ikut sebagai *Komisi jaringan* di laporan harian.
- Belanja anggota untuk dirinya sendiri tidak menghasilkan bonus bagi siapa pun.
- Belum ada pendaftaran mandiri lewat tautan: calon anggota tetap didaftarkan petugas (kode referal hanya menentukan sponsor).

## Laporan penjualan harian anggota

Anggota melihat penjualannya per hari dan **saldo komisi yang dihitung otomatis** (mobile: tab *Laporan* + kartu di Beranda; web: menu *Laporan penjualan*; API `GET /me/sales-report?days=1..90`).
- Penjualan "berhasil" dihitung pada **hari pembeli menerima barang** (kalender WIB), untuk pesanan lunas; belanja sendiri, dan pesanan batal tidak dihitung.
- Komisi harian = bagian anggota pada pesanan itu: 5% penjualannya sendiri + 3/2/1% dari penjualan downline tingkat 1-3 (kolom *Komisi penjualan* dan *Komisi jaringan*).
- **Saldo komisi** = komisi yang sudah dihitung tetapi belum dibayar, dirinci: menunggu persetujuan keuangan, siap dibayar, sudah dibayar).
  *Dalam proses* = pesanan terjual yang belum lunas/diterima (belum menjadi komisi). Angka berubah otomatis mengikuti pesanan dan keputusan keuangan; tidak ada input manual.

## Skema komisi & simulasi pendapatan

Halaman *Skema komisi* (web, semua peran) dan layar *Skema komisi & simulasi* (mobile anggota, dari Beranda/Jaringan) menjelaskan terbuka kepada anggota:
tarif per tingkat (penjual 5%, sponsor 3/2/1%, hanya dari penjualan ke pelanggan umum) dengan contoh nilai, syarat komisi cair (disetujui toko, lunas, diterima + bukti, disetujui dan dibayar keuangan),
rincian penyertaan modal Rp12,5 juta (saldo belanja yang tidak bisa ditarik), dan peringatan *omzet bukan laba / tidak ada jaminan penghasilan*.
Angka diambil dari konstanta yang sama dengan perhitungan komisi sebenarnya (`packages/shared`), jadi tidak bisa berbeda.
**Simulasi** (`simulateIncome`): anggota mengisi produk, penjualan sendiri dan downline tingkat 1-3 per bulan, serta biaya pribadi; hasilnya komisi kotor,
pendapatan bersih (bisa negatif) dan titik impas. Hanya komisi yang disimulasikan; margin produk milik koperasi dan bagi hasil laba tidak dihitung.
**Aturan komisi tambahan:**
- **Komisi hanya untuk penjualan ke pelanggan umum.** Belanja anggota (untuk diri sendiri) tidak menghasilkan komisi bagi siapa pun dan tidak dihitung sebagai volume penjualan. Pesanan lama antaranggota (data sebelum aturan ini) tidak lagi berkomisi.
  Dana kembali penuh ke saldo belanja (pesanan kas: kas berkurang, hanya pengurus), stok kembali hanya bila petugas menandai barang layak jual, dan komisi pesanan itu menjadi `reversed`.

## Keamanan & kontrol admin

- **Pembatas login**: 5 percobaan gagal per pasangan IP+username dalam 15 menit → 429 (juga untuk sandi benar selama terkunci), plus batas per IP (30) dan per username dari banyak IP (25). Berlaku untuk login, lupa sandi, dan tebakan sandi lama saat ganti sandi.
  Hitungan ada di memori proses; untuk lebih dari satu instance pasang pembatas di reverse proxy atau pindahkan ke Redis. Atur dengan `LOGIN_MAX_FAILS`, `LOGIN_MAX_FAILS_IP`, `LOGIN_MAX_FAILS_KEY`, `LOGIN_WINDOW_MINUTES`.
- **IP klien**: `TRUST_PROXY=true` hanya bila API berada di belakang reverse proxy tepercaya (kalau tidak, header `X-Forwarded-For` bisa dipalsukan untuk menghindari pembatas).
- **CORS**: di produksi lintas-origin ditolak kecuali `CORS_ORIGIN` diisi (daftar dipisah koma); di pengembangan terbuka. **Header keamanan** (nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, CSP untuk web, HSTS di produksi) dipasang di semua respons.
- **Komisi**: pengurus menyetujui lalu mencatat pembayaran (satu orang boleh melakukan keduanya); penyetuju dan pembayar tercatat di baris komisi.
- **Tarif komisi** diatur pengurus di *Pengaturan* (4 tarif; tiap tingkat ≤ 15%, total ≤ 30%, alasan wajib, riwayat lengkap). Tarif dibekukan pada setiap pesanan saat dibuat, jadi perubahan hanya berlaku untuk pesanan baru. Halaman skema, simulasi, dan laporan anggota membaca tarif yang berlaku.
- **Anggota**: pengurus dapat mengubah nama/status keluarga, **menonaktifkan** (alasan wajib; ditolak bila ada pesanan belum selesai) dan mengaktifkan kembali. Anggota nonaktif langsung tidak bisa masuk (token lama pun ditolak), memesan, menjual, atau mengajak; riwayat tetap tersimpan, tidak ada penghapusan.
  Saldo belanja sisa tidak dikembalikan otomatis (diputuskan di luar sistem).
- **Log aktivitas** (pengurus): menu *Log aktivitas* dengan pencarian dan halaman bertahap; hanya baca.

## Peran

| Peran | Akses |
|---|---|
| `tenant_admin` (**Pengurus**, = admin) | Mengurus pusat: produk (buat/ubah harga/aktif), barang masuk gudang pusat, kirim ke toko (KRM), batalkan kiriman, proses permintaan toko (kirim penuh/sebagian/tolak). Menyetujui PO dan opname, keuangan/akuntansi, komisi (setujui dan bayar), laporan bagi hasil, tarif komisi, anggota, toko dan akun petugas, log aktivitas. **Hanya baca untuk stok toko**: tidak menambah stok toko, menerima kiriman/PO, atau menghitung opname. Tanpa pemisahan tugas antar-akun |
| `staff` (**Petugas**) | Pelaksana toko, terkunci ke tokonya: **barang masuk di toko**, terima kiriman dari pusat, hitung dan ajukan opname, minta stok ke pusat, pesanan (setujui, kirim, terima). Di web empat menu di sidebar: *Pesanan* (setujui, bayar dari saldo, kirim, konfirmasi diterima; lencana dan halaman diperbarui otomatis), *Stok toko*, *Minta stok ke pusat*, *Stok opname*; di mobile tab Tugas, Pesanan, Stok. **Tidak** membuka data anggota, ringkasan keuangan, komisi, investor, struktur daerah, keuangan, log, atau pengaturan (ditolak server) |
| `member` | Hanya `/api/me/*` (hak sendiri) |

**Stok pusat → toko:** pengurus mencatat *barang masuk* ke gudang pusat (Persediaan → *Stok pusat* → "+ Barang masuk ke pusat"), lalu membuat pengiriman `KRM-xxxx` ke satu toko. Stok pusat langsung berkurang dan toko melihat angka *kiriman menuju toko*; stok toko baru bertambah saat petugas toko **memeriksa dan menerima kiriman**: petugas mengisi jumlah yang benar-benar diterima per produk (bawaan = sesuai kiriman); bila kurang, alasan wajib (kurang, rusak, salah produk, lainnya + catatan); bila **lebih**, catatan wajib; stok toko bertambah sebesar yang benar-benar diterima (bisa lebih besar dari kiriman), dan selisih ditandai "Diterima, ada selisih" di tab *Pengiriman* serta tercatat di log (web: Persediaan → Kiriman dari pusat; mobile petugas: tab Stok). Kiriman belum diterima bisa dibatalkan pengurus (stok kembali ke pusat).

**Permintaan stok:** petugas meminta stok ke pusat (web: Persediaan → *Minta stok ke pusat*; mobile: tab Stok → *Minta stok ke pusat*; produk habis/menipis disarankan sampai target). Nomor `REQ-xxxx`. Pengurus memprosesnya di *Persediaan* → *Permintaan toko*: **kirim penuh, kirim sebagian** (jumlah ≤ diminta dan ≤ stok pusat; 0 = tidak dikirim) yang otomatis membuat kiriman `KRM`, atau **tolak** dengan alasan. Petugas bisa membatalkan permintaan yang belum diproses. Lencana *Persediaan* dan baris *Perlu tindakan* menunjukkan permintaan yang menunggu. Semua mutasi tercatat di kartu stok (pusat dan toko) dan cek konsistensi memeriksa kecocokannya.

**Beranda anggota (mobile):** saldo belanja (dengan peringatan bila belum aktif), aksi cepat *Jual ke pelanggan* dan *Belanja untuk saya*, *Pesanan berjalan* (menunggu persetujuan, lunas/disiapkan, dikirim), *Penghasilan* (komisi hari ini, saldo komisi, komisi dalam proses, bonus jaringan bulan ini), *Pesanan terbaru*, dan kode referal.

**Cek barang yang dikirim (mobile anggota):** setelah pesanan dikirim, tab *Pesanan* menampilkan **Cek barang yang dikirim**. Anggota mengisi jumlah yang benar-benar diterima baik per produk (bawaan = sesuai pesanan); bila kurang, alasan wajib (kurang/rusak/salah produk/lainnya + catatan). Pemeriksaan hanya bisa dilakukan **sekali** per pesanan dan **sekaligus mengonfirmasi barang diterima** (status Diterima, bukti `CEK-<nomor pesanan>`), jadi petugas tidak perlu menekan *Konfirmasi diterima* lagi (tombol itu hanya untuk pesanan yang belum diperiksa anggota; bukti petugas tidak ditimpa). Semua sesuai → tercatat "sesuai". Ada selisih → **laporan ke toko** (`POST /me/orders/:id/check`): muncul di menu *Pesanan* petugas (web dan mobile; lencana, kartu *Laporan anggota*), petugas melihat rincian dan **menanggapi** (`POST /orders/:id/report/resolve`), dan tanggapannya terlihat anggota. Tercatat di log aktivitas.

**Profil anggota (mobile, tab *Profil*):** menggantikan menu *Hak saya* (dihapus dari mobile; web tetap). Isinya data diri, **Edit profil** (nama, nomor HP, alamat; `PATCH /me`, tercatat di log, nama di akun ikut berubah), **Ganti kata sandi**, dan **Keluar** (dengan konfirmasi). Nomor anggota, daerah, sponsor, dan saldo tidak bisa diubah anggota.

**Akun anggota:** pengurus membuat akun saat menambah anggota (opsi *Buat akun login*) atau lewat tombol *Buat akun* di Daftar anggota.
Username diambil dari nama (`Budi Santoso` → `budi.santoso`; kembar → `budi.santoso2`), kata sandi dibuat acak 10 karakter dan
**hanya ditampilkan sekali** (yang disimpan hanya hash). Anggota wajib mengganti kata sandi saat login pertama (web dan mobile);
pengurus dapat mengatur ulang lewat *Reset sandi*. Belum ada alur "lupa sandi" mandiri.

Seluruh data dibatasi per tenant dari token JWT; tenant lain tidak pernah terlihat.
**Mobile di browser**: aplikasi mobile yang sama bisa dibuka di `/m/` tanpa memasang apa pun (`pnpm --filter @sajadah/mobile build:web`, dilayani API dari `apps/mobile/dist-web`; `pnpm build` ikut membuatnya). Sesinya memakai cookie sendiri (`sajadah_m`) sehingga tidak menimpa sesi web admin.
Sesi **web** memakai cookie `HttpOnly; SameSite=Strict` (tidak disimpan di localStorage, jadi tidak terbaca JavaScript; tindakan lintas situs ditolak). **Mobile** memakai token JWT di header `Bearer` yang disimpan di SecureStore.

## Aturan bisnis yang ditegakkan server

Mengikuti *Proses Bisnis v1.1* (lihat dokumen sumber). Semua mutasi berjalan dalam transaksi DB dengan row lock.

- Stok tersedia = fisik − reservasi; checkout melebihi stok ditolak (tes menjalankan dua checkout paralel).
- Pesanan harus lunas sebelum dikirim; batal hanya sebelum kirim; refund saldo penuh ke saldo belanja.
- Komisi 5/3/2/1 hanya untuk pesanan lunas + bukti terima, bukan pesanan sendiri; alur `pending → approved → paid` berurutan, hanya keuangan.
- Aktivasi saldo Rp10 juta butuh alokasi investor tercatat (total Rp12,5 juta); tanggal tidak di masa depan atau sebelum tanggal pendanaan.
- Laporan bagi hasil: periode tidak boleh sebelum bulan aktivasi; draf harus diselesaikan oleh pengguna lain dari pembuatnya.
- Bagi hasil: fase pemulihan 20/80 lalu tarif marginal 25/30/50/60%; draf tidak mengubah posisi, hanya *settled*.
- Sponsor tidak boleh membentuk siklus; snapshot upline dibekukan saat checkout.
- PO: hanya kuantitas layak menambah stok; invoice dari kuantitas layak setelah PO selesai; referensi pembayaran AP unik.

## Batasan (sama dengan dokumen sumber)

Tidak ada integrasi pembayaran atau perbankan: "paid" dan "settled" adalah **pencatatan internal**. Belum ada
ClickHouse. Komisi 5/3/2/1 adalah kebijakan demo. Master wilayah hanya contoh.
