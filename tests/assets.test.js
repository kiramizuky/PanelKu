import { describe, test, expect } from '@jest/globals';
import {
  getAssetHash,
  isVersionedAsset,
  versionAssetUrls,
  staticCacheMiddleware,
} from '../src/middleware/assets.js';

describe('asset versioning', () => {
  test('exposes a content hash for known public assets', () => {
    const hash = getAssetHash('/js/app.js');
    expect(hash).toMatch(/^[a-f0-9]{12}$/);
    expect(isVersionedAsset('/js/app.js', hash)).toBe(true);
    expect(isVersionedAsset('/js/app.js', 'wrong')).toBe(false);
  });

  test('appends the hash without breaking an existing query string', () => {
    const hash = getAssetHash('/js/app.js');
    const out = versionAssetUrls('<script src="/js/app.js?foo=1"></script>');
    expect(out).toContain(`/js/app.js?foo=1&v=${hash}`);
    expect(versionAssetUrls(out)).toBe(out);
  });

  test('sets immutable caching only for a matching hash', () => {
    const headers = {};
    const res = { setHeader: (name, value) => { headers[name] = value; } };
    const hash = getAssetHash('/js/app.js');

    staticCacheMiddleware({ path: '/js/app.js', query: { v: hash } }, res, () => {});
    expect(headers['Cache-Control']).toBe('public, max-age=31536000, immutable');

    staticCacheMiddleware({ path: '/js/app.js', query: {} }, res, () => {});
    expect(headers['Cache-Control']).toBe('no-cache');
  });
});
