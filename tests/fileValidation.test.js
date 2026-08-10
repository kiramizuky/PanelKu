/**
 * Unit test: helpers/file-validation.js — [9.1-UP] upload content validation
 *
 * @jest-environment node
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyFileMagicBytes, removeUploadedFiles } from '../src/helpers/file-validation.js';

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileval-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name, buf) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, buf);
  return p;
}

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const ELF_HEAD = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const MZ_HEAD = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00]);
const TEXT = Buffer.from('hello world, plain text\n');

describe('verifyFileMagicBytes', () => {
  test('accepts valid PNG with .png extension', () => {
    const p = writeFile('ok.png', PNG_HEAD);
    expect(verifyFileMagicBytes(p, 'ok.png')).toEqual({ ok: true });
  });

  test('rejects PHP content disguised as .png (polyglot)', () => {
    const p = writeFile('evil.png', Buffer.concat([Buffer.from('<?php system($_GET["c"]); ?>'), PNG_HEAD]));
    const r = verifyFileMagicBytes(p, 'evil.png');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not match declared \.png/);
  });

  test('rejects ELF executable even with .jpg extension', () => {
    const p = writeFile('notimg.jpg', ELF_HEAD);
    const r = verifyFileMagicBytes(p, 'notimg.jpg');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ELF executable/);
  });

  test('rejects MZ/PE executable with .zip extension', () => {
    const p = writeFile('backup.zip', MZ_HEAD);
    const r = verifyFileMagicBytes(p, 'backup.zip');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/MZ\/PE executable/);
  });

  test('accepts text files (no binary signature check)', () => {
    const p = writeFile('notes.txt', TEXT);
    expect(verifyFileMagicBytes(p, 'notes.txt')).toEqual({ ok: true });
  });

  test('accepts valid gzip signature with .gz extension', () => {
    const p = writeFile('data.gz', Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]));
    expect(verifyFileMagicBytes(p, 'data.gz')).toEqual({ ok: true });
  });

  test('accepts files without extension (cannot verify)', () => {
    const p = writeFile('README', TEXT);
    expect(verifyFileMagicBytes(p, 'README')).toEqual({ ok: true });
  });

  test('rejects ELF executable even with NO extension (renamed binary)', () => {
    const p = writeFile('evil', ELF_HEAD);
    const r = verifyFileMagicBytes(p, 'evil');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ELF executable/);
  });

  test('rejects unreadable file path', () => {
    const r = verifyFileMagicBytes(path.join(tmpDir, 'missing.bin'), 'missing.bin');
    expect(r.ok).toBe(false);
  });
});

describe('removeUploadedFiles', () => {
  test('removes listed files and ignores missing ones', () => {
    const p1 = writeFile('cleanup1.txt', TEXT);
    const p2 = path.join(tmpDir, 'never-exists.txt');
    expect(fs.existsSync(p1)).toBe(true);
    removeUploadedFiles([p1, p2]);
    expect(fs.existsSync(p1)).toBe(false);
  });
});
