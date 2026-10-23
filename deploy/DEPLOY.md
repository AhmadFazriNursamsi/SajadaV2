# Deploy Sajadah ke https://sajadah.devoutsys.com

Satu container melayani semuanya di satu port: web admin (`/`), aplikasi mobile versi web (`/m`), dan API (`/api`).
Database PostgreSQL memakai yang sudah ada di server. Migrasi database berjalan otomatis saat container start.

## 1. Sekali saja: kirim kode ke GitHub dan biarkan Actions membangun image

```bash
cd sajadah
git add -A && git commit -m "Rilis pertama"      # repositori ini belum punya commit
git branch -M main
git remote add origin git@github.com:OWNER/REPO.git
git push -u origin main
```

Workflow `.github/workflows/docker.yml` akan menjalankan tes, lalu membangun dan mengirim image ke
`ghcr.io/OWNER/REPO` dengan tag `latest`, `sha-xxxxxxx`, dan `1.2.3` (bila Anda membuat tag `v1.2.3`).
Pantau di tab **Actions**. Image dibangun untuk `linux/amd64`; bila server Anda ARM, tambahkan `linux/arm64` di `platforms`.

## 2. Siapkan folder di server

```bash
mkdir -p /opt/sajadah/data && cd /opt/sajadah
chown -R 1000:1000 data                 # container berjalan sebagai user "node" (uid 1000)
# salin deploy/docker-compose.yml dan deploy/.env.production.example ke sini
cp .env.production.example .env && nano .env
```

Isi `.env` (yang wajib saja):

| Variabel | Isi |
|---|---|
| `JWT_SECRET` | rahasia acak panjang: `openssl rand -base64 48` |
| `DATABASE_URL` | `postgres://USER:SANDI@HOST:5432/NAMADB` (tambah `?sslmode=require` bila diwajibkan) |

Sisanya sudah benar secara bawaan (`NODE_ENV=production`, `TRUST_PROXY=true`, **`SEED=false`**, folder unggahan `/data/...`).
Jangan pernah mengisi `SEED=true` di produksi: pada database kosong itu membuat data demo dengan akun berkata sandi umum.

Bila database `NAMADB` belum ada, aplikasi **membuatnya otomatis** saat start (user perlu hak `CREATEDB`; matikan dengan `DB_AUTO_CREATE=false`).
Karakter khusus di sandi harus di-URL-encode (`@` → `%40`, `#` → `%23`, `/` → `%2F`).

Sarankan database dan user khusus:

```sql
CREATE USER sajadah WITH PASSWORD '...';
CREATE DATABASE sajadah OWNER sajadah;
```

Di `docker-compose.yml` ganti `ghcr.io/OWNER/REPO:latest` dengan nama image Anda (huruf kecil semua).

## 3. Tarik dan jalankan

Bila package GHCR **private**, login dulu dengan Personal Access Token (scope `read:packages`):

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u USERNAME_GITHUB --password-stdin
```

```bash
docker compose pull
docker compose up -d
docker compose logs -f sajadah          # tunggu "Nest application successfully started"
curl -s http://127.0.0.1:3000/api/health
```

## 4. Buat pengurus pertama (sekali)

Database produksi kosong dan tanpa data demo. Buat koperasi dan akun pengurus pertama:

```bash
docker compose exec sajadah node dist/bootstrap-admin.js
```

Skrip membaca `BOOTSTRAP_*` dari `.env` (nama koperasi, username, dst.). Bila `BOOTSTRAP_ADMIN_PASSWORD` kosong,
sandi acak dicetak **sekali** di layar: simpan. Anda akan diminta menggantinya saat login pertama. Aman dijalankan ulang (tidak menimpa).

Setelah login, lengkapi di web admin: **Pengaturan → Profil badan usaha** (nama, alamat, NPWP, penandatangan; dipakai di invoice),
Struktur daerah, Toko, Produk (harga, koin), Voucher koin, lalu buat akun petugas dan anggota.

## 5. Reverse proxy + HTTPS

Container hanya mendengarkan `127.0.0.1:3000`. Pasang TLS di depannya.

**Nginx** (sertifikat dari certbot / Let's Encrypt):

```nginx
server {
    listen 443 ssl http2;
    server_name sajadah.devoutsys.com;
    ssl_certificate     /etc/letsencrypt/live/sajadah.devoutsys.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sajadah.devoutsys.com/privkey.pem;

    client_max_body_size 5m;                 # unggah foto (dikirim sebagai JSON)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # wajib: cookie Secure + pembatas login memakai ini
    }
}
server { listen 80; server_name sajadah.devoutsys.com; return 301 https://$host$request_uri; }
```

**Caddy** (TLS otomatis): 

```
sajadah.devoutsys.com {
    request_body { max_size 5MB }
    reverse_proxy 127.0.0.1:3000
}
```

## 6. Aplikasi HP (APK)

`apps/mobile/eas.json` sudah menunjuk `https://sajadah.devoutsys.com` dan lalu lintas tanpa enkripsi dimatikan.
Bangun ulang APK (build lama tidak berisi fitur foto profil, dsb.):

```bash
cd apps/mobile
npx eas-cli build --platform android --profile apk
```

Naikkan `version`/`android.versionCode` di `app.json` tiap rilis baru.

### APK otomatis (tanpa langkah manual di server)

GitHub Actions membangun APK lewat EAS dan menyisipkannya ke image server, jadi `docker compose pull && docker compose up -d`
sekaligus memperbarui APK yang diunduh dari web admin (menu **Aplikasi HP**, QR/tautan `/api/app/sajadah.apk`).

Pengaturan sekali saja:

1. expo.dev → **Account settings → Access tokens → Create token**. Salin tokennya.
2. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**: nama `EXPO_TOKEN`, isi token tadi.
3. Jalankan pertama kali manual: tab **Actions → Build & push image → Run workflow**. Build EAS memakan ±10–20 menit.

Cara kerjanya:
- APK dibangun ulang hanya bila `apps/mobile` atau `packages/shared` berubah, saat tag `v*`, saat dijalankan manual, atau bila belum ada APK.
- `versionCode` dinaikkan otomatis di CI (100 + nomor run), jadi APK baru selalu bisa menimpa yang terpasang. Tanda tangan tetap sama karena memakai kredensial yang disimpan EAS.
- Hasilnya disimpan sebagai rilis GitHub `apk-latest` lalu disalin ke image di `/opt/apk/sajadah.apk`.
- Tanpa `EXPO_TOKEN`, langkah APK dilewati dengan peringatan dan image server tetap dibangun.
- Cadangan manual: letakkan berkas di server dan set `APK_PATH=/data/apk/sajadah.apk` di `.env` (menimpa APK di dalam image).

### Update otomatis (Watchtower)

`docker-compose.yml` menyertakan container `sajadah-watchtower`. Ia mengecek GHCR tiap 5 menit dan, bila ada image `latest` baru,
menarik lalu memulai ulang **hanya** container `sajadah` (berlabel `com.centurylinklabs.watchtower.enable=true`); container lain di server tidak disentuh.
Jadi alurnya: `git push` → Actions membangun image (dan APK bila perlu) → server memperbarui diri dalam ±5 menit setelah image terkirim.

- Aktifkan sekali: `docker compose up -d` (menjalankan Watchtower). Cek: `docker compose logs -f watchtower`.
- Package GHCR private: login di server (`docker login ghcr.io`), lalu aktifkan baris volume `config.json` di compose.
- Bila update tidak ingin otomatis, hentikan: `docker compose stop watchtower` (lalu pakai `docker compose pull && docker compose up -d` manual).
- Migrasi database tidak punya langkah mundur dan ikut berjalan otomatis: pastikan cadangan harian berjalan.

## 7. Update, rollback, cadangan

- **Update:** `docker compose pull && docker compose up -d`. Migrasi baru berjalan otomatis dan **tidak punya langkah mundur**: cadangkan database dulu.
- **Rollback kode:** ganti tag di compose ke versi lama (`:sha-xxxxxxx`) lalu `up -d`. Bila migrasi sudah terlanjur berjalan, pulihkan dari cadangan.
- **Cadangan database (harian):**
  ```bash
  pg_dump -Fc "$DATABASE_URL" -f /backup/sajadah-$(date +%F).dump
  # pulihkan: pg_restore -d NAMADB --clean --if-exists berkas.dump
  ```
- **Cadangan foto:** salin folder `/opt/sajadah/data` (foto produk, voucher, profil). Tanpa ini foto hilang bila disk rusak.
- **Uji pemulihan** minimal sekali sebelum go-live.

## Daftar periksa go-live

- [ ] `JWT_SECRET` acak panjang, `SEED=false`, `DATABASE_URL` benar
- [ ] HTTPS aktif dan header `X-Forwarded-Proto` diteruskan proxy
- [ ] Pengurus pertama dibuat dan sandi sudah diganti
- [ ] Profil badan usaha (NPWP, penandatangan) terisi
- [ ] Cadangan database dan folder `data` terjadwal, pemulihan pernah diuji
- [ ] APK baru dibangun dan dicoba di HP sungguhan (GPS, foto, invoice PDF)
- [ ] Nilai bisnis dicek: koin per produk, harga voucher, aturan tagihan harian
