# Analisis Menyeluruh PanelKu (`linux-panel`)

- **Tanggal:** 22 Oktober 2026
- **Commit yang dianalisis:** `a13070a` (`fix(updater): handle proxy timeout during module compilation`), branch `master`, bekerja sama dengan `origin/master` (`https://github.com/kiramizuky/PanelKu.git`)
- **Lingkungan uji:** Windows 11, Node v22.14.0, npm 11.6.1, SQLite (fresh DB), Redis tidak tersedia
- **Sifat analisis:** read-only. Tidak ada kode aplikasi yang diubah. Dokumen ini adalah hasil audit + rencana.
- **Skala kode:** 509 file tracked, 327 file di `src/`, ±59k LOC

---

## 1. Ringkasan Eksekutif

Kualitas kode internal **baik**: `npm run lint` bersih, `npm test` lulus **89 suite / 1474 test**, arsitektur modular (routes → controller → service → repository), dan hampir semua endpoint API terlindungi JWT + RBAC (diverifikasi: `/api/dashboard/metrics` dan `/api/updater/check` mengembalikan **401**).

Masalah utama **bukan** pada fitur, melainkan pada **siklus hidup aplikasi**:

1. **Instalasi tidak menghasilkan repo Git**, sehingga fitur update memang tidak akan pernah bisa bekerja pada instalasi hasil `curl | bash`.
2. **Updater melaporkan sukses tanpa benar-benar memverifikasi** hasil update (kegagalan `npm install` tidak dianggap gagal, verifikasi hanya `node --check src/app.js`, tidak ada health check setelah restart).
3. **Semua path penting bergantung pada `process.cwd()`** (database, folder plugin, folder updater, log). Menjalankan service dari direktori berbeda dapat membuat **database baru yang kosong** atau `git reset --hard` pada direktori yang salah.
4. **Update berjalan sinkron di dalam request HTTP** tanpa lock. Di balik nginx/Cloudflare, request terputus pada 60–100 detik, padahal proses masih berjalan; klik ulang menghasilkan dua proses update paralel.
5. **Batas memori systemd (512 MB) lebih kecil dari kebutuhan Node** (`--max-old-space-size=512` + RSS native), sehingga di VPS 1 GB panel mudah di-OOM-kill dan restart berulang.

### Skor kesiapan produksi (subjektif, berbasis temuan)

| Aspek | Skor | Catatan |
|---|---|---|
| Kualitas kode & test | 8/10 | lint + 1474 test lulus |
| Keandalan update | 3/10 | sukses palsu, tanpa lock, tanpa verifikasi boot |
| Pengalaman instalasi | 3/10 | `cp -r .` dari `$PWD`, tanpa clone |
| Performa di VPS 1 GB | 4/10 | memory limit vs heap, audit log tanpa retensi |
| Keamanan | 5/10 | default admin, HTTP polos, `/metrics` & spec API publik |
| Observability | 4/10 | error git/Redis ditelan, tidak ada status job update |

---

## 2. Metode & Bukti Pengujian

| Pemeriksaan | Hasil |
|---|---|
| `npm run lint` | lulus, tanpa output |
| `npm test` | 89 suite / 1474 test lulus |
| Boot aplikasi (PORT=23457, DB terpisah) | sukses, migrasi 001–002 diterapkan |
| `GET /api/health` | **200** |
| `GET /metrics` | **200**, 3.608 byte, ±30 ms, **tanpa autentikasi** |
| `GET /api/api-docs/spec.json` | **200**, 66.470 byte, **tanpa autentikasi** |
| `GET /dashboard`, `/updater`, `/settings/profile`, `/api-docs` | **200** (shell HTML, tanpa guard server-side) |
| `GET /api/updater/check` | **401** (benar) |
| `GET /api/dashboard/metrics` | **401** (benar) |
| `npm audit --omit=dev` | **1 high**: `follow-redirects@1.16.0` (fix: 1.16.1) |
| `git ls-files --eol` | **0 file `i/crlf`** — isi repo seluruhnya LF |
| Working tree Windows | 152 file ber-CRLF karena `core.autocrlf=true` (bukan masalah repo) |

> **Koreksi terhadap asumsi awal:** CRLF **bukan** penyebab kegagalan `git pull`. Index Git seluruhnya LF; CRLF hanya ada di working tree Windows akibat `core.autocrlf=true`. Risiko CRLF hanya muncul jika contributor Windows melakukan commit dengan `autocrlf=false`, atau saat menjalankan `scripts/install.sh` langsung di Windows/Git Bash.

---

## 3. Temuan Berdasarkan Prioritas

### 3.1 P0 — Kritis (memicu "update gagal" / "pull gagal")

#### C1. Installer `curl | bash` tidak pernah melakukan `git clone`

**Bukti:** `scripts/install.sh:241-247`

```bash
setup_panel() {
  mkdir -p "$PANEL_DIR"
  if [ "$PWD" != "$PANEL_DIR" ]; then
    cp -r . "$PANEL_DIR/"
  fi
```

README (`README.md:43`) menawarkan `curl -sSL https://dl.panelku.fun/install.sh | sudo bash`. Pada alur itu `$PWD` adalah direktori tempat admin menjalankan perintah (sering `/root`), sehingga:

- Yang disalin adalah **isi home directory**, bukan source panel.
- Tidak ada `.git` → `git pull`, `git fetch`, dan seluruh fitur updater **mustahil** bekerja.
- File sensitif di `$PWD` (`.ssh`, `.env`, kredensial) ikut tersalin ke `/opt/panelku`.

**Dampak:** fitur update mati total; `checkForUpdates()` akan selalu mengembalikan "sudah terbaru" (lihat C4). Ini akar masalah paling besar.

**Perbaikan:**
- Ganti dengan `git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$PANEL_DIR"`.
- Jika skrip dijalankan dari dalam repo, gunakan `git -C "$SRC" archive HEAD | tar -x -C "$PANEL_DIR"` **plus** salin `.git` secara eksplisit, atau lebih baik tetap clone.
- Tambahkan verifikasi pasca-instal: `git -C "$PANEL_DIR" rev-parse --is-inside-work-tree` dan gagal keras bila tidak true.
- Validasi `$PWD` berisi `package.json` + `src/server.js` sebelum `cp`.

#### C2. Updater menandai sukses tanpa verifikasi nyata

**Bukti:**
- `updater.service.js:85` — `_runCommand` **tidak melempar error**; kegagalan menjadi string `[ERROR] ...`.
- `updater.service.js:599-600` — hasil `npm install` hanya dicatat 3 baris pertama, tidak diperiksa.
- `updater.service.js:620` — verifikasi hanya `node --check src/app.js` (dan dilewati di Windows).
- `updater.service.js:660` — `success = true` dieksekusi tanpa syarat setelah blok git/npm.
- `updater.service.js:686-687` — restart dijadwalkan 5 detik kemudian, apa pun hasilnya.

**Dampak:** panel melaporkan "Update completed successfully", lalu mati karena dependency/native module rusak. Admin melihat panel blank/500 dan mengira update gagal, padahal kegagalan sudah terjadi sebelum restart.

**Perbaikan:**
- `_runCommand` harus mengembalikan `{ ok, stdout, stderr, code }` atau melempar error.
- Gunakan `npm ci --omit=dev` (bukan `npm install`), periksa exit code.
- Verifikasi: `node -e "import('./src/app.js')"` **dan** boot smoke test di port sementara + `GET /api/health`.
- Verifikasi native: `require('better-sqlite3')`, `require('node-pty')`.
- Set `success` hanya jika semua gate lulus.

#### C3. Update sinkron di request HTTP, tanpa lock, tanpa timeout

**Bukti:**
- `updater.controller.js:47-55` — `await updaterService.performUpdate(...)` di dalam handler.
- Tidak ada mutex/`isUpdating` di seluruh service.
- `src/server.js` tidak mengatur `requestTimeout`/`headersTimeout`.

**Dampak:** `npm ci` + rebuild `node-pty`/`better-sqlite3` bisa 2–10 menit. nginx/Cloudflare memutus koneksi pada 60–100 detik. Frontend (`src/public/js/updater.js`) menyembunyikan ini dengan pesan "connection interrupted … likely still running", sehingga admin tidak tahu status sebenarnya. Klik ulang → dua proses `git`/`npm` paralel → `node_modules` korup, `.git/index.lock` tertinggal.

**Perbaikan:** jadikan update sebagai **job**:
- `POST /api/updater/update` → `202 { jobId }` segera.
- Worker terpisah (child process / `systemd-run --unit=panelku-update --collect`) menjalankan update dan menulis status ke `storage/update_state.json`.
- `GET /api/updater/status/:jobId` + SSE/WebSocket untuk progres.
- Tolak request kedua selama job aktif.

#### C4. Semua error Git ditelan → "sudah terbaru" palsu

**Bukti:** `updater.service.js:332-354`

```js
await this._runCommand('git fetch origin').catch(() => {});
...
behindOut = await this._runCommand(`git log HEAD..origin/${safeBranch} --oneline`);
behindCount = behindOut.includes('[ERROR]') ? 0 : ...
hasUpdate = behindCount > 0;
```

Jika `.git` tidak ada, owner mismatch, DNS/GitHub diblokir, atau proxy timeout, hasilnya **`behindCount = 0`** → UI menampilkan "up to date" tanpa pesan error.

**Perbaikan:** bedakan tiga keadaan: `up-to-date`, `update-available`, `check-failed (alasan)`. Tampilkan error jaringan/ownership secara eksplisit di UI dan log.

#### C5. Pull tidak membersihkan untracked; fallback `reset --hard` menghapus commit lokal

**Bukti:** `updater.service.js:553-581`

```js
await this._runCommand('git checkout HEAD -- .');
let pullOut = await this._runCommand(`git pull --no-edit origin ${branch}`);
...
await this._runCommand(`git checkout -B ${branch} origin/${branch}`);
await this._runCommand(`git reset --hard origin/${branch}`);
```

- `git checkout HEAD -- .` membuang perubahan lokal yang disengaja (hotfix admin).
- Tidak ada `git clean` → file untracked yang bertabrakan dengan file baru di upstream tetap membuat pull gagal, dan `reset --hard` pun tidak menghapusnya.
- `reset --hard` menghapus commit lokal di server tanpa backup.
- File yang dihapus di upstream tetapi masih ada sebagai untracked tetap "membayangi" kode baru.

**Perbaikan:**
- Backup dulu: `git bundle create storage/backups/pre-update.bundle --all` atau `git tag pre-update-<ts>`.
- Urutan aman: `git fetch` → `git diff --name-only` → deteksi tabrakan → pindahkan file untracked ke `storage/update-backup/<ts>/` → `git reset --hard origin/<branch>` → `git clean -fd` **dengan exclude** `storage/ .env node_modules plugins/*/data`.
- Jangan pernah `reset --hard` sebelum backup commit.

---

### 3.2 P1 — Tinggi

#### H1. Docker Compose memetakan port yang salah

**Bukti:** `docker-compose.yml:10-14` → `"23456:23456"` dan `PORT=3000`. Aplikasi listen di 3000 (`Dockerfile` `EXPOSE 3000`), sehingga tidak ada yang mendengarkan di 23456 di dalam container.

**Perbaikan:** `"23456:3000"` atau set `PORT=23456` dan `EXPOSE 23456`.

#### H2. Image Docker memakai secret contoh yang lolos validasi produksi

**Bukti:**
- `Dockerfile:12` → `COPY .env.example ./.env`
- `.env.example:10,14,16` → `change_this_...`
- `src/config/app.js:6-9` → daftar `DANGEROUS_DEFAULTS` hanya berisi `dev-secret-*`, **tidak** memuat placeholder `change_this_*`.

**Dampak:** container bisa boot di produksi dengan `JWT_SECRET` yang diketahui publik. Siapa pun dapat memalsukan token dan mendapatkan akses penuh. Selain itu:
- `Dockerfile` tidak menyalin `package-lock.json` (build tidak reproducible) dan tidak menyalin `plugins/` (plugin tidak tersedia; `PluginLoader` hanya log "no plugins directory").
- `npm install --production` (deprecated).

**Perbaikan:** hapus `COPY .env.example`; gunakan `docker secrets`/env wajib; tambahkan placeholder `change_this_*` ke `DANGEROUS_DEFAULTS`; `COPY package*.json` + `npm ci --omit=dev`; `COPY plugins/ ./plugins/`.

#### H3. Semua path bergantung pada `process.cwd()`

**Bukti:**
- `updater.service.js:23` → `const PANEL_DIR = process.cwd();`
- `core/plugin-loader/PluginLoader.js:20` → `resolve('./plugins')`
- `core/db/sqlite.js:27` → `resolve(process.cwd(), 'storage', 'panelku.db')`
- `plugins.controller.js:488` → `path.resolve('./plugins', safeId)`
- `ecosystem.config.cjs` tidak punya `cwd`

**Dampak:**
- Menjalankan `pm2 start` dari direktori lain → **database baru kosong** dibuat, plugin tidak ditemukan, dan updater menjalankan `git reset --hard` di direktori yang salah (bisa menghapus pekerjaan yang tidak terkait).
- `DB_PATH` dari `.env`/compose **diabaikan** (kode hanya membaca `PANELKU_DB_PATH`), sehingga konfigurasi pengguna tidak berefek.

**Perbaikan:** buat `src/config/paths.js` yang menghitung `APP_ROOT` dari `import.meta.url` (bukan cwd), mendukung override `PANELKU_HOME`, dan membaca `DB_PATH`. Tambahkan `cwd: __dirname` di `ecosystem.config.cjs`, dan path absolut untuk log.

#### H4. Batas memori systemd lebih kecil dari kebutuhan Node

**Bukti:** `scripts/install.sh:357-362`

```
ExecStart=... --max-old-space-size=512 src/server.js
MemoryHigh=400M
MemoryMax=512M
```

`--max-old-space-size=512` hanya heap V8; RSS total (heap + native `better-sqlite3` + `node-pty` + buffer + socket) melewati 512 MB. `MemoryHigh=400M` menekan (throttle) jauh sebelum heap penuh.

**Dampak:** di VPS 1 GB, panel lambat (throttling) lalu OOM-kill; `Restart=on-failure` → crash loop. PM2 juga memakai `max_memory_restart: 600M` dengan heap 512 MB (margin hanya 88 MB).

**Perbaikan:** `MemoryHigh=768M`, `MemoryMax=1024M` (atau hapus `MemoryHigh`), heap 384 MB untuk VPS 1 GB; PM2 `max_memory_restart: 800M`. Ukur RSS nyata setelah 24 jam.

#### H5. `/metrics` dan spesifikasi API terbuka tanpa autentikasi

**Bukti (diverifikasi runtime):**
- `src/app.js:151-159` mendaftarkan `/metrics` dan `/api/metrics` sebelum middleware auth apa pun → **200**, berisi CPU count, load, memori, disk, jumlah user, container Docker, antrean.
- `src/modules/api-docs/api-docs.routes.js` → `/api/api-docs/spec.json` **200**, 66 KB, seluruh permukaan API + skema.

**Dampak:** information disclosure (topologi, versi, jumlah user, endpoint admin) yang memudahkan penyerangan; `/metrics` juga relatif mahal sehingga bisa dipakai untuk memperbanyak beban.

**Perbaikan:** lindungi dengan token (`METRICS_TOKEN`) atau bind ke `127.0.0.1` + allowlist nginx; matikan spec publik di produksi atau wajibkan auth.

#### H6. Default admin + HTTP polos + port terbuka

**Bukti:**
- `src/bootstrap.js:197-206` membuat `admin / Admin@123456` dengan `mustChangePassword: true`.
- `src/modules/auth/auth.service.js:160-167` **tetap mengembalikan `accessToken` penuh** sebelum password diganti; pembatasan hanya di UI.
- `src/server.js:19` → `server.listen(port)` (semua interface).
- `scripts/install.sh:384` → `ufw allow 23456/tcp`.
- Tidak ada TLS di aplikasi.

**Dampak:** instalasi baru langsung dapat diakses dari internet via HTTP polos dengan kredensial default yang terdokumentasi. Penyerang dapat memakai API langsung (tidak menunggu UI memaksa ganti password), dan token/sandi dapat disadap di jaringan.

**Perbaikan:** token terbatas (scope `password-change-only`) sampai password diganti; bind `127.0.0.1` secara default dan wajibkan reverse proxy TLS; atau generate password acak saat instalasi dan tampilkan sekali; tambahkan HSTS saat di belakang proxy.

#### H7. "Update plugin" mengotori repo dan tidak benar-benar mengunduh kode

**Bukti:** `src/modules/plugins/plugins.controller.js:477-486, 504-506`

```js
const serverVersions = { 'php-manager': '1.2.0', ... }; // hardcoded
manifest.version = targetVersion;
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
```

`plugins/*/plugin.json` adalah file **tracked**. Setiap klik update membuat working tree kotor; `git pull` manual akan gagal bila upstream juga mengubah file tersebut. Tidak ada download/artifact: yang terjadi hanyalah menaikkan nomor versi di manifest + `npm install` + `update.sh` opsional. Pesan sukses tetap dikembalikan walau `update.sh` gagal.

**Perbaikan:** simpan versi terpasang di DB/`storage/plugins-state.json`, jangan menulis manifest tracked; sediakan registry plugin + unduhan bertanda tangan; laporkan kegagalan script sebagai kegagalan.

#### H8. `safe.directory "*"` melemahkan proteksi Git

**Bukti:** `updater.service.js:533` → `git config --global --add safe.directory "*"`.

**Dampak:** mematikan deteksi "dubious ownership" untuk **semua** repo di mesin, bukan hanya panel. Jika ada proses lain yang berjalan sebagai user berbeda, risiko eksekusi hook dari repo yang tidak dipercaya meningkat.

**Perbaikan:** hanya daftarkan `PANEL_DIR` (sudah ada di baris 532); hapus baris 533. Selesaikan ownership saat instalasi (`chown -R panelku:panelku`).

#### H9. Redis menyerah permanen setelah 10 percobaan

**Bukti:** `src/config/redis.js:10-13`

```js
retryStrategy: (times) => {
  if (times > 10) return null;
  return Math.min(times * 100, 3000);
}
```

**Dampak:** jika Redis mati saat boot (umum pada homeserver tanpa Redis), panel berjalan dengan cache in-memory **selamanya** sampai restart, tanpa reconnect dan tanpa indikator di UI. Log error juga kosong (`Redis error: `) karena `err.message` kosong pada beberapa error ioredis, sehingga sulit didiagnosis.

**Perbaikan:** retry tanpa batas dengan backoff maksimum 30 detik + jitter; ping periodik; tampilkan status Redis di `/api/health`; log `err.code || err.name || 'unknown'`.

#### H10. AutoHeal mencoba menyalakan service yang memang tidak terpasang

**Bukti:** `src/modules/autoheal/autoheal.service.js:215-279` hanya memeriksa `systemctl is-active`, lalu `systemctl start` hingga `maxRetries`, dan mengirim notifikasi "critical" setiap kali.

**Dampak:** di homeserver yang sengaja tidak memakai Apache/MySQL/PostgreSQL/Redis, setiap 3 menit muncul percobaan start + alert/notifikasi palsu (bisa sampai email/Telegram/WhatsApp). Ini juga menambah proses `systemctl` dan spam log.

**Perbaikan:** hanya kelola unit yang **terpasang dan enabled** (`systemctl list-unit-files`), tambahkan daftar service opt-in per pengguna, cooldown alert, dan backoff.

#### H11. Jalur restart tidak andal

**Bukti:** `updater.service.js:846-864` mencoba `systemctl restart panelku` → `pm2 restart panelku` → `process.exit(0)`. Unit systemd memakai `Restart=on-failure` (`install.sh:358`).

**Dampak:** jika `systemctl` dan `pm2` gagal, `process.exit(0)` dianggap **sukses** oleh systemd sehingga panel tidak pernah dijalankan ulang. Selain itu, `pm2 restart` dari dalam proses yang sedang di-restart rawan race.

**Perbaikan:** gunakan supervisor eksternal (`systemd-run`/`setsid`) untuk melakukan restart; atau `Restart=always` + exit code non-zero; jangan andalkan `pm2` dari dalam proses.

#### H12. Kerentanan dependensi & gate CI yang tidak memblokir

**Bukti:** `npm audit --omit=dev` → `follow-redirects@1.16.0` **high** (GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c), tersedia perbaikan 1.16.1. `package-lock.json:6991` masih 1.16.0. Workflow `build-and-push` memakai `needs: [ci-lint, ci-window-check, ci-csp]` sehingga `ci-audit` **tidak memblokir** publikasi image.

**Perbaikan:** `npm audit fix` / bump lockfile; tambahkan `ci-audit` ke `needs`; tambahkan Dependabot/Renovate.

---

### 3.3 P2 — Sedang (performa & ketahanan)

#### M1. `audit_logs` tumbuh tanpa batas

**Bukti:** `src/middleware/requestLogger.js:12-37` menulis setiap request mutasi (termasuk login gagal sebagai `anonymous`) dan menyimpan `details.query`. Tidak ada job retensi; satu-satunya `DELETE FROM audit_logs` ada di `models/AuditLog.js:88` (clear all manual).

**Dampak:** DB membengkak, write makin lambat, disk bisa penuh; query string sensitif (token reset, API key) tersimpan permanen.

**Perbaikan:** job harian hapus > 90 hari atau batasi 200k baris; index `created_at`; redaksi `req.query` (whitelist field aman); pisahkan tabel audit ke DB/rotasi file.

#### M2. Tidak ada kompresi + cache statis memaksa revalidasi

**Bukti:** tidak ada middleware `compression` (tidak ada di `package.json`); `src/app.js:135-139` mengirim `Cache-Control: no-cache, must-revalidate` untuk semua `.js/.css`, tanpa hash di nama file; HTML dashboard ±60 KB.

**Dampak:** setiap muat halaman, 20+ aset JS/CSS direvalidasi; pada koneksi jauh (rumah → VPS) terasa lambat. Tanpa nginx, HTML/JS dikirim tanpa gzip/brotli.

**Perbaikan:** `app.use(compression())`; aset dengan hash + `max-age=31536000, immutable`; HTML `no-cache`; pertimbangkan bundling ringan.

#### M3. Arsitektur monitoring ganda & tanpa timeout

**Bukti:**
- `src/public/js/monitor.js:293-325` polling `GET /monitor/metrics` setiap **5 detik**.
- `src/modules/monitor/monitor.service.js` memakai dedup cache **3 detik** → polling 5 detik hampir selalu cache miss.
- `src/websocket/monitor.ws.js` menyiarkan metrik setiap **3 detik**, tetapi halaman monitor **tidak** berlangganan WebSocket (monitor.js tidak memuat `socket`/`WebSocket`).
- Panggilan `si.*` dibungkus `Promise.allSettled` tanpa timeout eksplisit.

**Dampak:** beban `systeminformation` periodik per sesi; mount jaringan (NFS/SMB) yang hang dapat menahan endpoint metrik; ada dua mekanisme yang harus dipelihara.

**Perbaikan:** pilih satu jalur (WS untuk halaman aktif, REST untuk fallback), jeda saat `document.hidden`, timeout 3 detik per panggilan `si`, dan naikkan TTL cache ke ≥ interval poll.

#### M4. `/metrics` menghitung ulang data relatif mahal

**Bukti:** `prometheus.service.js:82-93` menjalankan `COUNT(*)` pada `waf_rules` dan `users` tiap scrape; ringkasan Docker (cache 3 detik) dan metrik antrean juga diambil tiap scrape.

**Dampak:** saat ini ±30 ms di mesin uji, tetapi tumbuh linear dengan jumlah container/antrean; tanpa auth, mudah dijadikan amplifier.

**Perbaikan:** cache hasil 10–15 detik, auth token, dan hindari query DB per scrape (simpan gauge di memori).

#### M5. Query analytics & histori monitor tidak efisien

**Bukti:** `analytics.service.js:44-57` memuat seluruh `monitor_history` lalu memfilter di JS; `models/MonitorHistory.js:52` menjalankan `COUNT(*)` setiap insert (tiap 60 detik) lalu `DELETE ... ORDER BY timestamp LIMIT ?`.

**Dampak:** dibatasi 10k baris sehingga tidak fatal, tetapi tetap O(n) per request dan menambah beban write.

**Perbaikan:** `WHERE timestamp >= ?` di SQL, downsampling dengan `GROUP BY`, cache hasil, dan ganti `COUNT(*)` dengan counter di memori atau `SELECT COUNT(*)` terjadwal.

#### M6. `git-deployer`: stash tanpa `-u`

**Bukti:** `plugins/git-deployer/index.js:398-427` → `git stash push -m ...` (tanpa `-u`), lalu hook, lalu `git stash pop`.

**Dampak:** file untracked tetap ada dan dapat memblokir `git pull` ("untracked working tree files would be overwritten"). Jika `pop` konflik, repo tertinggal dalam keadaan stash/konflik dan deploy berikutnya gagal.

**Perbaikan:** `git stash push -u`, tangani konflik `pop` dengan log + opsi discard, dan jalankan `git pull --ff-only` sebelum hook.

#### M7. Rollback & verifikasi pasca-update lemah

**Bukti:** rollback (`updater.service.js:722-827`) melakukan `reset --hard` + `npm install`, tetapi tidak memverifikasi boot; `npm install` juga tidak memakai `npm ci`; tidak ada pengecekan health setelah restart.

**Perbaikan:** health gate + auto-rollback berbasis supervisor eksternal, serta `npm ci` untuk reproducibility.

#### M8. Docker socket = akses root

**Bukti:** `docker-compose.yml` me-mount `/var/run/docker.sock`.

**Dampak:** container panel efektif setara root di host. Mode `:ro` bukan batas keamanan yang nyata untuk socket.

**Perbaikan:** gunakan `docker-socket-proxy` (tecnativa) dengan endpoint terbatas, atau jalankan panel di host untuk fitur Docker.

#### M9. CSP masih mengizinkan inline event handler

**Bukti:** `src/app.js:56-60` → `script-src-attr 'unsafe-inline'`; komentar menyebut 126+ handler `onclick/onchange`.

**Dampak:** jika ada titik injeksi HTML, penyerang dapat menjalankan JavaScript via atribut (nonce tidak melindungi atribut).

**Perbaikan:** migrasi bertahap ke `data-action` + `addEventListener`, lalu hapus `unsafe-inline` dari `script-src-attr`; tambahkan test CSP.

#### M10. Dependensi berisiko/EOL

- `multer@1.4.5-lts.1` (`package.json:51`) — seri 1.x sudah deprecated; naikkan ke 2.x (API mirip, perlu uji upload).
- `@whiskeysockets/baileys@^7.0.0-rc13` (`package.json:30`) — prerelease; pin versi exact + feature flag agar update tidak memecahkan WhatsApp.
- Node image Docker 20 vs runtime uji 22 (`Dockerfile`), sementara `engines` `>=20`; samakan ke 22 LTS.

---

### 3.4 P3 — Rendah (higiene)

- **L1. `.gitattributes` tidak ada.** Index LF (aman), tetapi tanpa `* text=auto eol=lf` + `*.sh text eol=lf`, contributor Windows berpotensi commit CRLF. Tambahkan juga `*.sh text eol=lf`.
- **L2. File sampah tracked:** `find_brace_fix.mjs`, `test_render.js`, `tmp-raid-tab-entry.txt`. Hapus.
- **L3. `.gitignore` kurang:** `data/`, `run/`, `storage/websites/`. (`data/` kosong; `run/_` sisa artefak husky dengan `.gitignore` sendiri.)
- **L4. Versi tidak konsisten:** `package.json` 3.6.0 vs badge README 3.5.0; `docs/audit-exec-checklist.md` menyebut port 3699 (aktual 23456). Perbarui atau generate badge dari package.json.
- **L5. Installer memakai `npm install --production`** (`install.sh:276`) — deprecated; ganti `npm ci --omit=dev`.
- **L6. `.gitignore` mengabaikan `install.sh` di root** — berisiko jika installer kanonik suatu saat diletakkan di root dan tidak sengaja tidak ter-commit.
- **L7. `updatePlugin` memanggil `pluginLoader._loadPlugin` (private)** dan `npm install --production`; rapikan API-nya.

---

## 4. Deep Dive: Kenapa Update Gagal

Alur saat ini:

```
UI POST /api/updater/update
   └─ controller (await, request menggantung)
        └─ performUpdate
             1. backup storage
             2. git config safe.directory "*"
             3. merge/rebase abort
             4. git checkout HEAD -- .
             5. git pull  ── gagal? ──> fetch + checkout -B + reset --hard
             6. npm install --omit=dev        (gagal = [ERROR], tidak throw)
             7. rebuild native                (gagal = warning)
             8. node --check src/app.js       (hanya 1 file!)
             9. success = true
            10. setTimeout(restart, 5s)
   └─ response (mungkin sudah timeout di proxy)
```

Titik kegagalan, berurutan:

| # | Titik | Gejala di lapangan |
|---|---|---|
| 1 | Tidak ada `.git` (C1) | `check` selalu "up to date" |
| 2 | `git pull` konflik dengan perubahan lokal (H7) | "Your local changes would be overwritten" |
| 3 | File untracked bertabrakan (C5) | "untracked working tree files would be overwritten" |
| 4 | Dubious ownership / beda user | "detected dubious ownership in repository" |
| 5 | `.git/index.lock` tertinggal | "Unable to create index.lock: File exists" |
| 6 | GitHub tidak dapat diakses (DNS/proxy/firewall) | `fetch` gagal, dilaporkan "up to date" |
| 7 | Branch lokal berbeda (`main` vs `master`) | `HEAD..origin/master` kosong / merge unrelated |
| 8 | `npm ci`/rebuild native gagal (RAM, compiler) | dilaporkan sukses, panel mati setelah restart |
| 9 | Proxy timeout 60–100 s (C3) | UI "connection interrupted", status tidak jelas |
| 10 | Restart gagal (H11) | panel tidak kembali, proses lama mati |

**Kesimpulan:** "update gagal" bukan satu bug, melainkan **kombinasi installer yang tidak menghasilkan repo, error yang ditelan, dan tidak adanya verifikasi**. Perbaikan harus menyentuh ketiganya sekaligus.

---

## 5. Deep Dive: Kenapa `git pull` dari GitHub Diblokir di Server

| Penyebab | Cara mendeteksi | Perbaikan |
|---|---|---|
| Tidak ada repo | `git -C /opt/panelku rev-parse --is-inside-work-tree` | install ulang via clone (C1) |
| Perubahan lokal tracked | `git -C /opt/panelku status --porcelain` | hentikan tulis manifest (H7), `git restore` terkontrol |
| Untracked bertabrakan | `git status --porcelain --untracked-files=all` | backup + `git clean` terarah (C5) |
| Commit lokal divergen | `git log --oneline origin/master..HEAD` | backup/bundle, reset terkontrol |
| Ownership | `stat -c '%U' .git; id -un` | `chown -R` ke user service; hapus `safe.directory "*"` |
| Lock tertinggal | `ls -l .git/index.lock` | pastikan tidak ada proses git, hapus lock |
| Jaringan ke GitHub | `git ls-remote origin` / `curl -I https://github.com` | proxy/DNS/firewall; tampilkan error (C4) |
| Disk penuh | `df -h /opt/panelku` | retensi log/backup; bersihkan `node_modules` cache |
| Branch salah | `git branch -vv; git remote show origin` | samakan branch default |
| CRLF | `git ls-files --eol | grep i/crlf` | **tidak terbukti** — index LF; tambah `.gitattributes` untuk pencegahan |

**Perintah diagnosa 60 detik (read-only):**

```bash
cd /opt/panelku
git rev-parse --is-inside-work-tree
git remote -v
git status --porcelain=v1 -uall
git rev-list --count HEAD..origin/master
git log --oneline -5
git fsck --no-progress
ls -l .git/index.lock 2>/dev/null
id; stat -c '%U:%G' .git
df -h .
node -v; npm -v
```

---

## 6. Analisis Performa (Lag)

1. **Memori (H4)** — penyebab paling mungkin di VPS kecil. Heap 512 MB + RSS native > `MemoryMax=512M` → throttle/OOM.
2. **Audit log (M1)** — setiap POST/PUT/PATCH/DELETE menulis ke SQLite tanpa retensi. Semakin lama dipakai, makin lambat dan disk makin penuh.
3. **Monitoring (M3)** — polling 5 detik vs cache 3 detik hampir selalu miss; `si.*` tanpa timeout; WS 3 detik tidak dipakai halaman monitor.
4. **Aset statis (M2)** — tanpa kompresi, `no-cache` untuk 20+ file JS/CSS, HTML 60 KB.
5. **Redis (H9)** — setelah gagal, semua cache pindah ke memori proses; tidak ada reconnect, tidak ada alarm. Beban DB naik diam-diam.
6. **AutoHeal (H10)** — percobaan start service yang tidak ada + alert berulang tiap 3 menit.
7. **Query (M5)** — analytics memuat seluruh histori lalu memfilter di JS; `COUNT(*)` tiap insert histori.
8. **Startup** — `PluginLoader` memuat semua plugin saat boot; `getVersionInfo` menjalankan beberapa `git` command; tidak ada masalah besar, tetapi jika `cwd` salah, plugin tidak termuat dan aplikasi tampak "kosong".

**Cara ukur yang disarankan:** kirim `SIGUSR1` untuk heap snapshot? Lebih praktis: `/metrics` (setelah diamankan) + `process.memoryUsage()` di endpoint health, `journalctl -u panelku --since -1h | grep -i oom`, dan `systemd-cgtop`.

---

## 7. Ringkasan Keamanan

| Risiko | Tingkat | Tindakan |
|---|---|---|
| Default admin + token penuh + HTTP polos + port terbuka (H6) | Kritis | token terbatas sampai ganti password; bind localhost/TLS; password acak saat instalasi |
| Secret `.env.example` diterima di produksi (H2) | Kritis (Docker) | tolak `change_this_*`; hapus copy `.env` |
| `/metrics` & spec API publik (H5) | Tinggi | token/allowlist; auth spec |
| `safe.directory "*"` (H8) | Tinggi | hapus |
| Docker socket (M8) | Tinggi | socket proxy |
| `follow-redirects` high (H12) | Tinggi | bump 1.16.1 |
| CSP `unsafe-inline` atribut (M9) | Sedang | migrasi handler |
| Audit log menyimpan query (M1) | Sedang | redaksi |
| `multer` 1.x EOL, `baileys` RC (M10) | Sedang | upgrade/pin |
| systemd berjalan sebagai root tanpa sandbox | Sedang | user khusus + polkit/sudoers terbatas + `ProtectSystem` |

---

## 8. Rencana Perbaikan

### Sprint 0 — Hotfix (1–2 hari, wajib sebelum rilis berikutnya)

| # | Aksi | File | Kriteria selesai |
|---|---|---|---|
| 0.1 | Installer clone repo + verifikasi `.git` | `scripts/install.sh` | VM Ubuntu fresh: `/opt/panelku/.git` ada, `git status` bersih, update terdeteksi |
| 0.2 | Updater: `_runCommand` melempar error; `npm ci`; cek native; health gate | `updater.service.js` | Simulasi registry mati → update **gagal** dan rollback, bukan sukses |
| 0.3 | Job-based update + lock + status endpoint | `updater.controller.js`, `updater.service.js`, `public/js/updater.js` | Request > 60 s tetap 202; double-click ditolak; progres terlihat |
| 0.4 | `git clean` terarah + backup bundle | `updater.service.js` | File untracked yang bertabrakan dipindah ke `storage/update-backup/` |
| 0.5 | Hapus `safe.directory "*"`; perbaiki ownership saat install | `updater.service.js`, `install.sh` | `git pull` jalan tanpa melonggarkan global config |
| 0.6 | Docker: port, lockfile, plugins, secret | `docker-compose.yml`, `Dockerfile`, `src/config/app.js` | `docker compose up` → health 200; boot gagal bila secret placeholder |
| 0.7 | Memory limit realistis | `install.sh`, `ecosystem.config.cjs` | 24 jam di VPS 1 GB tanpa OOM/restart |
| 0.8 | Auth `/metrics`, spec API, token default admin | `src/app.js`, `api-docs.routes.js`, `auth.service.js` | Tanpa token → 401; user default tidak bisa memanggil API lain |
| 0.9 | `npm audit fix` + gate CI | `package-lock.json`, workflow | audit high = 0; `ci-audit` masuk `needs` |
| 0.10 | Path absolut (`APP_ROOT`), hormati `DB_PATH` | `config/paths.js` (baru), `sqlite.js`, `PluginLoader.js`, `updater.service.js`, `ecosystem.config.cjs` | Start dari direktori mana pun memakai DB/plugin yang sama |

### Sprint 1 — Keandalan (1 minggu)

1. **Updater v2**: skrip supervisor terpisah (`scripts/panel-update.sh`) yang dijalankan detached, menulis state ke `storage/update_state.json`, restart, poll `/api/health`, rollback otomatis bila gagal boot dalam 120 detik. UI membaca state, bukan menebak dari timeout.
2. **Redis**: reconnect tak terbatas + backoff 30 detik, health indicator, log error yang informatif.
3. **Retensi**: `audit_logs` 90 hari/200k baris, `monitor_history` 7 hari, `update_history` 50 entri, rotasi log.
4. **AutoHeal opt-in**: hanya unit terpasang+enabled, daftar service per pengguna, cooldown notifikasi.
5. **Test**: unit updater dengan repo Git sementara (skenario konflik, untracked, npm gagal, rollback) + smoke test boot di CI.

### Sprint 2 — Performa & Keamanan (2 minggu)

1. `compression`, cache aset immutable, lazy-load library berat.
2. Monitoring satu jalur (WS + fallback REST), timeout `si.*`, pause saat tab hidden.
3. Analytics via SQL + downsampling; `/metrics` di-cache dan diberi token.
4. Migrasi CSP handler ke `data-action`; hapus `unsafe-inline`.
5. systemd hardening (user khusus, `NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths=/opt/panelku/storage`), polkit/sudoers untuk aksi sistem.
6. Docker socket proxy; `multer` 2.x; pin `baileys`; Node 22 di image.
7. `.gitattributes`, hapus file sampah, lengkapi `.gitignore`, sinkronkan versi dokumen.

### Sprint 3 — Pengembangan (4–8 minggu)

Lihat roadmap di bawah.

---

## 9. Roadmap Pengembangan

### v3.6.1 — "Reliable Update" (segera)
- Semua Sprint 0 + perbaikan dokumentasi.
- Rilis tanpa fitur baru; fokus pada kepercayaan (update tidak boleh merusak panel).

### v3.7.0 — "Operations"
- Updater v2 (job, progres SSE, rollback terverifikasi, update offline dari tarball bertanda tangan).
- Config path terpusat + dukungan `DB_PATH`/`PANELKU_HOME`.
- Retensi & housekeeping otomatis; Redis reconnection; health dashboard yang jujur.
- CLI `panelku` untuk recovery (reset password, cek update, rollback, doctor).

### v3.8.0 — "Hardening"
- CSP ketat tanpa `unsafe-inline`; RBAC per-resource diaudit ulang; API key dengan scope.
- Panel berjalan sebagai user non-root + polkit allowlist; docker socket proxy.
- 2FA wajib untuk role admin; rate limit per user; audit export.
- Dependensi: multer 2, baileys pinned, Node 22; SBOM + signed image.

### v4.0.0 — "Scale"
- Dukungan PostgreSQL/MySQL untuk metadata (SQLite tetap default).
- Plugin sandbox (child process/worker + manifest izin) dan marketplace bertanda tangan.
- Observability: OpenTelemetry, metrics ber-token, log terstruktur, tracing deploy.
- Fleet/multi-node yang lebih matang: health agregat, deploy terjadwal, drift detection.
- Backup/DR: verifikasi restore otomatis, retention policy, enkripsi.
- i18n (ID/EN), aksesibilitas, E2E Playwright untuk alur kritis (login, update, deploy, backup).

### Backlog kualitas
- CI matrix Linux (Ubuntu 22/24) × Node 20/22 + `docker build` + smoke test.
- Coverage gate untuk modul kritikal (auth, updater, backup, filemanager).
- Fuzzing ringan untuk input path/command; SAST (CodeQL) + Dependabot.
- Dokumentasi arsitektur & runbook insiden (update gagal, DB hilang, Redis down).

---

## 10. Checklist Verifikasi Setelah Perbaikan

**Update**
- [ ] Fresh install via `curl | bash` → `.git` ada, `git status` bersih.
- [ ] `GET /api/updater/check` mengembalikan `behindCount` benar; saat GitHub diblokir → error jelas (bukan "up to date").
- [ ] Update di balik proxy 60 s → 202, progres terlihat, status akhir benar.
- [ ] Simulasi `npm ci` gagal → update gagal + rollback + panel tetap hidup.
- [ ] File untracked yang bertabrakan → dipindah ke `storage/update-backup/<ts>/`, update sukses.
- [ ] Commit lokal di server → dibundel sebelum reset; bisa dipulihkan.

**Instalasi & runtime**
- [ ] Start dari direktori berbeda → DB dan plugin sama.
- [ ] `DB_PATH` benar-benar dipakai.
- [ ] 24 jam di VPS 1 GB: RSS stabil, tidak ada OOM (`journalctl | grep -i oom` kosong).
- [ ] `docker compose up` → health 200 pada port yang dipetakan.
- [ ] Redis dimatikan lalu dinyalakan → panel reconnect otomatis.
- [ ] AutoHeal tidak mengirim alert untuk service yang tidak terpasang.

**Keamanan**
- [ ] `/metrics` tanpa token → 401; spec API tanpa auth → 401.
- [ ] Login default → hanya bisa ganti password; endpoint lain 403.
- [ ] `npm audit --omit=dev` → 0 high/critical.
- [ ] `git config --global --get-all safe.directory` tidak berisi `*`.
- [ ] Panel tidak listen di `0.0.0.0` tanpa TLS (atau didokumentasikan wajib reverse proxy).

---

## 11. Peta File Kunci

| Area | File |
|---|---|
| Entry & routing | `src/server.js`, `src/app.js`, `src/routes/index.js` |
| Bootstrap & job | `src/bootstrap.js`, `src/jobs/monitor.job.js`, `src/core/scheduler/Scheduler.js` |
| Database | `src/core/db/sqlite.js`, `src/core/db/Migrator.js`, `src/core/db/migrations/*` |
| Updater | `src/modules/updater/updater.service.js`, `.controller.js`, `.routes.js`, `src/public/js/updater.js` |
| Plugin | `src/core/plugin-loader/PluginLoader.js`, `src/modules/plugins/plugins.controller.js`, `plugins/*` |
| Monitoring | `src/modules/monitor/monitor.service.js`, `prometheus.service.js`, `src/websocket/monitor.ws.js`, `src/public/js/monitor.js` |
| Cache/Redis | `src/helpers/cache.js`, `src/config/redis.js`, `src/core/queue/QueueManager.js` |
| Audit | `src/middleware/requestLogger.js`, `src/models/AuditLog.js` |
| AutoHeal | `src/modules/autoheal/autoheal.service.js`, `src/modules/autoheal/providers/*` |
| Deployment | `scripts/install.sh`, `ecosystem.config.cjs`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/docker-publish.yml` |
| Keamanan | `src/config/app.js`, `src/middleware/auth.js`, `src/middleware/rbac.js`, `src/modules/auth/auth.service.js` |

---

## 12. Catatan Penutup

Prioritas tertinggi bukan menambah fitur, melainkan **membuat update dapat dipercaya**. Selama installer tidak menghasilkan repo Git dan updater menyatakan sukses tanpa verifikasi, setiap rilis berpotensi meninggalkan panel dalam keadaan rusak — dan itu jauh lebih mahal daripada menunda satu fitur.

Urutan yang disarankan: **C1 → C2 → C3 → C5 → H3 → H4 → H1/H2 → H5/H6 → sisanya**.

---

## 13. Status Implementasi Sprint 0 (Hotfix) — 2026-10-22

Selesai dan terverifikasi:

- [x] **C1** Installer melakukan `git clone` (atau memakai clone lokal / repo yang sudah ada), memverifikasi `.git`, dan memakai `npm ci --omit=dev`.
- [x] **C2** Update memakai `_runChecked` untuk langkah kritis, `npm ci`, rebuild native, dan verifikasi boot (import seluruh modul + `better-sqlite3`).
- [x] **C3** Update nyata berjalan sebagai background job (`202 + jobId`), ada single-flight lock (`409`), dan endpoint `GET /api/updater/status`.
- [x] **C4** Kegagalan `git fetch` / perbandingan remote tidak lagi dilaporkan sebagai "up to date" (`checkFailed` + `checkError`, ditampilkan di UI).
- [x] **C5** Untracked file yang menghalangi merge dikarantina ke `storage/update-backup/`, plus recovery bundle dan patch working tree sebelum reset.
- [x] **H1/H2** Port Docker Compose diperbaiki (`23456:3000`), image memakai lockfile + plugins, tidak menyalin `.env.example`.
- [x] **H3** Path terpusat di `src/config/paths.js` (DB, storage, plugins, updater, backup, log, SSL, WhatsApp, terminal audit).
- [x] **H4** Batas memori menyesuaikan RAM VPS; heap systemd 256/384/512 MB.
- [x] **H5** `/metrics` memerlukan `METRICS_TOKEN` atau loopback; API docs nonaktif di produksi kecuali `ENABLE_API_DOCS=true`.
- [x] **H6** Installer membuat password admin acak; endpoint mutasi diblokir (`403`) sampai password default/expired diganti.
- [x] **H8** `safe.directory "*"` dihapus; hanya direktori panel yang di-whitelist.
- [x] **H11** `Restart=always` + `StartLimitBurst`, dan status update dipulihkan setelah boot (`markBootVerified`, `interrupted`).
- [x] **H12** `follow-redirects` diperbarui; `npm audit --omit=dev` bersih.
- [x] Higiene: `.gitattributes`, `.dockerignore`, `.gitignore`, file debug dihapus, badge versi 3.6.0.

Verifikasi:

- `npm run lint` bersih.
- `npm test`: **89 suite / 1476 test lulus**.
- Smoke test produksi: `/api/health` 200, `/metrics` 200 dari loopback, `/api/api-docs/spec.json` 404, `/api/updater/status` 401 tanpa token.
- Smoke test alur admin: update diblokir 403 sebelum ganti password, ganti password 200, login ulang `mustChangePassword=false`, update job berjalan (`running`).

Ditunda ke Sprint 1 (butuh supervisor eksternal / perubahan arsitektur):

- Watchdog pasca-restart yang otomatis rollback bila panel gagal boot.
- Reconnect Redis, retention history, AutoHeal opt-in, dan job scheduler terpusat.
- Telemetry progress granular per langkah update (saat ini log dikirim setelah job selesai).

---

## 14. Status Implementasi Sprint 1 (Keandalan) — 2026-10-22

Selesai dan terverifikasi:

- [x] **Updater v2 / supervisor detached** — `scripts/panel-update.sh` menjalankan worker Node (`scripts/panel-update-worker.mjs`) di luar proses panel. Di Linux supervisor dijalankan lewat `systemd-run` (transient unit) agar selamat dari `systemctl restart panelku`; fallback `bash` detached untuk PM2/non-systemd.
  - State ditulis ke `storage/update_state.json` dengan fase `updating → restarting → verifying → success`, atau `rolling_back → rolled_back/failed`.
  - Worker me-restart layanan, mem-poll `/api/health` hingga 120 detik (2 probe sukses berurutan), lalu rollback ke commit sebelumnya dan restart lagi bila panel tidak sehat.
  - `performUpdate`/`performRollback` menerima `_deferRestart` sehingga supervisor yang mengendalikan restart + verifikasi.
  - `markBootVerified` tidak lagi menyelesaikan state milik supervisor; ia hanya mencatat `bootSeenAt`/`health-check`, dan menandai `interrupted` bila state `running` sudah stale >30 menit.
  - UI `updater.js` membaca state persisten, menangani `restarting`/`verifying`/`rolling_back`/`rolled_back`/`interrupted`, dan menampilkan hasil terakhir setelah reload.
- [x] **Redis** — `retryStrategy` tidak pernah menyerah, backoff eksponensial + jitter dibatasi 30 detik; `connectTimeout`/`keepAlive`/`reconnectOnError` ditambahkan.
  - `cache.js` menyimpan health snapshot (`ready/connecting/reconnecting/closed/end`, jumlah error, error terakhir, latensi ping) dan melakukan PING periodik 30 detik.
  - `/api/health` tetap 200 saat Redis mati, tetapi menyertakan objek `redis` yang jujur (`available:false`, `lastError`).
  - Log error memakai `code || name || message` agar tidak kosong.
- [x] **Retensi** — `src/jobs/retention.job.js` dijalankan saat boot (+60 detik) dan setiap 6 jam:
  - `audit_logs`: hapus >90 hari, lalu cap 200.000 baris terbaru.
  - `monitor_history`: hapus >7 hari.
  - `update_history.json`: 50 update + 10 backup terbaru.
  - File log rotasi >14 hari dibersihkan; `error.log`/`combined.log` aktif tidak disentuh.
- [x] **AutoHeal opt-in** — hanya unit systemd yang terpasang dan tidak disabled yang diperiksa/di-restart; unit `not_installed`/`disabled` tidak memicu alert.
  - Daftar unit di-cache 60 detik dan endpoint baru `GET /api/autoheal/services` menampilkan service terdeteksi untuk dipilih admin.
  - Notifikasi critical/recovered dan Docker memakai cooldown `cooldownMinutes` agar tidak spam.
  - Jika output systemd tidak bisa diparse (host non-systemd/test), AutoHeal kembali ke perilaku lama (tetap memeriksa) alih-alih mematikan semua monitoring.
- [x] **Test & CI**:
  - `tests/updaterGitScenarios.test.js` memakai repo Git sementara: untracked conflict dikarantina, `npm` gagal → rollback, commit lokal divergen → fetch + hard reset, rollback eksplisit, plus state supervisor (`restarting` tidak diselesaikan bootstrap, state `running` stale → `interrupted`).
  - `tests/retention.test.js`, `tests/cacheRedisHealth.test.js`, dan test opt-in/cooldown AutoHeal ditambahkan.
  - Job CI `smoke-boot` menjalankan server produksi dengan DB terisolasi, mewajibkan `/api/health` 200 dan field `redis` ada; `audit` sekarang menjadi dependency `build-check`.
  - `Dockerfile` menetapkan `PANELKU_UPDATE_SUPERVISOR=false` karena container tidak punya systemd/PM2.

Verifikasi Sprint 1:

- `npm run lint` bersih.
- `npm test`: **92 suite / 1497 test lulus**.
- `node --check scripts/panel-update-worker.mjs` dan `bash -n scripts/panel-update.sh` bersih.
- Smoke test boot produksi lokal: `/api/health` 200, `redis.available=false`, `redis.status=reconnecting` saat Redis tidak tersedia (panel tetap hidup dan terus mencoba reconnect).

Sisa untuk Sprint berikutnya:

- Progress granular per langkah update (saat ini state berisi fase + log akhir; UI belum menerima streaming baris demi baris).
- Update offline dari tarball bertanda tangan dan kanal beta/dev yang lebih ketat.
- Uji supervisor end-to-end di VPS systemd nyata (systemd-run + rollback saat boot gagal) — unit test memakai repo Git sementara, bukan systemd.

---

## 15. Status Implementasi Sprint 2 (Performa & Keamanan) — 2026-10-22

Selesai dan terverifikasi:

- [x] **Performa HTTP/aset** — `compression` dipasang; `src/middleware/assets.js` membuat manifest hash konten saat boot dan menulis `?v=<sha256-12>` ke `src`/`href` aset lokal saat render.
  - Aset dengan hash yang cocok mendapat `Cache-Control: public, max-age=31536000, immutable`; HTML dan URL tanpa versi tetap `no-cache`.
  - Library berat tetap dimuat per halaman (Chart.js hanya di monitor/analytics, xterm hanya di terminal, CodeMirror hanya di file manager), bukan di layout global.
- [x] **Satu jalur monitoring** — halaman monitor memakai namespace Socket.IO `/monitor` sebagai sumber utama dan `/monitor/current` hanya sebagai fallback.
  - Frame WS dianggap stale setelah 15 detik (atau 3× interval), lalu REST dipakai sampai WS pulih; `request:metrics` meminta frame awal.
  - Saat tab disembunyikan, timer polling dan socket diputus; saat tab kembali terlihat, koneksi dan polling dipulihkan. Pilihan `Pause` juga memutus socket.
  - `monitor.service.getCurrent()` mengembalikan payload yang sama untuk WS dan REST (termasuk `uptime`, `disks[]`, `networks[]`), sehingga UI tidak lagi menggabungkan dua bentuk data.
  - Semua panggilan `systeminformation` di monitoring/analytics dibungkus `siCall()` dengan `SI_TIMEOUT_MS` (default 3000 ms) supaya probe yang macet tidak menahan broadcast.
- [x] **Analytics & `/metrics`** — `MonitorHistory.aggregate()` memfilter dan membucket di SQLite (`strftime`), mengembalikan maksimal 500 titik, dan memiliki fallback `find()` bila query gagal.
  - `analytics.service.getMetricsHistory()` memakai agregasi SQL + `bucketSeconds`; timestamp hasil bucket sudah dikembalikan dalam milidetik dengan benar.
  - Snapshot `/metrics` di-cache `PROMETHEUS_CACHE_MS` (default 10.000 ms, `0` = nonaktif); setiap bagian DB/Docker/queue diisolasi agar satu kegagalan tidak menghapus seluruh metrik. Token/loopback auth dari Sprint 0 tetap berlaku.
- [x] **CSP tanpa handler inline** — `script-src-attr 'none'`.
  - Handler statis di HTML hasil render diubah menjadi `data-lp-handler` + satu `<script nonce>` per halaman (`src/middleware/cspHandlers.js`).
  - Template dinamis memakai `data-lp-on-<event>` dan `LP.registerInlineHandler()`; fungsi disimpan di memori dan dipanggil lewat delegated listener, tidak pernah `eval`.
  - `script-src` tetap berbasis nonce dan tidak memakai `unsafe-inline`; `style-src-attr` sengaja masih `unsafe-inline` karena xterm/CodeMirror menyuntikkan style saat runtime.
- [x] **systemd/polkit/sudoers (opt-in)** — `PANELKU_HARDENED=1` membuat user `panelku`, mengatur kepemilikan storage/repo, memasang `deploy/panelku.sudoers`, dan memakai `ProtectSystem=strict` + `ReadWritePaths`.
  - `PANELKU_NNP=1` menambahkan `NoNewPrivileges=true`; karena ini mematikan eskalasi sudo, fitur package/service/firewall berbasis sudo tidak akan bekerja. Trade-off ini didokumentasikan.
  - Template unit, sudoers, dan aturan polkit tersedia di `deploy/`; instalasi default tetap `root` agar tidak memutus fitur yang sudah ada.
- [x] **Docker & dependensi** — app Docker memakai `TECNATIVA docker-socket-proxy` lewat `DOCKER_HOST`; socket mentah tidak lagi di-mount ke container. `docker.service` memahami `unix://`, `npipe://`, `tcp://`, `http://`, dan `https://`.
  - `multer` 2.x, `compression`, dan `@whiskeysockets/baileys` dipin ke `7.0.0-rc13`; image sudah Node 22.
- [x] **Higiene repo** — `.gitattributes`, `.dockerignore`, `.gitignore`, file debug dihapus, versi `3.7.0` disinkronkan di `package.json`, lockfile, README, dan CHANGELOG.

Verifikasi Sprint 2:

- `npm run lint` bersih.
- `npm run test:csp` lulus; halaman terautentikasi tidak mengandung atribut `on*=` statis dan memuat `data-lp-handler`.
- `tests/withTimeout.test.js`, `tests/panelkuCli.test.js`, `tests/assets.test.js`, `tests/cspHandlers.test.js`, test agregasi MonitorHistory, dan test cache Prometheus ditambahkan.
- Full suite dijalankan ulang setelah perubahan terakhir (hasil dicatat pada bagian 17).

---

## 16. Status Sprint 3 (Pengembangan) — v3.7.0 "Operations"

Sprint 3 adalah roadmap 4–8 minggu. Implementasi yang masuk rilis `3.7.0`:

- [x] **Operations CLI** (`bin/panelku.js`, entry `package.json`, symlink installer):
  - `status`, `doctor`, `check-update`, `rollback`, `reset-password`, `version`.
  - `doctor` memeriksa Node, `.env`/`JWT_SECRET`/`JWT_REFRESH_SECRET`/`APP_SECRET`, storage, SQLite, Docker, Redis, systemd, dan ruang disk; mendukung `--json`.
  - `reset-password` memakai bcrypt, mengosongkan sesi, dan memaksa ganti password saat login.
  - `rollback` hanya berjalan dengan `--commit`/`--backup` **dan** `--yes`.
- [x] **Updater v2 & jalur konfigurasi terpusat** — job background + status, supervisor detached, rollback terverifikasi, retensi, health Redis jujur, dan `PANELKU_HOME`/`DB_PATH` (Sprint 0–1, kini menjadi bagian rilis Operations).
- [x] **Sebagian item v3.8.0 ditarik maju** — CSP ketat, Docker socket proxy, opsi non-root/polkit, `multer` 2, `baileys` pinned, dan Node 22 sudah tersedia lebih awal. Ini mengurangi risiko rilis Hardening berikutnya.

Belum dikerjakan (sisa roadmap, sengaja tidak dipaksakan dalam satu sprint):

- Update offline dari tarball bertanda tangan; progres SSE baris-per-baris (saat ini fase + log akhir).
- Uji end-to-end supervisor di VPS systemd nyata, termasuk rollback saat boot gagal.
- Mode non-root penuh tanpa sudo luas: helper privileged terpisah atau polkit allowlist untuk semua aksi sistem; `NoNewPrivileges` default.
- API key ber-scope, 2FA wajib untuk admin, rate limit per user, audit export, SBOM + signed image.
- PostgreSQL/MySQL untuk metadata, sandbox plugin + marketplace bertanda tangan, OpenTelemetry/tracing, fleet drift detection.
- Backup/DR: verifikasi restore otomatis, enkripsi, retention policy; i18n ID/EN, a11y, dan E2E Playwright.
- CI matrix Ubuntu 22/24 × Node 20/22, coverage gate modul kritikal, CodeQL, dan runbook insiden.

Catatan rilis: `v3.6.1` tidak dirilis terpisah; seluruh perbaikan hotfix masuk ke `3.7.0` bersama fitur Operations.

---

## 17. Verifikasi Akhir Sprint 2–3

- `npm run lint`: bersih.
- `npm test`: **96 suite / 1510 test lulus** (Jest, Node 22).
- `npm audit --omit=dev`: **0 vulnerabilities**.
- `bash -n scripts/install.sh`: bersih (Git Bash).
- Smoke test produksi lokal (port 24681, DB/storage sementara, secret acak):
  - `/api/health` → **200**
  - `/metrics` dari loopback → **200**
  - `/api-docs/spec.json` → **404** (docs dimatikan di produksi)
  - `/api/updater/status` tanpa token → **401**
  - `/metrics` dari peer non-loopback dengan `X-Forwarded-For: 127.0.0.1` → **401** (spoofing loopback ditolak)
  - `/js/app.js` tanpa versi → `Cache-Control: no-cache`; dengan `?v=<hash>` → `immutable` (diverifikasi smoke test dan unit test `tests/assets.test.js`).
- `node bin/panelku.js doctor --json` berjalan dan melaporkan secret placeholder, Docker/Redis/systemd yang tidak tersedia sebagai kegagalan/peringatan yang jujur.

Langkah rilis berikutnya: review perubahan, jalankan ulang verifikasi pada VPS systemd nyata (terutama `PANELKU_HARDENED=1` dan Docker proxy), lalu commit/tag `3.7.0`.

