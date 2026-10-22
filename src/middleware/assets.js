/**
 * Static asset versioning.
 *
 * Assets are served with a content hash in the query string (for example
 * `/js/app.js?v=4f2a1c9d`). Because the URL changes whenever the file changes,
 * the browser can safely cache it as immutable for a year. HTML itself is never
 * marked immutable.
 *
 * This module builds a small in-memory manifest at boot. The manifest is also
 * used to rewrite local `src`/`href` references in rendered HTML, so views do
 * not need to call a helper manually.
 */
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { dirname, extname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'public');

const VERSIONABLE_EXTENSIONS = new Set([
  '.js', '.mjs', '.css', '.map', '.png', '.jpg', '.jpeg', '.gif', '.svg',
  '.ico', '.webp', '.woff', '.woff2', '.ttf', '.eot', '.json',
]);

const assetHashes = new Map();

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(full));
    else if (entry.isFile() && VERSIONABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

for (const file of collectFiles(PUBLIC_DIR)) {
  const urlPath = '/' + relative(PUBLIC_DIR, file).split('\\').join('/');
  try {
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
    assetHashes.set(urlPath, hash);
  } catch {
    // A file may disappear while the manifest is being built (dev hot reload).
  }
}

export const getAssetHash = (urlPath) => assetHashes.get(urlPath) || null;

export const isVersionedAsset = (urlPath, version) => {
  const hash = getAssetHash(urlPath);
  return Boolean(hash && version && hash === version);
};

const ASSET_PATH_RE = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|json)$/i;

/**
 * Express middleware placed before express.static().
 * - Correct hash in `?v=` -> immutable one-year cache.
 * - Anything else -> revalidate (HTML + unversioned/unknown URLs).
 */
export const staticCacheMiddleware = (req, res, next) => {
  try {
    const pathname = decodeURIComponent(req.path);
    if (!ASSET_PATH_RE.test(pathname)) return next();

    if (isVersionedAsset(pathname, String(req.query.v || ''))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  } catch {
    res.setHeader('Cache-Control', 'no-cache');
  }
  return next();
};

const LOCAL_ASSET_REF_RE = /(\s(?:src|href)=["'])(\/(?:js|css|images|img|public|fonts|favicon)[^"'?#]*)([^"']*)(["'])/gi;

export const assetUrl = (pathname) => {
  const hash = getAssetHash(pathname);
  return hash ? `${pathname}?v=${hash}` : pathname;
};

/**
 * Add `?v=<content-hash>` to local asset references in rendered HTML.
 * Existing query parameters are preserved; already-versioned URLs are skipped.
 */
export const versionAssetUrls = (html) => {
  if (typeof html !== 'string' || !html.includes('<')) return html;
  return html.replace(LOCAL_ASSET_REF_RE, (match, prefix, pathname, suffix, quote) => {
    const hash = getAssetHash(pathname);
    if (!hash || /(?:^|[?&])v=/.test(suffix)) return match;
    if (suffix.startsWith('?')) {
      return `${prefix}${pathname}${suffix}&v=${hash}${quote}`;
    }
    return `${prefix}${pathname}?v=${hash}${suffix}${quote}`;
  });
};

export default {
  getAssetHash,
  isVersionedAsset,
  staticCacheMiddleware,
  assetUrl,
  versionAssetUrls,
};
