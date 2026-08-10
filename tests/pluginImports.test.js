/**
 * Plugin import check — regression guard
 *
 * Runs scripts/check-plugin-imports.mjs against the real tree and asserts it
 * exits 0 (every relative import inside plugins/ resolves). This is the same
 * script wired into CI; the test makes the guard run in the local suite too.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { execFileSync } from 'child_process';
import { resolve } from 'path';

// The script is anchored to its own file location, so cwd is irrelevant.
const script = resolve('scripts/check-plugin-imports.mjs');

describe('check-plugin-imports script', () => {
  test('all plugin imports resolve (exit 0)', () => {
    let output = '';
    let code = 0;
    try {
      output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    } catch (err) {
      code = err.status ?? 1;
      output = err.stdout ? String(err.stdout) : '';
    }
    expect(code).toBe(0);
    expect(output).toContain('All plugin imports resolve');
  });
});
