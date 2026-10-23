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

Letakkan APK di server agar bisa diunduh dari web admin (menu **Aplikasi HP**, QR/tautan `/api/app/sajadah.apk`):

```bash
# di .env server (sekali): APK_PATH=/data/apk/sajadah.apk   lalu: docker compose up -d
mkdir -p data/apk
curl -L -o data/apk/sajadah.apk "URL_UNDUHAN_APK_DARI_HALAMAN_BUILD_EXPO"   # atau scp dari komputer Anda
chown 1000:1000 data/apk/sajadah.apk
```

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
