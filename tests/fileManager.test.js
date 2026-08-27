/**
 * Unit test: FileManager upload functionality
 *
 * @jest-environment node
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fileManagerService from '../src/modules/filemanager/filemanager.service.js';
import fileManagerController from '../src/modules/filemanager/filemanager.controller.js';

let tmpDir;
let originalBaseDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-test-'));
  originalBaseDir = process.env.FM_BASE_DIR;
  process.env.FM_BASE_DIR = tmpDir;
});

afterAll(() => {
  if (originalBaseDir !== undefined) {
    process.env.FM_BASE_DIR = originalBaseDir;
  } else {
    delete process.env.FM_BASE_DIR;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createTempUploadFile(name, content = 'test content') {
  const tempPath = path.join(os.tmpdir(), `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(tempPath, content);
  return tempPath;
}

describe('FileManagerService.saveUploadedFile', () => {
  test('successfully moves uploaded file from temp to target directory', async () => {
    const tempFile = createTempUploadFile('sample.txt', 'hello from test');
    const result = await fileManagerService.saveUploadedFile(tempFile, '/', 'sample.txt');

    expect(result.name).toBe('sample.txt');
    expect(result.path).toBe('/sample.txt');
    expect(fs.existsSync(tempFile)).toBe(false);

    const savedFile = path.join(tmpDir, 'sample.txt');
    expect(fs.existsSync(savedFile)).toBe(true);
    expect(fs.readFileSync(savedFile, 'utf8')).toBe('hello from test');
  });

  test('successfully saves file into a subdirectory', async () => {
    fs.mkdirSync(path.join(tmpDir, 'subfolder'), { recursive: true });
    const tempFile = createTempUploadFile('doc.txt', 'nested file');
    const result = await fileManagerService.saveUploadedFile(tempFile, '/subfolder', 'doc.txt');

    expect(result.name).toBe('doc.txt');
    expect(result.path).toBe('/subfolder/doc.txt');

    const savedFile = path.join(tmpDir, 'subfolder', 'doc.txt');
    expect(fs.existsSync(savedFile)).toBe(true);
    expect(fs.readFileSync(savedFile, 'utf8')).toBe('nested file');
  });

  test('sanitizes filename and prevents directory traversal in originalName', async () => {
    const tempFile = createTempUploadFile('traversal.txt', 'traversal content');
    const result = await fileManagerService.saveUploadedFile(tempFile, '/', '../../../evil.txt');

    expect(result.name).toBe('evil.txt');
    expect(result.path).toBe('/evil.txt');
    expect(fs.existsSync(path.join(tmpDir, 'evil.txt'))).toBe(true);
  });

  test('throws 400 when target directory does not exist', async () => {
    const tempFile = createTempUploadFile('fail.txt', 'fail content');
    await expect(fileManagerService.saveUploadedFile(tempFile, '/nonexistent_folder_xyz', 'fail.txt'))
      .rejects.toMatchObject({ statusCode: 400, message: 'Target directory does not exist' });
    
    // Clean up temp file
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  });
});

describe('FileManagerController.upload', () => {
  test('returns 400 if no files uploaded', async () => {
    const req = { files: [] };
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
    };

    await fileManagerController.upload(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('processes upload, saves files, and returns success response', async () => {
    const tempFile = createTempUploadFile('uploaded-note.txt', 'this is a note');
    const req = {
      body: { path: '/' },
      files: [
        {
          path: tempFile,
          originalname: 'uploaded-note.txt',
          size: 14,
        },
      ],
    };
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
    };

    await fileManagerController.upload(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.uploaded).toHaveLength(1);
    expect(res.body.data.uploaded[0].name).toBe('uploaded-note.txt');

    const destFile = path.join(tmpDir, 'uploaded-note.txt');
    expect(fs.existsSync(destFile)).toBe(true);
    expect(fs.readFileSync(destFile, 'utf8')).toBe('this is a note');
  });

  test('rejects malicious executable files and cleans up temp files', async () => {
    const ELF_HEAD = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const tempFile = createTempUploadFile('fake.png', ELF_HEAD);
    const req = {
      body: { path: '/' },
      files: [
        {
          path: tempFile,
          originalname: 'fake.png',
          size: ELF_HEAD.length,
        },
      ],
    };
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
    };

    await fileManagerController.upload(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(fs.existsSync(tempFile)).toBe(false);
  });
});
