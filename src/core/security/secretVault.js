import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import logger from '../../config/logger.js';
import { getStorageDir } from '../../config/paths.js';
import Setting from '../../models/Setting.js';

const PREFIX = 'vault:v1:';
const SETTING_PREFIX = 'vault_secret:';

class SecretVault {
  constructor() {
    this._cachedKey = null;
  }

  /**
   * Resolve a 32-byte AES-256-GCM key completely separate from APP_SECRET.
   * Priority: VAULT_MASTER_KEY env -> storage/.vault.key (auto-generated 0o600).
   */
  getMasterKey() {
    if (this._cachedKey) return this._cachedKey;

    if (process.env.VAULT_MASTER_KEY) {
      this._cachedKey = crypto.createHash('sha256').update(process.env.VAULT_MASTER_KEY).digest();
      return this._cachedKey;
    }

    const keyPath = path.join(getStorageDir(), '.vault.key');
    try {
      if (fs.existsSync(keyPath)) {
        const hex = fs.readFileSync(keyPath, 'utf8').trim();
        if (/^[a-fA-F0-9]{64}$/.test(hex)) {
          this._cachedKey = Buffer.from(hex, 'hex');
          return this._cachedKey;
        }
      }
      const key = crypto.randomBytes(32);
      fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o750 });
      fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
      this._cachedKey = key;
      return this._cachedKey;
    } catch (err) {
      logger.warn(`Vault key fallback to ephemeral key: ${err.message}`);
      this._cachedKey = crypto.randomBytes(32);
      return this._cachedKey;
    }
  }

  isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) return plaintext;
    const str = String(plaintext);
    if (this.isEncrypted(str)) return str;

    const key = this.getMasterKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(payload) {
    if (payload === null || payload === undefined) return payload;
    const str = String(payload);
    if (!this.isEncrypted(str)) return str; // Backwards-compatible with legacy plaintext

    const parts = str.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed vault ciphertext');
    }

    const [ivB64, tagB64, dataB64] = parts;
    const key = this.getMasterKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return decrypted.toString('utf8');
  }

  _validateName(name) {
    if (!/^[A-Z0-9_]{2,64}$/i.test(String(name || ''))) {
      throw new Error('Secret name must be 2-64 alphanumeric/underscore characters');
    }
    return String(name).toUpperCase();
  }

  async setSecret(name, plaintext) {
    const cleanName = this._validateName(name);
    if (typeof plaintext !== 'string' || !plaintext.length) {
      throw new Error('Secret value must be a non-empty string');
    }
    const encrypted = this.encrypt(plaintext);
    await Setting.set(`${SETTING_PREFIX}${cleanName}`, encrypted, 'string');
    return { name: cleanName, encrypted: true };
  }

  async getSecret(name) {
    const cleanName = this._validateName(name);
    const stored = await Setting.get(`${SETTING_PREFIX}${cleanName}`);
    if (!stored) return null;
    return this.decrypt(stored);
  }

  async deleteSecret(name) {
    const cleanName = this._validateName(name);
    const { getDb } = await import('../db/sqlite.js');
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(`${SETTING_PREFIX}${cleanName}`);
    return { deleted: true, name: cleanName };
  }

  async listSecrets() {
    const { getDb } = await import('../db/sqlite.js');
    const rows = getDb()
      .prepare('SELECT key, updated_at FROM settings WHERE key LIKE ? ORDER BY key ASC')
      .all(`${SETTING_PREFIX}%`);
    return rows.map((r) => ({
      name: r.key.slice(SETTING_PREFIX.length),
      updatedAt: r.updated_at,
      encrypted: true,
    }));
  }

  /**
   * Resolve ${VAULT:NAME} or vault://NAME placeholders in Docker Compose YAML
   * into an ephemeral in-memory envMap without writing plaintext secrets to .env on disk.
   */
  async resolveComposeSecrets(composeYaml, baseEnv = {}) {
    const envMap = { ...baseEnv };
    const referenced = new Set();
    const regex = /\$\{VAULT:([A-Z0-9_]{2,64})\}|vault:\/\/([A-Z0-9_]{2,64})/gi;

    let match;
    while ((match = regex.exec(composeYaml || '')) !== null) {
      referenced.add((match[1] || match[2]).toUpperCase());
    }

    for (const secretName of referenced) {
      const val = await this.getSecret(secretName);
      if (val !== null) {
        envMap[secretName] = val;
      }
    }

    const resolvedYaml = (composeYaml || '').replace(
      /\$\{VAULT:([A-Z0-9_]{2,64})\}|vault:\/\/([A-Z0-9_]{2,64})/gi,
      (full, g1, g2) => {
        const key = (g1 || g2).toUpperCase();
        return envMap[key] !== undefined ? `\${${key}}` : full;
      }
    );

    return {
      resolvedYaml,
      envMap,
      injectedKeys: [...referenced].filter((k) => envMap[k] !== undefined),
    };
  }

  /**
   * Default hardened container security profile (non-root / unprivileged capabilities).
   */
  getRootlessContainerDefaults() {
    return {
      SecurityOpt: ['no-new-privileges:true'],
      CapDrop: ['ALL'],
      ReadonlyRootfs: false,
    };
  }
}

export default new SecretVault();
