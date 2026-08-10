# 📋 Analisis Proyek — Panelku (Linux Server Control Panel)

> **Versi dokumen**: 1.0 · **Tanggal**: 10 Agustus 2026
> **Proyek**: `homeserver` — berisi `linux-panel/` (aplikasi panel) + `panelku-landing/` (halaman promosi + installer)
> **Basis**: analisis kode sumber langsung, dokumen `prompt.md`, `rencana.md`, `audit.md`, `docs/coverage-baseline.md`

---

## 1. Ringkasan Eksekutif

**Panelku** adalah *Linux Server Control Panel* ringan, modern, modular, dan realtime — perpaduan konsep aaPanel, Plesk, CyberPanel, CasaOS, Portainer, dan Cockpit, namun jauh lebih ringan (target RAM 512 MB, 1 core). Aplikasi dibangun dengan **Node.js + Express + SQLite + Socket.IO**, frontend **Bootstrap 5 + jQuery + EJS server-rendered** tanpa framework frontend berat, sesuai spesifikasi awal di `prompt.md`.

### Fakta cepat

| Metrik | Nilai |
|---|---|
| Versi | **2.0.0** (rilis 28 Juli 2026) |
| Backend | Node.js ≥ 20 (ESM, `"type": "module"`) |
| Modul fitur (`src/modules`) | **40** |
| Endpoint REST terdaftar | **±463** (`router.get/post/put/patch/delete`) |
| Plugin bawaan | **17** (18 direktori termasuk `shared/`) |
| Tampilan EJS | 49 view (≈11.700 baris) |
| LOC backend (`src/*.js`) | ≈47.900 baris |
| LOC frontend (`public/js`) | ≈15.700 baris |
| File test | **16 suite / 279 test** (sebelumnya 8 suite) |
| Workflow CI/CD | 3 (CI, Docker Publish, Security Scan) |
| Lisensi | MIT |

### Status pengerjaan (dari `rencana.md`)

- ✅ **Phase 1–7** (v1.5.0 → v1.9.0): seluruh fitur dasar + enterprise utama selesai
- ✅ **Phase 23–24** (v2.0.0): Password Policy Engine + Split-View File Manager + CSP hardening
- 🚧 **Roadmap v3.0**: profesionalisasi engineering (testing, keamanan lanjutan, performa) — masih banyak item **belum** dikerjakan (lihat §9)

---

## 2. Struktur Repositori

```
homeserver/
├── prompt.md              # Spesifikasi awal (prompt pembangunan bertahap)
├── rencana.md             # Roadmap v3.0 & metrik keberhasilan
├── audit.md               # Ringkasan hasil audit keamanan sebelumnya (25 isu; 3 kritis)
├── analisis-proyek.md     # Dokumen ini
├── linux-panel/           # Aplikasi utama
│   ├── src/
│   │   ├── app.js         # Express factory (middleware stack, CSP, route mount)
│   │   ├── server.js      # Entry HTTP + graceful shutdown handler
│   │   ├── bootstrap.js   # SQLite, Redis, Socket.IO, jobs, WAF cache, plugins
│   │   ├── config/        # app, constants, database, logger, redis, socket, swagger
│   │   ├── core/          # db (SQLite), events (EventBus), permissions (RBAC),
│   │   │                  # plugin-loader (SDK), scheduler
│   │   ├── middleware/    # auth, rbac, waf, rateLimiter, nonce, errorHandler, ...
│   │   ├── modules/       # 40 modul fitur (controller/routes/service per modul)
│   │   ├── models/        # 11 model (Mongoose-style wrapper atas SQLite)
│   │   ├── repositories/  # 5 repository (data access layer)
│   │   ├── helpers/       # response, crypto, system (execFile), validate, security-advisor
│   │   ├── jobs/          # monitor, health, backup, password-expiry
│   │   ├── websocket/     # Socket.IO namespaces + agent-terminal WS
│   │   ├── public/        # CSS/JS statis (per-modul singleton JS)
│   │   └── views/         # 49 halaman EJS
│   ├── plugins/           # 17 plugin + shared/ (dep-installer, rclone-helper)
│   ├── tests/             # 8 suite test
│   ├── scripts/           # install.sh (multi-distro), reset-db, check-window-assignment
│   ├── docs/              # coverage-baseline.md (hampir kosong selain itu)
│   ├── .github/workflows/ # ci.yml, docker-publish.yml, security-scan.yml
│   ├── Dockerfile · docker-compose.yml · ecosystem.config.cjs
│   └── package.json
└── panelku-landing/       # Landing page statis + install.sh one-click
```

---

## 3. Tech Stack

| Lapisan | Teknologi |
|---|---|
| Runtime | Node.js ≥ 20 (ESM murni) |
| Web framework | Express 4 + `express-ejs-layouts` |
| Database utama | **SQLite** via `better-sqlite3` (WAL, foreign keys ON) |
| Cache/queue opsional | Redis via `ioredis` (gagal konek → panel tetap jalan) |
| Realtime | Socket.IO 4 + `ws` (agent terminal) |
| Auth | `jsonwebtoken` (access 30d + refresh), `speakeasy`+`qrcode` (TOTP 2FA), `bcryptjs`, `ldapjs` (LDAP/SSO) |
| Proses/PTY | `node-pty`, `systeminformation`, `dockerode`, `mysql2`, `pg` |
| Notifikasi | `nodemailer` (SMTP), `@whiskeysockets/baileys` (WhatsApp), webhook/Telegram/Discord |
| Job queue | `bullmq` (terpasang, **belum dipakai** — memakai `setInterval` via `Scheduler.js`) |
| Frontend | Bootstrap 5, jQuery, Chart.js, xterm.js, CodeMirror, DataTables, jsTree (semua **self-hosted**, tanpa CDN) |
| Security | `helmet` (CSP nonce), `express-rate-limit`, WAF middleware custom, `cors` ketat |
| Testing | Jest + supertest (native ESM, `unstable_mockModule`) |
| Lint | ESLint 9 flat config + rule custom `require-window-export` |

---

## 4. Arsitektur & Pola Desain

### 4.1 Alur hidup aplikasi

```
src/server.js
  └─ createApp() (src/app.js)
       trust proxy=1 → EJS layout → nonceMiddleware → helmet(CSP) → cors →
       json/urlencoded (10mb) → cookieParser → morgan → requestLogger(audit) →
       static → apiLimiter → wafMiddleware → /api routes → locals plugins →
       nonceInjector → page routes → pluginLoader proxy+router → 404 → errorHandler
  └─ bootstrap() (src/bootstrap.js)
       getDb() (SQLite auto-schema) → Redis (opsional) → seed roles+admin →
       Socket.IO + 4 namespace → agent WS upgrade → 4 background jobs →
       refreshWafCache → pluginLoader.loadAll()
```

### 4.2 Pola per modul (konsisten di 40 modul)

Setiap modul mengikuti konvensi ketat `service / controller / routes` + view EJS + JS singleton:

```
src/modules/<nama>/
  ├── <nama>.controller.js   # handler, validasi ringan, memakai helper success/error
  ├── <nama>.routes.js       # registrasi route + requireAuth + requirePermission('res:action')
  └── <nama>.service.js      # logika bisnis & eksekusi sistem
src/views/<nama>/index.ejs   # tampilan
src/public/js/<nama>.js      # singleton `const X = {...}; window.X = X;` (dipaksa rule ESLint)
```

**Kekuatan pola ini**: mudah diprediksi, mudah ditambah modul baru, dan didukung alat pemaksa (`eslint-rules/require-window-export.js` + `scripts/check-window-assignment.js`) sehingga error `xxx.yyy is not a function` (variabel `const` tidak ter-expose ke `window`) terdeteksi otomatis di CI.

### 4.3 Core subsystems

| Komponen | Peran | Catatan |
|---|---|---|
| `core/db/sqlite.js` | Singleton DB + skema lengkap + migrasi idempoten (`ALTER TABLE ... catch duplicate column`) | 14 tabel; path DB lazy agar bisa di-override saat test |
| `core/events/EventBus.js` | Pub/sub internal (12 event well-known, mis. `user.logged_in`, `backup.complete`) | Async wrapper, error tidak menggagalkan emitter |
| `core/permissions/PermissionManager.js` | Cache RBAC `roleId → Set(resource:action)` + bypass super_admin | Invalidasi per-role dan global |
| `core/plugin-loader/PluginLoader.js` | SDK plugin: scan `plugins/`, muat yang ter-install, hot-mount route via Proxy, reverse proxy dengan **anti-SSRF** | Lihat §6 |
| `core/scheduler/Scheduler.js` | Job registry berbasis `setInterval` | BullMQ tersedia tapi belum diadopsi |

### 4.4 Penyimpanan

- **SQLite** (`storage/panelku.db`) menjadi penyimpanan utama: `users`, `roles`, `sessions`, `websites`, `settings`, `audit_logs`, `alert_configs`, `monitor_history`, `waf_rules`, `notifications`, `whatsapp_sessions`, `cluster_nodes`.
- **MySQL/PostgreSQL/SQLite eksternal** dikelola dinamis lewat modul database (`mysql2`, `pg`, `better-sqlite3`) — credential disimpan di tabel `settings` (JSON).
- **Redis** opsional: hanya dipakai sebagai cache/queue; `bootstrap` menangani kegagalan koneksi dengan *graceful fallback*.

---

## 5. Fitur Utama (40 Modul)

| Kelompok | Modul |
|---|---|
| **Inti** | auth (+LDAP/SSO/2FA), users, roles, dashboard, settings (profil/audit/tema/password-policy) |
| **Monitoring** | monitor, analytics, alerts, autoheal, cluster, gpu, power |
| **Container** | docker, caddy, websites (reverse proxy + PHP per-domain) |
| **Database** | database (explorer multi-engine + query console), mongodb, redis, apache |
| **Runtime** | nodejs (nvm), python (pyenv), php, whatsapp |
| **Keamanan** | firewall, waf, ssl, dns, cloudflare, ai-repair (auto-fix), security-advisor |
| **Operasional** | filemanager, terminal, backup, cron, system, updater, mail, cdn, iot, ai |
| **Cluster** | agent (X-API-Key), cluster (multi-node master/agent) |

**Highlight fitur**:
- **Database Explorer 5-tab** (Browse/Structure/Query/Export/History) untuk MySQL, PostgreSQL, SQLite — dengan **dropdown schema PostgreSQL** dan import/export JSON/CSV/SQL (lihat §8 — hasil kerja sesi ini).
- **Terminal web** xterm.js + node-pty multi-tab + audit perintah + saran AI auto-repair.
- **Auto-Healer / watchdog** yang me-restart service mati secara mandiri.
- **Auto-Updater + rollback** otomatis jika health-check gagal 30 detik setelah update.
- **Cluster multi-node**: panel master ↔ agent node via API terenkripsi + WebSocket terminal jarak jauh.
- **Password Policy Engine**: kompleksitas, kedaluwarsa (90 hari), paksa ganti password saat login, histori kebijakan.

---

## 6. Plugin SDK & Ekosistem Plugin

### Cara kerja

1. Direktori `plugins/<id>/` berisi `plugin.json` (manifest: name, version, entry, path, icon) + `index.js` (default export `{ register(app, io) }`).
2. `PluginLoader` hanya memuat plugin yang terdaftar di setting DB `installed_plugins` (tidak semua folder otomatis aktif).
3. `register(app, io)` menerima **Proxy app** — setiap panggilan `app.get/post/...` di dalam plugin diarahkan ke router bersama (`pluginLoader.router`), sehingga route plugin *hot-mounted* tanpa restart.
4. Plugin dapat di-*reverse proxy* ke URL eksternal melalui `setProxy()` dengan **validasi anti-SSRF**:
   - Hanya protokol `http/https`
   - Blokir `localhost`, IP privat (10/8, 172.16/12, 192.168/16), CGNAT, dan metadata cloud `169.254.169.254`
   - Pengecualian hanya via `trustPlugin(id)` eksplisit (untuk layanan internal/Docker)

### 17 plugin bawaan

`adguard-manager`, `db-admin-manager` (phpMyAdmin/pgAdmin/Adminer), `fail2ban-manager`, `git-deployer` (webhook auto-deploy), `home-assistant-manager`, `log-analyzer-manager`, `lvm-manager`, `media-cloud-manager` (Jellyfin/qBittorrent), `minio-manager`, `nextcloud-manager`, `openclaw-manager` (AI copilot), `php-manager`, `pm2-manager`, `rclone-backuper`, `rclone-manager`, `uptime-kuma-manager`, `wireguard-manager`.

**Catatan**: jumlah plugin di `rencana.md` (16) kini menjadi 17 — daftar perlu disinkronkan.

---

## 7. Keamanan (Defense in Depth)

### 7.1 Lapisan yang ada

| Lapisan | Implementasi |
|---|---|
| **Header** | Helmet: CSP nonce-based (`scriptSrc` nonce, `style-src unsafe-inline` karena lib client), `frame-ancestors 'self'`, `formAction/baseUri 'self'`, Permissions-Policy (kamera/mic/geo diblokir) |
| **WAF** | Middleware aplikasi: deteksi SQLi (`UNION SELECT`, `OR 1=`, dsb.), 11 pola XSS, directory traversal; blacklist/whitelist IP dari tabel `waf_rules` (cache) |
| **Rate limit** | 7 limiter terpisah: API umum, auth (key `IP:username`), upload, API-key, download-token, 2FA (5/15mnt), webhook (10/mnt) |
| **Auth** | JWT Bearer **tanpa cookie** (anti-CSRF), refresh token di tabel `sessions` (revocable), API key, 2FA TOTP, LDAP/SSO |
| **RBAC** | 4 role sistem + permission dinamis `resource:action` (read/create/update/delete/execute) dengan cache |
| **Validasi input** | Whitelist regex identifier SQL (`_sanitizeDbName/_sanitizeTableName/_sanitizeSchemaName/_sanitizeColumnName`), validasi port/package di plugin, pemblokiran ekstensi upload (18 tipe) |
| **Eksekusi perintah** | Helper `execFile` (args array, anti shell injection) di `helpers/system.js` — hasil perbaikan CRIT-1 |
| **Secret** | Fail-fast di production bila `JWT_SECRET`/`JWT_REFRESH_SECRET`/`APP_SECRET` masih nilai default |
| **Plugin proxy** | Anti-SSRF (lihat §6) |
| **CI** | npm audit, CodeQL, Trivy, truffleHog, Docker Scout |

### 7.2 Temuan audit sebelumnya (`audit.md`) — status

Audit lama menemukan **25 isu (3 kritis)**: CRIT-1 shell injection (sudah diperbaiki via execFile), CRIT-2 Zip Slip (sudah diperbaiki), CRIT-3 MIME spoofing upload (difilter 18 ekstensi), HIGH-4 mismatch direktori install (`/opt/linux-panel` vs `/opt/panelku` — sudah diperbaiki di v1.8.0). README v2.0.0 mengonfirmasi semua perbaikan keamanan v1.8.0 sudah rilis.

### 7.3 Perbaikan sesi ini (WAF & Database — lihat §8)

---

## 8. Perubahan & Perbaikan Terkini (Sesi Ini)

Rangkaian kerja pada modul database & WAF yang telah selesai dan terverifikasi:

| # | Perubahan | File | Status |
|---|---|---|---|
| 1 | **Fix false-positive WAF** pada import SQL — `'Forbidden: Suspected SQL Injection'` saat menjalankan query/import di `/database`. Endpoint `explore` & `import/*` masuk `SKIP_BODY_SCAN_PATHS` (body scan dilewati; proteksi tetap di layer service) | `src/middleware/waf.middleware.js` | ✅ |
| 2 | **Route `/api/database/import/csv`** didaftarkan (frontend memanggilnya tetapi route tidak ada) | `src/modules/database/database.routes.js` | ✅ |
| 3 | **Hardening `runQuery`** — `DROP/TRUNCATE/ALTER` diblokir walau tidak di awal query: scanner quote-aware yang melewati komentar (`--`, `#` khusus MySQL, `/* */`, `/*! */` versi MySQL), string `' " \``, dollar-quoting PostgreSQL, dan multi-statement (`;`) | `src/modules/database/database.service.js` | ✅ |
| 4 | **Perluasan `SKIP_BODY_SCAN_PATHS`** untuk endpoint konten arbitrer: `/api/mongodb/query`, `/api/git-deploy/webhook` (publik), `/api/plugins/git-deploy`, `/plugins/db-admin-manager` + `/api/plugins/db-admin-manager` (phpMyAdmin/pgAdmin proxy), `/api/whatsapp/accounts`, `/api/ai-repair` | `src/middleware/waf.middleware.js` | ✅ |
| 5 | **Dropdown schema PostgreSQL** di explorer — endpoint `/api/database/schemas` + UI `#explorerSchemaSelect`; daftar tabel/struktur/data/browse mengikuti schema terpilih | `database.service.js`, `database.js`, `index.ejs` | ✅ |
| 6 | **Import SQL/CSV mengikuti schema aktif** — PostgreSQL memakai `SET search_path TO "<schema>"` (SQL) dan tabel-ref `"schema"."table"` (CSV) | `database.service.js` | ✅ |
| 7 | **Judul explorer** menampilkan schema: `Explorer: testdb (POSTGRES) — schema: analytics` | `src/public/js/database.js` | ✅ |
| 8 | **Badge schema** di header panel Browse di samping nama tabel | `index.ejs`, `database.js` | ✅ |

**Validasi**: ESLint bersih, 79+ test CSP lulus (render halaman `/database`), dan **verifikasi browser end-to-end** (dropdown menampilkan `analytics, inventory, public`; filter tabel `users`/`events`/`products`; browse data; import SQL & CSV masuk schema benar; tidak ada console error).

---

### 8.1 Audit R3 — Keamanan Eksekusi Perintah (tuntas)

Audit menyeluruh atas **seluruh titik eksekusi perintah** (`29 file src/` + `9 plugin` dipindai) menemukan **16 temuan** (2 kritis, 8 sedang, 6 rendah) — **semuanya telah diselesaikan** dan di-commit (`810ad94`, `6c9b3cd`):

| Grup | Temuan | Aksi | Status |
|---|---|---|---|
| **P0 (2)** | R3-H1 `gitRepo` injectable di clone; R3-H2 `projectName` interpolasi `docker compose -p` | `_validateGitRepo` + `execFile` args array (websites); regex `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` di controller + service (docker) + fix argumen `errorResponse` tertukar | ✅ |
| **P1 (8)** | R3-M1..M8: ai-repair, nodejs (pm2), mail, gpu, analytics, caddy, pm2-manager | `_validateFixContext` (ai-repair); pm2 → `execFile` args array; `validateAppName` (pm2-manager); M4–M7 **terbukti aman** (whitelist/konstanta/ternary boolean) | ✅ |
| **P2 (6)** | R3-L1..L6: fail2ban, git-deployer, backup, php, caddy, power | `validateJailName` `^[a-zA-Z0-9_-]+$` (fail2ban); `hook.script` = **trusted admin input** (dokumentasi); `validateRestoreTarget` boundary `path.relative` — menutup escape `/var/www2` (backup); L4–L6 terverifikasi aman | ✅ |

**Perbaikan pendukung & guard permanen:**

- **6 import plugin rusak** diperbaiki (`../../middleware|models` → `../../src/...`) di `git-deployer`, `pm2-manager`, `rclone-backuper` — beberapa di antaranya sudah memblokir plugin saat load
- **`scripts/check-plugin-imports.mjs`** — scanner import plugin (komentar-safe, multiline-safe, fallback ekstensi/index) → npm script `check:plugin-imports` + step **blocker** di `ci.yml` & `docker-publish.yml` + regression test `tests/pluginImports.test.js`
- **Gate kualitas R1**: `coverageThreshold` global terpasang & dinaikkan (statements 12 / branches 6 / functions 10 / lines 12), `npm audit` kini **blocker** di CI, 5 dependensi high-severity di-patch
- **+91 regression test** (termasuk payload injeksi `'; rm -rf / #'`) → **16 suite / 279 test**, coverage gate hijau
- **`CONTRIBUTING.md` + `PULL_REQUEST_TEMPLATE.md`** — aturan audit R3 (execFile+args/hardcoded, validasi input user, test payload injeksi, cek import plugin) menjadi checklist wajib PR

---

## 9. Temuan, Risiko & Rekomendasi

### 🟢 Kekuatan

1. **Keamanan berlapis** yang matang (CSP nonce, WAF, RBAC dinamis, 7 rate limiter, anti-SSRF, anti-injection) — di atas rata-rata panel sejenis.
2. **Konvensi modul ketat + alat pemaksa** (ESLint custom + window-check) → kode mudah diprediksi dan kesalahan kelas frontend terdeteksi dini.
3. **Self-initializing database** — tanpa langkah migrasi manual; migrasi kolom idempoten.
4. **Plugin SDK dengan keamanan bawaan** (manifest validation, hot-mount, anti-SSRF).
5. **CI/CD lengkap** — lint `--max-warnings 0`, window-check, CSP gate, CodeQL, Trivy, truffleHog, Docker Scout, publish multi-registry.

### 🟠 Risiko / Kelemahan

| # | Temuan | Tingkat | Rekomendasi |
|---|---|---|---|
| R1 | **Coverage test sangat rendah** — baseline 31 Jul 2026: 11.21% statement backend, 113 file 0% (termasuk 32 controller & 4 jobs & 6 websocket). 🚧 **Progres sesi ini**: 16 suite / 279 test, aktual 14.21% statement — **gate `coverageThreshold` sudah terpasang** (12/6/10/12%), namun masih jauh dari target 60% | Tinggi | Lanjut Phase 8 rencana.md: integration test supertest per modul kritis (auth/users/database/docker/backup/websites/waf) |
| R2 | ~~CI belum meng-gate coverage~~ — ✅ **Selesai sesi ini**: `coverageThreshold` di jest config + `npm audit --audit-level=high` sebagai **blocker** di `ci.yml`/`docker-publish.yml`; 5 deps high di-patch | ~~Tinggi~~ ✅ | Naikkan threshold bertahap menuju 60% (rencana.md 8.1) |
| R3 | **File raksasa** — `system.service.js` (850), `database.service.js` (1070), `caddy.service.js` (1003), `backup.service.js` (832), `updater.service.js` (765) | Sedang | Pecah per sub-domain (rencana.md 8.4) |
| R4 | **BullMQ terpasang tapi tidak dipakai** — job berat (backup, deploy, SSL) berjalan sinkron di request/setInterval | Sedang | Migrasi bertahap ke BullMQ + UI progress (rencana.md 10.2) |
| R5 | **Swagger dobel** — `swagger.js` (1497) + `swagger.fixed.js` (1305) | Rendah | Satukan, hilangkan duplikasi, generate `docs/openapi.json` |
| R6 | ~~`exec` string interpolasi masih ada di sebagian titik~~ — ✅ **Selesai sesi ini**: audit penuh `src/` + `plugins/` (rencana.md 9.1) jalan — 16 temuan R3 (R3-H1..L6) tuntas; seluruh titik baru memakai `execFile` + args array atau string hardcoded; sisa `exec` statis di `savePgConfigFile` terdokumentasi aman | ~~Sedang~~ ✅ | Pertahankan aturan (CONTRIBUTING.md §Keamanan): setiap exec baru wajib `execFile`+args atau hardcoded |
| R7 | **CSP masih memakai `'unsafe-inline'`** untuk `style-src`, `style-src-attr`, `script-src-attr` (126+ inline handler) | Rendah | Diterima secara desain (dikomentari baik di `app.js`); evaluasi bertahap |
| R8 | **Frontend tanpa test sama sekali** (61 file, 0%) | Rendah | Pisahkan dari hitungan coverage backend; pertimbangkan jsdom smoke test |
| R9 | **Dokumentasi `docs/` hampir kosong** (hanya coverage-baseline) | Rendah | Isi arsitektur, panduan instalasi, plugin SDK, FAQ (rencana.md 8.5) |
| R10 | **Credential default** `admin/Admin@123456` | Sedang | Sudah dimitigasi `mustChangePassword=true` saat seed; pastikan pesan warning tetap jelas |
| R11 | `audit.md` merujuk `audit_report.md` di path eksternal (brain IDE) yang tidak ada di repo | Rendah | Salin laporan lengkap ke `docs/security/` |

### 📋 Rekomendasi prioritas (urut)

1. **P0** — Pasang coverage gate CI + tambah integration test untuk modul kritis (database, docker, backup, websites, auth).
2. **P0** — Audit penuh eksekusi perintah (`src/` + `plugins/`) menuju 100% `execFile` (rencana.md 9.1).
3. **P1** — Migrasi job berat ke BullMQ + status UI (rencana.md 10.2).
4. **P1** — Refactor file service raksasa & satukan Swagger.
5. **P1** — Lengkapi `docs/` dan sinkronkan angka di `rencana.md` (plugin 17, test 8 suite).

---

## 10. Kesimpulan

**Panelku adalah proyek yang sangat ambisius dan sudah sangat matang secara fitur** — 40 modul, ±463 endpoint, 17 plugin, keamanan berlapis, dan CI/CD profesional dalam satu codebase ~75 ribu baris (backend+frontend+views). Fondasi arsitektur (modul terisolasi, repository pattern, event bus, plugin SDK, RBAC dinamis) sudah sesuai dengan spesifikasi awal di `prompt.md`.

**Tantangan utama ke depan bukan fitur, melainkan kualitas engineering**: coverage test (11% → target 60%), adopsi BullMQ untuk tugas berat, audit keamanan menyeluruh atas eksekusi perintah, dan refactor file raksasa — semuanya sudah tertuang rapi di roadmap v3.0 (`rencana.md`). Sesi kerja terbaru (WAF + database explorer multi-schema + import per-schema) menunjukkan arah yang tepat: *memperbaiki kebenaran dan keamanan fitur yang ada* sambil menjaga kualitas dengan validasi lint/test/browser.
