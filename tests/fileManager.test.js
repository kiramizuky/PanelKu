/**
 * FileManager Module Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import fileManagerService from '../src/modules/filemanager/filemanager.service.js';
import fileManagerController from '../src/modules/filemanager/filemanager.controller.js';

let testBaseDir;

beforeAll(async () => {
  testBaseDir = path.join(os.tmpdir(), `panelku-fm-test-${Date.now()}`);
  await fs.mkdir(testBaseDir, { recursive: true });
  process.env.FM_BASE_DIR = testBaseDir;
});

afterAll(async () => {
  try {
    await fs.rm(testBaseDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe('FileManager Service', () => {
  test('blocks path traversal attempts outside FM_BASE_DIR', () => {
    expect(() => fileManagerService._resolvePath('../../etc/passwd')).toThrow('Path traversal detected');
    expect(() => fileManagerService._resolvePath('../')).toThrow('Path traversal detected');
  });

  test('creates directory, writes file, reads file, and lists directory', async () => {
    await fileManagerService.mkdir('documents');
    await fileManagerService.writeFile('documents/note.txt', 'Hello Panelku');

    const content = await fileManagerService.readFile('documents/note.txt');
    expect(content).toBe('Hello Panelku');

    const list = await fileManagerService.list('documents');
    expect(Array.isArray(list)).toBe(true);
    expect(list.some(item => item.name === 'note.txt' && item.type === 'file')).toBe(true);

    const info = await fileManagerService.getInfo('documents/note.txt');
    expect(info).toBeDefined();
    expect(info.name).toBe('note.txt');
    expect(info.size).toBe(13);
  });

  test('renames and deletes items', async () => {
    await fileManagerService.writeFile('to_rename.txt', 'temp');
    await fileManagerService.rename('to_rename.txt', 'renamed.txt');

    const content = await fileManagerService.readFile('renamed.txt');
    expect(content).toBe('temp');

    await fileManagerService.delete('renamed.txt');
    await expect(fileManagerService.readFile('renamed.txt')).rejects.toThrow();
  });
});

describe('FileManager Controller', () => {
  function mockRes() {
    return {
      statusCode: 200,
      body: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(d) {
        this.body = d;
        return this;
      },
    };
  }

  test('list returns HTTP 200 with directory items', async () => {
    const res = mockRes();
    await fileManagerController.list({ query: { path: '/' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  test('writeFile and readFile return HTTP 200', async () => {
    const writeRes = mockRes();
    await fileManagerController.writeFile({ body: { path: 'api_test.txt', content: 'from api' } }, writeRes);
    expect(writeRes.statusCode).toBe(200);
    expect(writeRes.body.success).toBe(true);

    const readRes = mockRes();
    await fileManagerController.readFile({ query: { path: 'api_test.txt' } }, readRes);
    expect(readRes.statusCode).toBe(200);
    expect(readRes.body.data.content).toBe('from api');
  });

  test('path traversal in controller returns 403 error', async () => {
    const res = mockRes();
    await fileManagerController.readFile({ query: { path: '../../sensitive' } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
