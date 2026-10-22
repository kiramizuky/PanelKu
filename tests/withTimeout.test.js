/**
 * Tests for bounded systeminformation probes.
 */
import { describe, test, expect } from '@jest/globals';
import { withTimeout, siCall } from '../src/helpers/withTimeout.js';

describe('withTimeout', () => {
  test('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100, 'fast')).resolves.toBe('ok');
  });

  test('rejects with ETIMEDOUT when the probe hangs', async () => {
    let timer;
    const never = new Promise((resolve) => { timer = setTimeout(resolve, 5000); });
    await expect(withTimeout(never, 25, 'slow probe')).rejects.toMatchObject({
      code: 'ETIMEDOUT',
      label: 'slow probe',
    });
    clearTimeout(timer);
  });

  test('siCall wraps synchronous throws into a rejection', async () => {
    await expect(siCall(() => { throw new Error('boom'); }, 'sync')).rejects.toThrow('boom');
  });
});
