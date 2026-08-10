# 📊 Coverage Baseline & Gap Report — Panelku v2.0.0

> **📌 Pembaruan 10 Agustus 2026 (R1 — Coverage Gate)**
> - Pengukuran ulang dengan **8 suite test / 188 test** (bertambah `databaseService.test.js`, `waf.test.js`): Statements **13.01%** · Branches **6.93%** · Functions **11.33%** · Lines **13.3%** (backend `src/**/*.js` tanpa `public/` & `swagger*.js`).
> - `collectCoverageFrom` + `coverageThreshold` kini **terpasang di `package.json`** (statements 10% / branches 5% / functions 9% / lines 10%) — buffer ±2–3% di bawah angka aktual agar CI hijau (anti-flaky antar-platform) sambil menahan regresi. Naikkan per sprint menuju target 60%.
> - `npm audit --audit-level=high` = **0 vulnerabilities** (5 temuan high lama diperbaiki: brace-expansion→5.0.9, socket.io-parser→4.2.7, js-yaml, fast-uri, @eslint/eslintrc) dan kini menjadi **blocker** di `ci.yml` & `docker-publish.yml`.

---

> **Tanggal pengukuran awal**: 31 Juli 2026
> **Perintah**:
> ```bash
> node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage \
>   --collectCoverageFrom='src/**/*.js' --coverageReporters=text,json --testTimeout=30000
> ```
> **Hasil test**: 4 suite lulus, 102 test lulus, 0 gagal (~14 detik).
> **Catatan**: Reporter `json-summary` gagal di instalasi ini (error di `istanbul-reports`); gunakan reporter `json` lalu agregasi dari `coverage/coverage-final.json`.

---

## 🎯 Ringkasan Eksekutif

| Metrik | Nilai |
|---|---|
| **Coverage keseluruhan (semua `src/`, 240 file)** | Stmts **3.76%** · Branch **1.09%** · Funcs **2.41%** |
| **Coverage backend (`src/` tanpa `public/`, 179 file)** | Stmts **11.21%** · Branch **4.85%** · Funcs **9.49%** |
| File dengan **0% statement** | **113** (52 backend + 61 frontend) |
| Target v3.0 (rencana.md Phase 8.1) | Backend statements ≥ **60%** |

> **Kesimpulan**: Panel berjalan baik (102 test lulus) namun **hampir seluruh coverage berasal dari 3 sumber**: (1) `csp.test.js` yang me-render semua halaman → membuat `app.js` (97.7%), seluruh file `*.routes.js` (100%), middleware, dan nonce ter-cover; (2) test `mustChangePassword` → sebagian `auth.service.js`; (3) test `lvmManager` → `lvm-manager.service.js` (42.2%). **Semua controller (32 file) dan hampir semua service berada di 0–15%.**

---

## 📈 Rincian Per-Area (Statements %)

| Area | Stmts | Files | Zero |
|---|---:|---:|---:|
| `src/bootstrap.js` | 0.00% | 1 | 1 |
| `src/server.js` | 0.00% | 1 | 1 |
| `src/jobs/*` | 0.00% | 4 | 4 |
| `src/websocket/*` | 0.00% | 6 | 6 |
| `public/js/*` (frontend) | 0.00% | 61 | 61 |
| `modules/database` | 3.56% | 3 | 1 |
| `modules/ai-repair` | 4.30% | 3 | 1 |
| `modules/plugins` | 4.93% | 2 | 0 |
| `modules/autoheal` | 5.00% | 3 | 1 |
| `modules/backup` | 5.14% | 3 | 1 |
| `modules/power` | 5.52% | 3 | 1 |
| `modules/python` | 5.60% | 3 | 1 |
| `modules/apache` | 5.72% | 3 | 1 |
| `modules/analytics` | 5.85% | 3 | 1 |
| `modules/dns` | 5.92% | 3 | 1 |
| `modules/gpu` | 6.04% | 3 | 1 |
| `modules/ai` | 6.25% | 2 | 1 |
| `modules/updater` | 6.29% | 3 | 1 |
| `modules/caddy` | 6.36% | 3 | 1 |
| `modules/nodejs` | 6.42% | 3 | 1 |
| `modules/redis` | 6.67% | 3 | 1 |
| `modules/mail` | 7.29% | 3 | 1 |
| `modules/iot` | 7.30% | 3 | 1 |
| `modules/cdn` | 7.31% | 3 | 1 |
| `modules/system` | 7.69% | 8 | 1 |
| `modules/docker` | 7.72% | 3 | 1 |
| `modules/cluster` | 7.77% | 3 | 2 |
| `modules/mongodb` | 8.14% | 3 | 1 |
| `modules/alerts` | 8.70% | 3 | 2 |
| `modules/firewall` | 8.70% | 3 | 1 |
| `modules/websites` | 9.09% | 3 | 1 |
| `modules/whatsapp` | 9.59% | 3 | 1 |
| `modules/filemanager` | 10.32% | 3 | 0 |
| `modules/ssl` | 10.96% | 3 | 1 |
| `modules/cron` | 12.24% | 3 | 1 |
| `modules/terminal` | 12.50% | 3 | 0 |
| `modules/waf` | 13.21% | 3 | 2 |
| `modules/dashboard` | 14.29% | 3 | 0 |
| `modules/monitor` | 15.58% | 3 | 0 |
| `modules/roles` | 15.94% | 3 | 0 |
| `modules/auth` | 16.38% | 7 | 3 |
| `src/repositories` | 17.09% | 5 | 0 |
| `modules/users` | 18.55% | 3 | 0 |
| `src/models` | 20.45% | 11 | 0 |
| `src/helpers` | 21.93% | 5 | 0 |
| `src/core` | 23.10% | 5 | 0 |
| `modules/lvm-manager` | 33.57% | 3 | 1 |
| `modules/agent` | 35.29% | 1 | 0 |
| `src/middleware` | 46.34% | 7 | 0 |
| `src/config` | 57.14% | 8 | 4 |
| `modules/api-docs` | 87.50% | 2 | 0 |
| `src/routes` | 97.67% | 1 | 0 |
| `src/app.js` | 97.71% | 1 | 0 |

> ⚠️ **Peringatan interpretasi**: `*.routes.js` tampil 100% karena file rute hanya berisi *registrasi route* yang dieksekusi saat `app.js` di-import oleh `csp.test.js`. Ini **bukan** bukti endpoint diuji. Hal yang sama berlaku untuk `app.js`, `swagger.js` (file data), dan sebagian middleware.

---

## 🔴 52 File Backend dengan 0% Coverage

**Config & entrypoint**: `src/bootstrap.js`, `src/server.js`, `src/config/database.js`, `src/config/redis.js`, `src/config/socket.js`, `src/config/swagger.fixed.js`

**Jobs**: `backup.job.js`, `health.job.js`, `monitor.job.js`, `password-expiry-reminder.job.js`

**WebSocket** (6/6): `agent-terminal.ws.js`, `docker.ws.js`, `index.js`, `monitor.ws.js`, `notifications.ws.js`, `terminal.ws.js`

**Controller & service (36 file, semuanya 0%)**: 32 controller (`ai`, `ai-repair`, `analytics`, `apache`, `sso`, `autoheal`, `backup`, `caddy`, `cdn`, `cron`, `database`, `dns`, `docker`, `firewall`, `gpu`, `iot`, `lvm-manager`, `mail`, `mongodb`, `nodejs`, `power`, `python`, `redis`, `ssl`, `system`, `updater`, `websites`, `whatsapp`, `cluster`, `waf`, `ldap`, `alerts`) + 4 service (`alerts.service.js`, `ldap.service.js`, `cluster.service.js`, `waf.service.js`)

---

## ✅ Yang Sudah Ter-cover dengan Baik (backend)

| File | Stmts |
|---|---:|
| `src/app.js` | 97.7% |
| `src/routes/index.js` | 97.7% |
| `src/middleware/requestLogger.js` | 90.0% |
| `src/config/logger.js` | 85.7% |
| `src/middleware/nonce.js` | 82.6% |
| `src/core/db/sqlite.js` | 81.0% |
| `src/middleware/rateLimiter.js` | 68.2% |
| `src/helpers/response.js` | 65.2% |
| `src/repositories/audit.repository.js` | 60.0% |
| `src/middleware/waf.middleware.js` | 56.5% |
| `src/models/User.js` | 45.6% |
| `src/modules/lvm-manager/lvm-manager.service.js` | 42.2% |
| `src/middleware/auth.js` | 38.6% |
| `src/modules/auth/auth.service.js` | 32.6% |
| `src/models/AuditLog.js` | 32.3% |
| `src/core/events/EventBus.js` | 30.4% |

---

## 🧭 Analisis Gap & Rekomendasi Prioritas

### P0 — Fondasi (naikkan dari ~16–46% ke ≥60%)
Lapisan ini sudah ter-cover sebagian oleh test yang ada; menambah test lebih murah karena polanya sudah terbukti (lihat `tests/mustChangePassword.test.js` untuk pola supertest):

1. ✅ **`modules/auth`** (16.4% → **37.92%** per 31 Jul 2026) — `tests/auth.service.test.js` (service 91%) + `tests/auth.controller.test.js` (controller 93%) sudah dibuat sebagai **pola referensi**. Sisanya: controller `ldap/sso` masih 0% → bisa lanjut ke Phase 8.2 (integration test).
2. **`src/middleware`** (46.3%) — `waf.middleware.js` 56.5%, `auth.js` 38.6%, `rbac.js` 18.9%: tambah kasus deny/bypass.
3. **`src/helpers`** (21.9%) — `system.js` 22% (execFile wrapper), `crypto.js` 20.5%, `security-advisor.js` 4%.
4. **`src/repositories`** (17.1%) — `base.repository.js` 9.1%, `user.repository.js` 19.6%: pakai SQLite `:memory:`.
5. **`modules/users` (18.6%) & `roles` (15.9%)** — CRUD + RBAC enforcement.

### P0 — Logika Bisnis Kritis (0–10% → ≥50%)
6. **`modules/backup`** (5.1%) & **`modules/database`** (3.6%) — backup/restore, ekspor/impor, konsol query.
7. **`modules/docker`** (7.7%) — container CRUD dengan `dockerode` mock.
8. **`modules/websites`** (9.1%) & **`ssl`** (11.0%) — vhost, reverse proxy, Let's Encrypt (mock `acme.sh`).
9. **`modules/firewall`** (8.7%), **`modules/waf`** (13.2%), **`modules/updater`** (6.3%) — aturan keamanan & auto-update + rollback.

### P0 — Controller & E2E (semua 0%)
10. **Semua 32 controller** — tambahkan integration test supertest per modul (pola: login → `request(app).get/post` → cek `success/error` helper). Ini sendirinya akan menaikkan coverage backend secara signifikan karena controller mewakili sebagian besar statement.

### P1 — Lapisan Pendukung (0%)
11. **`src/websocket`** (6 file, 0%) — test namespace monitor/docker/notifications dengan `socket.io-client`.
12. **`src/jobs`** (4 file, 0%) — test scheduler & job handler (backup, health, monitor, password-expiry).
13. **`bootstrap.js`, `server.js`, config** — test bootstrapping + graceful shutdown (WAL-safe).

### P1 — Frontend (`public/js`, 61 file 0%)
14. Frontend tidak di-cover oleh Jest default (browser API). **Rekomendasi**: *keluarkan `src/public` dari `collectCoverageFrom`* untuk threshold CI (jangan menghukum metrik backend), dan pertimbangkan strategi terpisah (jsdom / smoke test render) di fase berikutnya.

---

## ⚙️ Rekomendasi Konfigurasi Jest (package.json)

```jsonc
{
  "jest": {
    "collectCoverageFrom": [
      "src/**/*.js",
      "!src/public/**",
      "!src/config/swagger.js"
    ],
    "coverageThreshold": {
      "global": {
        "statements": 60,
        "branches": 40,
        "functions": 50,
        "lines": 60
      }
    }
  }
}
```

> Threshold bersifat **bertahap**: mulailah dengan nilai rendah (mis. statements 20%) sebagai gate CI, lalu naikkan per sprint menuju 60%.

---

## 🔄 Cara Mengulang Pengukuran

```bash
cd linux-panel
node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage \
  --collectCoverageFrom='src/**/*.js' --coverageReporters=text,json --testTimeout=30000
# Agregasi per-modul: parse coverage/coverage-final.json (path memakai backslash Windows, normalisasi dulu)
```
