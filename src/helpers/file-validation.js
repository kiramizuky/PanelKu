/**
 * [9.1-UP] Validasi konten file (magic bytes) — defense-in-depth di atas filter
 * ekstensi multer (filemanager.routes.js BLOCKED_EXTENSIONS).
 *
 * Tujuan:
 * - Mencegah polyglot / script yang menyamar sebagai gambar/arsip (mis. PHP di
 *   balik ekstensi .png) dengan memverifikasi kesesuaian antara ekstensi yang
 *   diklaim dan signature biner file.
 * - Selalu menolak executable (ELF/Linux, MZ/Windows) walau ekstensinya diubah.
 *
 * Catatan: validasi ini TIDAK menggantikan verifikasi MIME dari Content-Type
 * header (yang mudah dipalsukan) — justru ini yang memvalidasi isi sebenarnya.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Signature biner yang dikenali → periksa kesesuaian ekstensi. */
const BINARY_SIGNATURES = [
  { ext: ['png'],  bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], name: 'PNG' },
  { ext: ['jpg', 'jpeg'], bytes: [0xff, 0xd8, 0xff], name: 'JPEG' },
  { ext: ['gif'], bytes: [0x47, 0x49, 0x46, 0x38], name: 'GIF' },
  { ext: ['bmp'], bytes: [0x42, 0x4d], name: 'BMP' },
  { ext: ['pdf'], bytes: [0x25, 0x50, 0x44, 0x46], name: 'PDF' },
  { ext: ['sqlite', 'sqlite3'], bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00], name: 'SQLite' },
  { ext: ['gz', 'tgz'], bytes: [0x1f, 0x8b], name: 'gzip' },
  { ext: ['zip'], bytes: [0x50, 0x4b, 0x03, 0x04], name: 'ZIP' },
];

/** Signature yang selalu ditolak (executable tersembunyi). */
const FORBIDDEN_SIGNATURES = [
  { bytes: [0x7f, 0x45, 0x4c, 0x46], name: 'ELF executable' },
  { bytes: [0x4d, 0x5a], name: 'MZ/PE executable' },
];

/** Ekstensi teks yang diizinkan tanpa verifikasi signature. */
const TEXT_EXTENSIONS = new Set([
  'txt', 'conf', 'cfg', 'ini', 'log', 'json', 'yml', 'yaml', 'md', 'xml',
  'csv', 'sql', 'env', 'htaccess', 'htpasswd', 'crt', 'key', 'pem', 'pub',
]);

/**
 * Verifikasi kesesuaian magic bytes file dengan ekstensi yang diklaim.
 *
 * @param {string} filePath  Path file di disk (hasil upload multer).
 * @param {string} originalName Nama file asli (untuk ekstraksi ekstensi).
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyFileMagicBytes(filePath, originalName) {
  const ext = path.extname(originalName || '').slice(1).toLowerCase();

  let head;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    head = buf;
  } catch {
    // File tak terbaca → tolak agar tidak lolos validasi.
    return { ok: false, reason: 'Uploaded file could not be read for content validation' };
  }

  const matches = (sig) =>
    sig.every((b, i) => head[i] === b);

  // 1) Executable tersembunyi → SELALU tolak, tanpa peduli ekstensi (termasuk
  //    file tanpa ekstensi — ELF/MZ yang di-rename jadi 'evil' ikut tertangkap).
  for (const sig of FORBIDDEN_SIGNATURES) {
    if (matches(sig.bytes)) {
      return { ok: false, reason: `Executable content detected (${sig.name}) is not allowed` };
    }
  }

  // 2) Tanpa ekstensi → bukan executable, izinkan (tak ada kesesuaian yang bisa dicek).
  if (!ext) return { ok: true };

  // 3) Ekstensi biner yang dikenali → wajib cocok signature.
  for (const sig of BINARY_SIGNATURES) {
    if (sig.ext.includes(ext)) {
      if (!matches(sig.bytes)) {
        return { ok: false, reason: `Content does not match declared .${ext} type (${sig.name})` };
      }
      return { ok: true };
    }
  }

  // 4) Ekstensi teks → izinkan (script marker sudah tertutup oleh rule 1 & multer).
  if (TEXT_EXTENSIONS.has(ext)) return { ok: true };

  // 5) Ekstensi lain yang tidak dikenal → tidak diverifikasi.
  return { ok: true };
}

/**
 * Hapus file yang sudah di-upload (cleanup saat validasi gagal).
 * @param {string[]} paths
 */
export function removeUploadedFiles(paths) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch { /* best-effort */ }
  }
}
