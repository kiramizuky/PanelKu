/**
 * CLI smoke tests. They intentionally exercise only read-only commands so a
 * test run cannot change the local panel database.
 */
import { describe, test, expect } from '@jest/globals';
import { spawnSync } from 'child_process';
import { resolve } from 'path';

const CLI = resolve(process.cwd(), 'bin/panelku.js');
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 20000,
});

describe('panelku CLI', () => {
  test('prints help', () => {
    const res = run('--help');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('panelku status');
    expect(res.stdout).toContain('reset-password');
  });

  test('prints version from package.json', () => {
    const res = run('version');
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('unknown command exits non-zero with usage', () => {
    const res = run('definitely-not-a-command');
    expect(res.status).not.toBe(0);
    expect(res.stderr + res.stdout).toContain('unknown command');
  });
});
