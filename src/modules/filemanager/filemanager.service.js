import { readdir, stat, rename, rm, mkdir, copyFile, writeFile, readFile } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { join, resolve, resolve as resolveUnzip, basename, extname, dirname, sep } from 'path';
import archiver from 'archiver';
import unzipper from 'unzipper';
import logger from '../../config/logger.js';

// Base directory — restrict all operations to this root
const BASE_DIR = process.env.FM_BASE_DIR || '/';

class FileManagerService {
  constructor() {
    this.uidMap = {};
    this.gidMap = {};
    this.mapsInitialized = false;
  }

  async initMaps() {
    if (this.mapsInitialized) return;
    try {
      if (process.platform !== 'win32') {
        const passwd = await readFile('/etc/passwd', 'utf8').catch(() => '');
        if (passwd) {
          passwd.split('\n').forEach(line => {
            const parts = line.split(':');
            if (parts.length >= 3) {
              this.uidMap[parts[2]] = parts[0];
            }
          });
        }
        const group = await readFile('/etc/group', 'utf8').catch(() => '');
        if (group) {
          group.split('\n').forEach(line => {
            const parts = line.split(':');
            if (parts.length >= 3) {
              this.gidMap[parts[2]] = parts[0];
            }
          });
        }
      }
    } catch (e) {
      logger.error('Failed to init file owner maps: ' + e.message);
    }
    this.mapsInitialized = true;
  }

  async getOwnerString(uid, gid) {
    await this.initMaps();
    const user = this.uidMap[uid] || uid || 'root';
    const group = this.gidMap[gid] || gid || 'root';
    return `${user}:${group}`;
  }

  _resolvePath(userPath) {
    const resolvedBase = resolve(BASE_DIR);
    const safe = resolve(join(BASE_DIR, userPath || '/'));

    // [MED-2 FIX] Always check path traversal, even when BASE_DIR is '/'.
    // Without this, BASE_DIR='/' would skip the check entirely, allowing
    // traversal to any path on the filesystem.
    if (!safe.startsWith(resolvedBase + (resolvedBase.endsWith('/') || resolvedBase.endsWith('\\') ? '' : sep))
        && safe !== resolvedBase) {
      throw Object.assign(new Error('Path traversal detected'), { statusCode: 403 });
    }
    return safe;
  }

  async list(dirPath) {
    const full = this._resolvePath(dirPath);
    const entries = await readdir(full, { withFileTypes: true });

    const items = await Promise.all(
      entries.map(async (entry) => {
        const filePath = join(full, entry.name);
        let stats;
        try { stats = await stat(filePath); } catch { return null; }
        
        const owner = await this.getOwnerString(stats.uid, stats.gid);

        return {
          name: entry.name,
          path: join(dirPath, entry.name).replace(/\\/g, '/'),
          type: entry.isDirectory() ? 'dir' : 'file',
          size: stats.size,
          modified: stats.mtime,
          permissions: stats.mode.toString(8).slice(-3),
          owner: owner,
          isHidden: entry.name.startsWith('.'),
        };
      })
    );

    return items.filter(Boolean).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async getInfo(filePath) {
    const full = this._resolvePath(filePath);
    const stats = await stat(full);
    return {
      name: basename(full),
      path: filePath,
      size: stats.size,
      modified: stats.mtime,
      created: stats.birthtime,
      permissions: stats.mode.toString(8).slice(-3),
      isDirectory: stats.isDirectory(),
    };
  }

  async readFile(filePath) {
    const full = this._resolvePath(filePath);
    const stats = await stat(full);
    if (stats.size > 5 * 1024 * 1024) throw new Error('File too large to view (max 5MB)');
    return readFile(full, 'utf8');
  }

  async writeFile(filePath, content) {
    const full = this._resolvePath(filePath);
    await writeFile(full, content, 'utf8');
  }

  async rename(oldPath, newName) {
    // [MED-4 FIX] Validate that newName does not escape BASE_DIR via traversal
    if (!newName || typeof newName !== 'string' || newName.includes('/') || newName.includes('\\')) {
      throw Object.assign(new Error('Invalid file name: must not contain path separators'), { statusCode: 400 });
    }
    const oldFull = this._resolvePath(oldPath);
    // Compute newFull relative to the parent of oldPath (not full) to stay within _resolvePath guard
    const parentRelative = join(dirname(oldPath), newName);
    const newFull = this._resolvePath(parentRelative);
    await rename(oldFull, newFull);
  }

  async move(sourcePath, destPath) {
    const src = this._resolvePath(sourcePath);
    const dest = this._resolvePath(destPath);
    await rename(src, dest);
  }

  async copy(sourcePath, destPath) {
    const src = this._resolvePath(sourcePath);
    const dest = this._resolvePath(destPath);
    await copyFile(src, dest);
  }

  async delete(targetPath) {
    const full = this._resolvePath(targetPath);
    await rm(full, { recursive: true, force: true });
  }

  async mkdir(dirPath) {
    const full = this._resolvePath(dirPath);
    await mkdir(full, { recursive: true });
  }

  async zip(targetPath, outputPath) {
    const src = this._resolvePath(targetPath);
    const out = this._resolvePath(outputPath);
    return new Promise((resolve, reject) => {
      const output = createWriteStream(out);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.glob('**', { cwd: src, ignore: [] });
      archive.finalize();
    });
  }

  async unzip(zipPath, destDir) {
    const src = this._resolvePath(zipPath);
    const dest = this._resolvePath(destDir);
    await mkdir(dest, { recursive: true });

    // [CRIT-2 FIX] Manually parse ZIP entries to validate each entry path.
    // unzipper.Extract({ path }) does NOT check entry names — vulnerable to Zip Slip.
    // We resolve each entry's full path and ensure it stays inside dest.
    return new Promise((resolve, reject) => {
      createReadStream(src)
        .pipe(unzipper.Parse())
        .on('entry', async (entry) => {
          const entryPath = entry.path;
          // Normalize and validate entry path against dest directory
          let entryFull;
          try {
            entryFull = resolveUnzip(join(dest, entryPath));
          } catch {
            entry.autodrain(); // Skip malformed entries
            return;
          }
          // [CRIT-2 FIX] Core check: resolved path must start with destDir
          if (!entryFull.startsWith(dest + sep) && entryFull !== dest) {
            logger.warn(`[Zip Slip Blocked] Entry '${entryPath}' resolved outside dest: ${entryFull}`);
            entry.autodrain(); // Discard this malicious entry
            return;
          }
          if (entry.type === 'Directory') {
            await mkdir(entryFull, { recursive: true }).catch(() => {});
            entry.autodrain();
          } else {
            await mkdir(dirname(entryFull), { recursive: true }).catch(() => {});
            entry.pipe(createWriteStream(entryFull));
          }
        })
        .on('close', resolve)
        .on('error', reject);
    });
  }

  /**
   * Search files matching name pattern within a directory.
   */
  async search(dirPath, query, maxResults = 100) {
    const full = this._resolvePath(dirPath);
    const results = [];
    await this._searchRecursive(full, dirPath, query.toLowerCase(), results, maxResults);
    return results;
  }

  async _searchRecursive(fullPath, relPath, query, results, maxResults) {
    if (results.length >= maxResults) return;
    let entries;
    try { entries = await readdir(fullPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (entry.name.toLowerCase().includes(query)) {
        results.push({
          name: entry.name,
          path: join(relPath, entry.name).replace(/\\/g, '/'),
          type: entry.isDirectory() ? 'dir' : 'file',
        });
      }
      if (entry.isDirectory()) {
        await this._searchRecursive(
          join(fullPath, entry.name),
          join(relPath, entry.name),
          query, results, maxResults
        );
      }
    }
  }
}

const fileManagerService = new FileManagerService();
export default fileManagerService;
