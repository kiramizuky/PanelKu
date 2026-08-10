# Contributing — Panelku (linux-panel)

Terima kasih sudah berkontribusi ke Panelku! Dokumen ini berisi konvensi,
alur pengembangan, dan **checklist wajib untuk Pull Request** — terutama aturan
audit keamanan eksekusi perintah (R3) yang berlaku untuk setiap kode baru.

## Alur Pengembangan

1. `npm install`
2. `npm run dev` — jalankan dengan hot-reload (`node --watch`)
3. Tulis/ubah kode di `src/` (backend ESM) atau `plugins/`
4. Jalankan validasi lokal sebelum push:

| Perintah | Fungsi |
|---|---|
| `npm run lint:check` | ESLint seluruh `src/` — **0 warning** |
| `npm run test` | Seluruh suite Jest (ESM) |
| `npm run test:coverage` | Test + laporan coverage (gate threshold aktif) |
| `npm run lint:ci` | Gabungan: lint + window-check + test + coverage (sama seperti CI) |

> CI juga menjalankan `npm audit --audit-level=high` sebagai **blocker** —
> kerentanan high/critical menghentikan merge.

## Struktur Kode

- **Modul**: `src/modules/<modul>/` — pola 3 lapis `*.routes.js` → `*.controller.js` → `*.service.js` (+ view EJS).
- **Plugin**: `plugins/<nama>/index.js` — di-mount oleh PluginLoader; **import modul inti/middleware WAJIB lewat `../../src/...`**.
- **Test**: `tests/*.test.js` (Jest ESM, `jest.unstable_mockModule` untuk mocking; mock `child_process` harus gaya callback karena service memakai `util.promisify`).

## 🛡️ Checklist Keamanan Wajib PR (Audit R3)

Setiap PR yang menyentuh `src/`, `plugins/`, atau menambah eksekusi perintah
sistem WAJIB memenuhi aturan berikut. Referensi lengkap & temuan historis:
[docs/audit-exec-checklist.md](docs/audit-exec-checklist.md).

### 1. Eksekusi perintah (exec / execFile / spawn)

- [ ] Operasi sistem baru memakai **`execFile(bin, args[])`** — tanpa shell.
- [ ] Bila shell diperlukan (pipe/redirect) → `exec` **hanya dengan string hardcoded**, tidak pernah dengan input user.
- [ ] Tidak ada **interpolasi input user ke string shell** (`exec(\`cmd ${userInput}\`)`).

### 2. Validasi input user

- [ ] Semua input user yang masuk ke command divalidasi: regex whitelist / whitelist nilai / `parseInt` + clamp.
- [ ] Path: wajib cek traversal (`..`, path absolut) **dan** batas direktori (pakai `path.relative`, bukan `startsWith` naif yang bisa dilewati `../dir2`).
- [ ] Nama layanan/proses/proyek: regex karakter aman (mis. `^[a-zA-Z0-9_-]+$`), bukan hanya cek truthy.

### 3. Test keamanan

- [ ] Setiap validasi baru dilengkapi **regression test** dengan payload injeksi
      (`; rm -rf / #`, `$(...)`, backtick, `|`, dll.) yang membuktikan payload
      **tidak pernah** sampai ke exec (throw sebelum eksekusi).

### 4. Aturan khusus plugin

- [ ] Import modul inti/middleware dari plugin memakai **`../../src/...`** (bukan `../../middleware/...`).
- [ ] Plugin yang mengeksekusi perintah mengikuti aturan 1–3 yang sama.
- [ ] Input dari request plugin (nama proses/jail/proyek) divalidasi dengan regex yang sama seperti modul inti.

### 5. Pra-push

- [ ] `npm run lint:check` hijau (0 warning)
- [ ] `npm run test` hijau (seluruh suite)
- [ ] `npm audit --audit-level=high` = **0 vulnerabilities**

## Referensi

- [Dokumen analisis proyek](docs/analisis-proyek.md)
- [Analisis per-modul](docs/analisis-per-modul.md)
- [Checklist audit eksekusi perintah (R3)](docs/audit-exec-checklist.md)
- [Coverage baseline](docs/coverage-baseline.md)
- [Roadmap](https://github.com/kiramizuky/PanelKu/blob/main/rencana.md)
