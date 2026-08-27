import { readdir, stat, rename, rm, mkdir, copyFile, writeFile, readFile } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { join, resolve, resolve as resolveUnzip, basename, dirname, sep } from 'path';
import { execFile } from 'child_process';
import archiver from 'archiver';
import unzipper from 'unzipper';
import logger from '../../config/logger.js';

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

  _getBaseDir() {
    return process.env.FM_BASE_DIR || '/';
  }

  _resolvePath(userPath) {
    const baseDir = this._getBaseDir();
    const resolvedBase = resolve(baseDir);
    const safe = resolve(join(baseDir, userPath || '/'));

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
    const targetDest = destDir || dirname(zipPath) || '/';
    const src = this._resolvePath(zipPath);
    const dest = this._resolvePath(targetDest);
    await mkdir(dest, { recursive: true });

    const lowerPath = zipPath.toLowerCase();

    // Check if it is tar, gz, bz2, xz, tgz, tbz2, txz
    if (lowerPath.endsWith('.tar.gz') || lowerPath.endsWith('.tgz') ||
        lowerPath.endsWith('.tar.bz2') || lowerPath.endsWith('.tbz2') ||
        lowerPath.endsWith('.tar.xz') || lowerPath.endsWith('.txz') ||
        lowerPath.endsWith('.tar')) {
      return new Promise((resolvePromise, rejectPromise) => {
        execFile('tar', ['-xf', src, '-C', dest], (err, _stdout, stderr) => {
          if (err) {
            return rejectPromise(new Error(`Failed to extract tar archive: ${stderr || err.message}`));
          }
          resolvePromise();
        });
      });
    }

    if (lowerPath.endsWith('.rar')) {
      return new Promise((resolvePromise, rejectPromise) => {
        execFile('unrar', ['x', '-o+', '-y', src, dest + '/'], (err, _stdout, stderr) => {
          if (err) {
            return rejectPromise(new Error(`Failed to extract RAR: ${stderr || err.message}. Make sure 'unrar' is installed.`));
          }
          resolvePromise();
        });
      });
    }

    if (lowerPath.endsWith('.7z')) {
      return new Promise((resolvePromise, rejectPromise) => {
        execFile('7z', ['x', '-y', `-o${dest}`, src], (err, _stdout, stderr) => {
          if (err) {
            return rejectPromise(new Error(`Failed to extract 7z: ${stderr || err.message}. Make sure 'p7zip' or '7z' is installed.`));
          }
          resolvePromise();
        });
      });
    }

    // Default: ZIP extraction with Zip Slip protection
    const entries = createReadStream(src).pipe(unzipper.Parse({ forceStream: true }));
    for await (const entry of entries) {
      const entryPath = entry.path;
      // Normalize and validate entry path against dest directory
      let entryFull;
      try {
        entryFull = resolveUnzip(join(dest, entryPath));
      } catch {
        entry.autodrain(); // Skip malformed entries
        continue;
      }
      // [CRIT-2 FIX] Core check: resolved path must start with destDir
      if (!entryFull.startsWith(dest + sep) && entryFull !== dest) {
        logger.warn(`[Zip Slip Blocked] Entry '${entryPath}' resolved outside dest: ${entryFull}`);
        entry.autodrain(); // Discard this malicious entry
        continue;
      }
      if (entry.type === 'Directory') {
        await mkdir(entryFull, { recursive: true }).catch(() => {});
        entry.autodrain();
      } else {
        await mkdir(dirname(entryFull), { recursive: true }).catch(() => {});
        await new Promise((resEntry, rejEntry) => {
          const ws = createWriteStream(entryFull);
          entry.pipe(ws);
          ws.on('finish', resEntry);
          ws.on('error', rejEntry);
          entry.on('error', rejEntry);
        });
      }
    }
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

  /**
   * Save an uploaded file from temp storage to target directory.
   */
  async saveUploadedFile(tempPath, targetDir, originalName) {
    const safeName = basename(originalName).replace(/[\r\n\0]/g, '');
    if (!safeName || safeName === '.' || safeName === '..') {
      throw Object.assign(new Error('Invalid file name'), { statusCode: 400 });
    }

    const resolvedDir = this._resolvePath(targetDir);
    const dirStats = await stat(resolvedDir).catch(() => null);
    if (!dirStats || !dirStats.isDirectory()) {
      throw Object.assign(new Error('Target directory does not exist'), { statusCode: 400 });
    }

    const targetRelative = join(targetDir, safeName);
    const fullDest = this._resolvePath(targetRelative);

    try {
      await rename(tempPath, fullDest);
    } catch (err) {
      if (err.code === 'EXDEV') {
        await copyFile(tempPath, fullDest);
        await rm(tempPath, { force: true });
      } else {
        throw err;
      }
    }

    return {
      name: safeName,
      path: targetRelative.replace(/\\/g, '/'),
    };
  }
}

const fileManagerService = new FileManagerService();
export default fileManagerService;
