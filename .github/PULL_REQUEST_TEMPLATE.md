## Deskripsi

<!-- Apa yang diubah dan mengapa. Sertakan nomor issue jika ada. -->

## Checklist Wajib (Audit R3)

> Aturan lengkap: [CONTRIBUTING.md](../CONTRIBUTING.md) · [docs/audit-exec-checklist.md](../docs/audit-exec-checklist.md)

### Eksekusi perintah
- [ ] Operasi sistem memakai `execFile(bin, args[])` tanpa shell — atau `exec` **hanya** untuk string hardcoded
- [ ] Tidak ada interpolasi input user ke string shell
- [ ] Input user yang masuk command divalidasi (regex whitelist / whitelist nilai / `parseInt` + clamp)
- [ ] Path divalidasi traversal **dan** batas direktori (`path.relative`, bukan `startsWith` naif)

### Plugin (jika menyentuh `plugins/`)
- [ ] Import modul inti/middleware lewat `../../src/...` (bukan `../../middleware/...`)
- [ ] Input dari request plugin (nama proses/jail/proyek) divalidasi

### Test & kualitas
- [ ] Regression test untuk setiap validasi baru — termasuk payload injeksi (`; rm -rf / #`, `$(...)`, backtick, `|`)
- [ ] `npm run lint:check` hijau (0 warning)
- [ ] `npm run test` hijau
- [ ] `npm audit --audit-level=high` = 0 vulnerabilities

## Bukti / Screenshot (opsional)

<!-- Tempel output test, screenshot UI, atau log yang mendukung perubahan -->
