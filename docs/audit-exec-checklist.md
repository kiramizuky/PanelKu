# 🛡️ Checklist Audit Eksekusi Perintah (R3) — Panelku v2.0.0

> **Tanggal audit**: 10 Agustus 2026
> **Cakupan**: seluruh panggilan `exec` / `execFile` / `spawn` / `execSync` / `spawnSync` / `fork` di `src/` dan `plugins/`
> **Metode**: grep regex `exec(Async|Sync)?\(|execFile(Sync)?\(|spawn(Sync)?\(|\bfork\(` + inspeksi manual konteks interpolasi & validasi
> **Status**: ✅ Checklist tersedia — **P0, P1 & P2 SELESAI (10 Agu 2026)** — seluruh 16 temuan (2🔴 + 8🟠 + 6🟡) tertangani

---

## 1. Ringkasan Eksekutif

| Metrik | Nilai |
|---|---|
| File dengan panggilan eksekusi (`src/` non-vendor) | **29 file** |
| File dengan panggilan eksekusi (`plugins/`) | **9 file** |
| Total panggilan di `src/` | **±388** (≈350 nyata; sisanya false positive `db.exec`/`chain.exec`/`pipeline.exec`) |
| Total panggilan di `plugins/` | **28** |
| Pola aman dominan (`execFile` + args array) | ✅ Sudah diterapkan di modul inti (firewall, iot, mongodb, gpu, system) |
| **Temuan risiko tinggi (perlu perbaikan)** | **2** 🔴 — **R3-H1 ✅ · R3-H2 ✅ (10 Agu 2026)** |
| **Temuan risiko sedang** | **8** 🟠 — **R3-M1..M8 ✅ tertangani** (M1–M3, M8 diperbaiki; M4–M7 terbukti sudah tervalidasi di kode) |
| **Temuan risiko rendah (perlu verifikasi)** | **6** 🟡 — **R3-L1 ✅ diperbaiki · R3-L2 ✅ didokumentasikan · R3-L3 ✅ diperkuat · R3-L4..L6 ✅ terbukti aman** |

### Temuan paling kritis

| # | Lokasi | Risiko | Masalah |
|---|---|---|---|
| **R3-H1** | `websites.service.js:240` | 🔴 **Tinggi** | `execAsync(\`git clone ${website.gitRepo} .\`)` — `gitRepo` diinterpolasi **tanpa validasi** (hanya `_validateRootDirectory` yang divalidasi, `gitRepo` tidak) → **command injection** |
| **R3-H2** | `docker.service.js:264-269` | 🔴 **Tinggi** | `execAsync(\`docker compose -p ${projectName} ...\`)` — `projectName` dari `req.body` hanya dicek truthy, tanpa regex → **command injection** (jalur route controller langsung; plugin aman karena memakai `_validatePkg`) |

---

## 2. Baseline Pola Aman (sudah ada — jadikan standar)

Modul-modul berikut **sudah** memakai pola aman dan menjadi *reference implementation*:

| Pola | Contoh | File |
|---|---|---|
| `execFile` + args array (tanpa shell) | `this._execFile('sudo', ['systemctl', action, serviceName])` | `system.service.js` (`_execFile`) |
| `_execShell` **hanya untuk string hardcoded** (dokumentasi: "NEVER user input") | `curl -fsSL https://tailscale.com/install.sh \| sh` | `system.service.js` |
| `execFile` + args + validasi whitelist | `_validatePort/_validateProtocol/_validateAction` | `firewall.service.js` |
| Validator regex sebelum interpolasi | `validateName()`, `validatePipPackage()`, `validatePythonVersion()` | `python.service.js` |
| Validator regex inline | `/^[a-zA-Z0-9_]+$/` untuk module name | `apache.service.js:357` |
| Whitelist nilai | `validGovernors`, `validProfiles` | `power.service.js` |
| `parseInt` + batas | `safeLines = Math.min(Math.max(parseInt(lines)\|\|100,10),500)` | `nodejs.service.js`, `analytics.service.js` |
| Escape sebelum interpolasi | `password.replace(/'/g, "'\\''")` | `mail.service.js:137` |
| `execFile('mongosh', args)` via `_buildArgs` | args array dibangun terstruktur | `mongodb.service.js` |

> **Aturan baku yang harus diikuti semua modul baru** (dari `system.service.js`):
> 1. Operasi sistem → `execFile(bin, args[])` — tanpa shell.
> 2. Bila shell diperlukan (pipe/redirect) → `exec` **hanya dengan string hardcoded**, tidak pernah dengan input user.
> 3. Semua input user yang tetap harus masuk command → **validasi regex whitelist** dulu, atau `parseInt`/whitelist nilai.

---

## 3. Temuan Per File

### 🔴 R3-H1 — `src/modules/websites/websites.service.js` — ✅ **DIPERBAIKI (10 Agu 2026)**

- **Lokasi**: `deployGit()` — `execAsync(\`git clone ${website.gitRepo} .\`)`
- **Masalah lama**: `website.gitRepo` diinterpolasi **tanpa validasi** → command injection.
- **Perbaikan**:
  1. **`_validateGitRepo(repo)`** — metode baru: hanya URL-safe chars (`^[a-zA-Z0-9._:@%/+~#-]+$`), wajib skema dikenal (`https?://`, `git://`, `ssh://`, `git@`, `file://`, plus scp-style `user@host:path` untuk deploy key username non-`git`), panjang ≤ 512, string kosong = hapus repo. Strict by design: URL query-string/IPv6 ditolak (fail-closed).
  2. Dipanggil di **`updateWebsite`** (write point — hanya saat field diubah) dan **`deployGit`** (execution point — pertahanan berlapis bahkan untuk nilai lama yang tersimpan).
  3. `git clone` dikonversi ke **`execFileAsync('git', ['clone', safeGitRepo, '.'])`** — tanpa shell, injeksi mustahil walau validasi lolos.
- **Regression test**: `tests/websites.test.js` — 31 test (URL valid diterima termasuk scp-style; semicolon/`$()`/backtick/pipe/`&&`/quote/`'; rm -rf / #'`/newline/whitespace/query-string/protocol-relative/IPv6/panjang ditolak; `deployGit`/`updateWebsite` memblokir payload sebelum eksekusi). ✅ 13 suite / 269 test lulus + lint hijau.

### 🔴 R3-H2 — `src/modules/docker/docker.service.js` — ✅ **DIPERBAIKI (10 Agu 2026)**

- **Lokasi**: `deployCompose()` line 264/269: `execAsync(\`docker compose -p ${projectName} -f "${composePath}" up -d\`)`
- **Masalah lama**: `projectName` dari `req.body` hanya dicek truthy — bisa berisi `;`/`$()` → **command injection**, plus dipakai sebagai nama direktori compose (`path.resolve('storage','docker-compose', projectName)`) → **path traversal**. Plugin (db-admin-manager, dll) aman karena memakai `_validatePkg`.
- **Perbaikan**:
  1. **`validateProjectName()`** diekspor dari `docker.service.js` (regex `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`, harus string, ≤ 64 char) — satu sumber kebenaran.
  2. **`docker.controller.js`** (`deployCompose`): memakai validator → 400 bila gagal. Bonus: **memperbaiki bug urutan argumen** `errorResponse(res, 400, msg)` → `errorResponse(res, msg, 400)` (signature helper adalah `(res, message, statusCode)` — panggilan lama melempar status sebagai message).
  3. **`docker.service.js`** (`deployCompose`): validasi yang sama di awal method (defense-in-depth untuk semua pemanggil, termasuk plugin) — menutup injeksi & traversal sekaligus. Nama plugin (`adguard`, `minio`, `pkg` dari `_validatePkg`) semuanya lolos.
- **Regression test**: `tests/docker.test.js` — 18 test (payload `;`, `"; rm -rf / #"`, `'; rm -rf / #'`, `$()`, backtick, pipe, space-arg, `../../etc`, slash, dot, 65-char, empty, non-string → ditolak sebelum fs/exec; nama valid + 6 nama plugin → `docker compose -p <nama>`; **controller-layer**: 400 untuk nama jahat, 200 untuk nama valid). ✅ 13 suite / 269 test lulus + lint hijau.

### 🟠 Temuan risiko sedang

| # | Lokasi | Status | Masalah & Solusi |
|---|---|---|---|
| R3-M1 | `ai-repair.service.js` | ✅ **DIPERBAIKI** | `getAutoFixSuggestions` mengirim `service`/`port`/`path` mentah ke `systemctl status ${service}` → sekarang `_validateFixContext()` dipakai di kedua jalur (`getAutoFixSuggestions` + `applyAutoFix`): service `^[a-zA-Z0-9_.@-]+$`, port 1–65535, path absolut tanpa `..`/metachar. Service juga di-quote di perintah systemctl. |
| R3-M2 | `nodejs.service.js` (`pm2Action`, `getPm2Logs`) | ✅ **DIPERBAIKI** | `name` divalidasi `^[a-zA-Z0-9_./-]+$` **dan** perintah dikonversi ke `execFile('pm2', [action, name])` (tanpa shell). |
| R3-M3 | `nodejs.service.js` (`pm2Start`) | ✅ **DIPERBAIKI** | `args` mentah dihapus — kini `execFile('pm2', ['start', script, '--name', name, '--', ...tokens])`; `name` juga divalidasi; tidak ada shell sama sekali. |
| R3-M4 | `mail.service.js:260` | ✅ **SUDAH AMAN** | `deleteFromQueue` sudah memvalidasi `^[A-F0-9]{10,}$` (format ID antrian Postfix). Checklist lama; dikonfirmasi ulang. |
| R3-M5 | `gpu.service.js:196` | ✅ **SUDAH AMAN** | `setPowerLimit` sudah `parseInt` + rentang 10–1000 W; index juga `parseInt`. |
| R3-M6 | `analytics.service.js:231` | ✅ **SUDAH AMAN** | `getWebLogs` sudah whitelist service (`nginx/apache2/httpd`) + `logType` (`access/error`); `lines` di-clamp 10–500. |
| R3-M7 | `caddy.service.js:407` | ✅ **SUDAH AMAN** | `serviceAction` sudah whitelist `['start','stop','restart','reload']` (controller + service). |
| R3-M8 | `pm2-manager` plugin | ✅ **DIPERBAIKI** | `validateAppName()` (`^[a-zA-Z0-9_./-]+$`) dipanggil **sebelum** fallback simulation-mode pada `/action` & `/logs`; input jahat ditolak eksplisit. Bonus: import `../../middleware/auth.js` yang **rusak** diperbaiki → `../../src/middleware/auth.js` (plugin sebelumnya gagal load). |

### 🟡 Temuan risiko rendah — ✅ SEMUA TERTANGANI (10 Agu 2026)

| # | Lokasi | Status | Hasil |
|---|---|---|---|
| R3-L1 | `fail2ban-manager` plugin `index.js:25` | ✅ **DIPERBAIKI** | `validateJailName()` (`^[a-zA-Z0-9_-]+$`) diekspor & dipakai di nama jail dari output sistem (`fail2ban-client status ${name}`) + rute ban/unban berbagi validator yang sama. Test: `tests/fail2banPlugin.test.js` |
| R3-L2 | `git-deployer` plugin `index.js:412` | ✅ **DIDOKUMENTASIKAN** | `hook.script` = **trusted admin input by design** (admin sudah punya akses shell penuh) — komentar [R3-L2 DOC] di titik eksekusi: jangan pernah memasukkan field payload webhook ke string ini |
| R3-L3 | `backup.service.js` | ✅ **DIVERIFIKASI + DIPERKUAT** | `remoteName`/`remotePath`/`destPath`/pola divalidasi di create **dan** update/restore (`validateName`/`validatePath` blok `..`, `/` awal). **Hardening**: `validateRestoreTarget()` boundary-aware — blok `/var/www2` (lolos dari cek lama `startsWith('/var/www')`), traversal, dan target kosong. Test: `tests/backup.test.js` (4 test) |
| R3-L4 | `system/php.service.js:82` | ✅ **TERBUKTI AMAN** | `this.phpVersion = '8.2'` hardcoded di constructor, **tidak pernah** di-set dari input user (tidak ada setter) → `systemctl reload php8.2-fpm` aman |
| R3-L5 | `caddy.service.js:932` | ✅ **TERBUKTI AMAN** | `CADDY_LOG_DIR = '/var/log/caddy'` konstanta; `logFile` dibangun dari ternary `type === 'error'` (hanya boolean, tidak diinterpolasi); `safeLines` clamp 10–1000 |
| R3-L6 | `power.service.js` | ✅ **TERBUKTI AMAN** | `setGovernor` whitelist `validGovernors` ✓ · `setFrequency` `parseInt` + range 100000–10000000 ✓ · `setPowerProfile` whitelist ✓ |

### ✅ Sudah aman (tidak perlu aksi — contoh pola)

- `system.service.js` — `_execFile` + validator lengkap (service name, git ref, commit hash, authkey, db password)
- `firewall.service.js` — `execFile` + whitelist port/protocol/action
- `iot.service.js` — `execFile` + `_validatePort/_validateId/_validateTopic`
- `mongodb.service.js` — `execFile('mongosh', args)` via `_buildArgs`
- `gpu.service.js:169-175` — `execFile('kill', [args])` dengan `numericPid` validasi ✓
- `apache.service.js` — `a2enmod/a2dismod` dengan regex module name ✓
- `mail.service.js` — `_validateEmail/_validateDomain/_validateLocalPart` + escape password ✓
- `python.service.js` — `validateName/validatePipPackage/validatePythonVersion` ✓
- `backup.service.js` — `validateName(remoteName, regex)` + destPath regex ✓
- `nodejs.service.js:401,414` — `validatePackageName(pkg)` untuk npm ✓
- `power.service.js` — `validGovernors`/`valid` whitelist ✓
- `terminal.service.js` — `node-pty` (input user = fitur terminal, diaudit perintah) — **by design**
- `core/db/sqlite.js`, `models/User.js`, `redis.service.js`, `websocket/docker.ws.js` — **false positive**: `db.exec()`/`chain.exec()`/`pipeline.exec()`/`container.exec()` (bukan shell)

---

## 4. Checklist Tindak Lanjut

### P0 — Perbaiki segera (command injection) — ✅ SELESAI (10 Agu 2026)

- [x] **R3-H1** — ✅ Selesai: `_validateGitRepo` + `execFile` di `websites.service.js` + 30 regression test
- [x] **R3-H2** — ✅ Selesai: `validateProjectName()` diekspor dari `docker.service.js`, dipakai di `docker.controller.js` **dan** `docker.service.js` (defense-in-depth) + fix bug urutan argumen `errorResponse`
- [x] Regression test R3-H2 (`tests/docker.test.js`) — 18 test dengan payload `"; rm -rf / #"` & `'; rm -rf / #'` → 13 suite / **269 test** total (websites juga: 31 test termasuk `'; rm -rf / #'`)

### P1 — Validasi input sebelum interpolasi — ✅ SELESAI (10 Agu 2026)

- [x] R3-M1 `ai-repair`: `_validateFixContext()` di `getAutoFixSuggestions` + `applyAutoFix` + quote service (test: `tests/ai-repair.test.js`)
- [x] R3-M2/M3 `nodejs`: regex `name` + `execFile` args array utk `pm2Action`/`getPm2Logs`/`pm2Start` (test: `tests/nodejs.test.js`)
- [x] R3-M4 `mail`: dikonfirmasi sudah tervalidasi (`^[A-F0-9]{10,}$`)
- [x] R3-M5 `gpu`: dikonfirmasi sudah `parseInt` + range 10–1000
- [x] R3-M6 `analytics`: dikonfirmasi sudah whitelist service/logType
- [x] R3-M8 `pm2-manager` plugin: `validateAppName()` + perbaikan import rusak (test: `tests/pm2ManagerPlugin.test.js`)

### P2 — Verifikasi & dokumentasi — ✅ SELESAI (10 Agu 2026)

- [x] R3-M7 `caddy`: dikonfirmasi whitelist action
- [x] R3-L1 `fail2ban`: `validateJailName()` + 5 test plugin
- [x] R3-L2 `git-deployer`: dokumentasi `hook.script` trusted admin input
- [x] R3-L3 `backup`: verifikasi penuh + `validateRestoreTarget()` boundary-aware + 3 test
- [x] R3-L4..L6 `php/caddy/power`: terbukti aman (konstanta/whitelist/clamp)
- [x] **Aturan audit ke `CONTRIBUTING.md`** — ✅ dibuat (10 Agu 2026): [CONTRIBUTING.md](../CONTRIBUTING.md) — checklist R3 5 bagian (execFile+args / string hardcoded, validasi input, regression test injeksi, aturan import plugin `../../src/...`, pra-push) + [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md)
- [x] **Temuan baru (import plugin rusak)** — ✅ **SELESAI (10 Agu 2026)**: audit 17 plugin menemukan **6 import rusak** di 4 plugin — `git-deployer` (`../../middleware/auth.js`, `../../middleware/rateLimiter.js`, `../../models/Setting.js`×2), `pm2-manager` (`../../middleware/auth.js`), `rclone-backuper` (`../../models/Setting.js`×2) → semuanya diperbaiki ke `../../src/...`
- [x] **Cek import plugin di CI** — ✅ **SELESAI (10 Agu 2026)**: script [scripts/check-plugin-imports.mjs](../scripts/check-plugin-imports.mjs) memverifikasi semua import relatif di `plugins/` resolve; npm script `check:plugin-imports`; step **blocker** di `ci.yml` (job lint) + `docker-publish.yml`; masuk rantai `lint:ci` lokal; regression test `tests/pluginImports.test.js`

---

## 5. Metodologi & Statistik Detail

```
Scan: grep -rlnE 'exec(Async|Sync)?\(|execFile(Sync)?\(|spawn(Sync)?\(|\bfork\('
  src/  → 29 file backend (+8 file vendor public/js: chart, codemirror, xterm — false positive minified)
  plugins/ → 9 file

Jumlah panggilan per file (top):
  mail.service.js 41 · system.service.js 40 · iot.service.js 30 · python.service.js 26
  apache.service.js 26 · lvm-manager.service.js 23 · nodejs.service.js 22 · caddy.service.js 20
  power.service.js 19 · ai-repair.service.js 16 · gpu.service.js 15 · cdn.service.js 15
  backup.service.js 15 · autoheal.service.js 12 · websites.service.js 9 · analytics.service.js 7
  plugins: rclone-helper 7 · git-deployer 6 · dep-installer 4 · pm2-manager 4 · dst.
```

---

## 6. Referensi

- Roadmap: `rencana.md` §9.1 (Audit semua eksekusi perintah) — item ini kini **sebagian selesai** (checklist tersedia; perbaikan P0/P1 belum)
- Baseline pola aman: `src/modules/system/system.service.js` (`_execFile`, `_execShell`)
- Audit keamanan sebelumnya: `audit.md` (CRIT-1 shell injection — sudah diperbaiki via execFile)
