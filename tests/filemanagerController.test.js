/**
 * FileManager Controller Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Writable } from 'stream';
import fileManagerController from '../src/modules/filemanager/filemanager.controller.js';

let testBaseDir;

function mockRes() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    headers,
    setHeader(k, v) {
      headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      return this;
    },
    // Writable stream simulation for pipe()
    write(chunk) {},
    end() {},
    on(event, handler) {
      if (event === 'finish') setTimeout(handler, 10);
      return this;
    },
    emit() {},
  };
}

beforeAll(async () => {
  testBaseDir = path.join(os.tmpdir(), `panelku-fmc-test-${Date.now()}`);
  await fs.mkdir(testBaseDir, { recursive: true });
  process.env.FM_BASE_DIR = testBaseDir;
});

afterAll(async () => {
  try {
    await fs.rm(testBaseDir, { recursive: true, force: true });
  } catch {}
});

describe('FileManagerController - File Operations', () => {
  test('mkdir creates directory', async () => {
    const req = { body: { path: 'documents' } };
    const res = mockRes();
    await fileManagerController.mkdir(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('writeFile saves file content and readFile reads it', async () => {
    const writeReq = { body: { path: 'documents/hello.txt', content: 'PanelKu File Manager' } };
    const writeRes = mockRes();
    await fileManagerController.writeFile(writeReq, writeRes);
    expect(writeRes.statusCode).toBe(200);

    const readReq = { query: { path: 'documents/hello.txt' } };
    const readRes = mockRes();
    await fileManagerController.readFile(readReq, readRes);
    expect(readRes.statusCode).toBe(200);
    expect(readRes.body.data.content).toBe('PanelKu File Manager');
  });

  test('info returns file statistics and metadata', async () => {
    const req = { query: { path: 'documents/hello.txt' } };
    const res = mockRes();
    await fileManagerController.info(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.name).toBe('hello.txt');
    expect(res.body.data.size).toBe(20);
    expect(res.body.data.modified).toBeDefined();
    expect(res.body.data.created).toBeDefined();
    expect(res.body.data.owner).toBeDefined();
  });

  test('list retrieves directory entries', async () => {
    const req = { query: { path: 'documents' } };
    const res = mockRes();
    await fileManagerController.list(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.items).toBeDefined();
    const item = res.body.data.items.find(i => i.name === 'hello.txt');
    expect(item).toBeDefined();
    expect(item.size).toBe(20);
    expect(item.modified).toBeDefined();
    expect(item.created).toBeDefined();
    expect(item.owner).toBeDefined();
  });

  test('copy duplicates file to new destination', async () => {
    const req = { body: { source: 'documents/hello.txt', destination: 'documents/copied.txt' } };
    const res = mockRes();
    await fileManagerController.copy(req, res);
    expect(res.statusCode).toBe(200);

    const checkReq = { query: { path: 'documents/copied.txt' } };
    const checkRes = mockRes();
    await fileManagerController.readFile(checkReq, checkRes);
    expect(checkRes.statusCode).toBe(200);
    expect(checkRes.body.data.content).toBe('PanelKu File Manager');
  });

  test('rename changes file name', async () => {
    const req = { body: { path: 'documents/copied.txt', newName: 'renamed.txt' } };
    const res = mockRes();
    await fileManagerController.rename(req, res);
    expect(res.statusCode).toBe(200);
  });

  test('move moves file to another directory', async () => {
    await fs.mkdir(path.join(testBaseDir, 'backup'), { recursive: true });
    const req = { body: { source: 'documents/renamed.txt', destination: 'backup/moved.txt' } };
    const res = mockRes();
    await fileManagerController.move(req, res);
    expect(res.statusCode).toBe(200);
  });

  test('delete removes file', async () => {
    const req = { body: { path: 'backup/moved.txt' } };
    const res = mockRes();
    await fileManagerController.delete(req, res);
    expect(res.statusCode).toBe(200);
  });

  test('search finds files matching query', async () => {
    const badReq = { query: { path: 'documents' } };
    const badRes = mockRes();
    await fileManagerController.search(badReq, badRes);
    expect(badRes.statusCode).toBe(400);

    const req = { query: { path: 'documents', query: 'hello' } };
    const res = mockRes();
    await fileManagerController.search(req, res);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.results)).toBe(true);
  });
});

describe('FileManagerController - Upload & Download Tokens', () => {
  test('upload rejects requests without files', async () => {
    const req = { files: [] };
    const res = mockRes();
    await fileManagerController.upload(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('upload saves uploaded files with valid contents', async () => {
    const tmpUploadFile = path.join(testBaseDir, 'temp_raw_upload.txt');
    await fs.writeFile(tmpUploadFile, 'Uploaded text file contents');

    const req = {
      files: [{
        path: tmpUploadFile,
        originalname: 'upload1.txt',
        size: 27,
      }],
      body: { path: 'documents' },
    };
    const res = mockRes();
    await fileManagerController.upload(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.uploaded.length).toBe(1);
  });

  test('download rejects directory download', async () => {
    const req = { query: { path: 'documents' } };
    const res = mockRes();
    await fileManagerController.download(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('Cannot download a directory');
  });

  test('download pipes regular file stream', async () => {
    const req = { query: { path: 'documents/hello.txt' } };
    const res = mockRes();
    await fileManagerController.download(req, res);
    expect(res.headers['Content-Disposition']).toContain('hello.txt');
    expect(res.headers['Content-Length']).toBe(20);
  });

  test('generateDownloadToken and downloadByToken lifecycle', async () => {
    // Missing path -> 400
    const badReq = { body: {} };
    const badRes = mockRes();
    await fileManagerController.generateDownloadToken(badReq, badRes);
    expect(badRes.statusCode).toBe(400);

    // Directory path -> 400
    const dirReq = { body: { path: 'documents' } };
    const dirRes = mockRes();
    await fileManagerController.generateDownloadToken(dirReq, dirRes);
    expect(dirRes.statusCode).toBe(400);

    // Valid file -> generates token
    const req = { body: { path: 'documents/hello.txt' } };
    const res = mockRes();
    await fileManagerController.generateDownloadToken(req, res);
    expect(res.statusCode).toBe(200);
    const token = res.body.data.token;
    expect(token).toBeDefined();

    // downloadByToken with valid token
    const tokenReq = { params: { token } };
    const tokenRes = mockRes();
    await fileManagerController.downloadByToken(tokenReq, tokenRes);
    expect(tokenRes.headers['Content-Disposition']).toContain('hello.txt');

    // downloadByToken with invalid token -> 401
    const invalidReq = { params: { token: 'invalid.token.123' } };
    const invalidRes = mockRes();
    await fileManagerController.downloadByToken(invalidReq, invalidRes);
    expect(invalidRes.statusCode).toBe(401);
  });

  test('zip and unzip archive operations', async () => {
    const zipReq = {
      body: {
        path: 'documents',
        output: 'documents.zip',
      },
    };
    const zipRes = mockRes();
    await fileManagerController.zip(zipReq, zipRes);
    expect(zipRes.statusCode).toBe(200);

    const unzipReq = {
      body: {
        path: 'documents.zip',
        destination: 'extracted',
      },
    };
    const unzipRes = mockRes();
    await fileManagerController.unzip(unzipReq, unzipRes);
    expect(unzipRes.statusCode).toBe(200);

    // Missing path -> 400
    const badUnzip = { body: {} };
    const badUnzipRes = mockRes();
    await fileManagerController.unzip(badUnzip, badUnzipRes);
    expect(badUnzipRes.statusCode).toBe(400);
  });
});
