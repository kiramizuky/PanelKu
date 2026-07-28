/**
 * Password Policy Service
 * Manages password policy configuration stored in DB via Setting model.
 * Falls back to appConfig defaults when no DB config exists.
 */
import Setting from '../../models/Setting.js';
import appConfig from '../../config/app.js';
import auditRepository from '../../repositories/audit.repository.js';
import logger from '../../config/logger.js';
import eventBus, { EVENTS } from '../../core/events/EventBus.js';

const SETTING_KEY = 'password_policy';

/**
 * Schema version for exported/imported JSON.
 * Increment when adding new fields or changing validation rules.
 * v1 — initial: minLength, requireUppercase/Lowercase/Number/Special, expiryEnabled, expiryDays, reminderDays
 */
export const SCHEMA_VERSION = 1;

/**
 * Default policy — same as current hardcoded values.
 */
const DEFAULT_POLICY = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  expiryEnabled: appConfig.passwordExpiry.enabled,
  expiryDays: appConfig.passwordExpiry.days,
  reminderDays: 7,
};

class PasswordPolicyService {
  /**
   * Load policy from DB, falling back to appConfig defaults.
   */
  async getPolicy() {
    const raw = await Setting.get(SETTING_KEY);
    if (!raw) {
      return { ...DEFAULT_POLICY };
    }
    // Merge with defaults so new fields are always present
    return { ...DEFAULT_POLICY, ...raw };
  }

  /**
   * Save password policy to DB.
   * @param {object} policy - Partial policy object to merge
   * @param {object} [auditInfo] - Optional user info for audit logging
   */
  async savePolicy(policy, auditInfo) {
    const current = await this.getPolicy();
    const merged = { ...current, ...policy };

    // Validate
    if (typeof merged.minLength !== 'number' || merged.minLength < 6 || merged.minLength > 128) {
      throw Object.assign(new Error('minLength must be between 6 and 128'), { statusCode: 400 });
    }
    if (typeof merged.expiryDays !== 'number' || merged.expiryDays < 1 || merged.expiryDays > 365) {
      throw Object.assign(new Error('expiryDays must be between 1 and 365'), { statusCode: 400 });
    }
    if (typeof merged.reminderDays !== 'number' || merged.reminderDays < 1 || merged.reminderDays > 90) {
      throw Object.assign(new Error('reminderDays must be between 1 and 90'), { statusCode: 400 });
    }

    await Setting.set(SETTING_KEY, merged, 'security');

    // [WS NOTIFICATION] Notify online admins of policy change
    eventBus.publish(EVENTS.PASSWORD_POLICY_CHANGED, {
      action: 'updated',
      username: auditInfo?.username || 'system',
      userId: auditInfo?.userId || null,
      previous: current,
      current: merged,
    });

    // [AUDIT] Log password policy change with before/after values
    if (auditInfo) {
      const details = {
        action: 'Password policy updated',
        previous: { ...current },
        updated: { ...merged },
      };
      auditRepository.log({
        userId:     auditInfo.userId,
        username:   auditInfo.username,
        action:     'PASSWORD_POLICY_UPDATED',
        resource:   'system',
        resourceId: 'password_policy',
        details:    JSON.stringify(details),
        ip:         auditInfo.ip || '',
        userAgent:  auditInfo.userAgent || '',
        status:     'success',
      }).catch((e) => logger.error('Failed to write audit log: ' + e.message));
    }

    return merged;
  }

  /**
   * Reset policy to system defaults.
   * @param {object} [auditInfo] - Optional user info for audit logging
   */
  async resetPolicy(auditInfo) {
    // Capture current policy before resetting for audit trail
    const current = await this.getPolicy();

    // Delete the setting so getPolicy() falls back to defaults
    const setting = await Setting.findOne({ key: SETTING_KEY });
    if (setting) {
      await Setting.findByIdAndDelete(setting._id);
    }

    // [WS NOTIFICATION] Notify online admins of policy reset
    eventBus.publish(EVENTS.PASSWORD_POLICY_CHANGED, {
      action: 'reset',
      username: auditInfo?.username || 'system',
      userId: auditInfo?.userId || null,
      previous: current,
      current: { ...DEFAULT_POLICY },
    });

    // [AUDIT] Log password policy reset with previous values
    if (auditInfo) {
      const details = {
        action: 'Password policy reset to defaults',
        previous: { ...current },
        defaults: { ...DEFAULT_POLICY },
      };
      auditRepository.log({
        userId:     auditInfo.userId,
        username:   auditInfo.username,
        action:     'PASSWORD_POLICY_RESET',
        resource:   'system',
        resourceId: 'password_policy',
        details:    JSON.stringify(details),
        ip:         auditInfo.ip || '',
        userAgent:  auditInfo.userAgent || '',
        status:     'success',
      }).catch((e) => logger.error('Failed to write audit log: ' + e.message));
    }

    return { ...DEFAULT_POLICY };
  }

  /**
   * Fetch password policy JSON from a remote URL and validate schema compatibility.
   * Returns the parsed policy data (with _schema stripped) ready for import.
   * @param {string} url - The source URL to fetch from
   * @returns {Promise<{policy: object, schema: object|null, source: string}>}
   */
  async fetchPolicyFromUrl(url) {
    if (!url || typeof url !== 'string') {
      throw Object.assign(new Error('URL is required'), { statusCode: 400 });
    }

    // Basic URL validation — only allow http/https
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw Object.assign(new Error('Only HTTP and HTTPS URLs are supported'), { statusCode: 400 });
      }
    } catch (e) {
      if (e.statusCode) throw e;
      throw Object.assign(new Error('Invalid URL format'), { statusCode: 400 });
    }

    // SSRF protection — block requests to private/reserved IP ranges
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.localhost')
    ) {
      throw Object.assign(new Error('Requests to local/private addresses are not allowed'), { statusCode: 400 });
    }
    // Check for common private IP patterns (with \d suffix to avoid matching domain names)
    if (/^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.)\d/.test(hostname)) {
      throw Object.assign(new Error('Requests to private network addresses are not allowed'), { statusCode: 400 });
    }

    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED') {
        throw Object.assign(new Error(`Failed to connect to URL: ${e.message}`), { statusCode: 502 });
      }
      throw Object.assign(new Error(`Network error fetching policy: ${e.message}`), { statusCode: 502 });
    }

    if (!response.ok) {
      throw Object.assign(
        new Error(`Server responded with ${response.status} ${response.statusText}`),
        { statusCode: 502 }
      );
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw Object.assign(new Error('Invalid JSON response from URL'), { statusCode: 502 });
    }

    // Validate it looks like a password policy
    if (!data || typeof data !== 'object' || data.minLength === undefined) {
      throw Object.assign(new Error('Response does not contain a valid password policy (missing minLength)'), { statusCode: 502 });
    }

    // Validate schema version
    const schema = data._schema || null;
    if (schema) {
      const fileVersion = parseInt(schema.version) || 0;
      if (fileVersion > SCHEMA_VERSION) {
        throw Object.assign(
          new Error(`Remote policy uses schema v${fileVersion}, which is newer than this panel supports (v${SCHEMA_VERSION}). Please update Panelku first.`),
          { statusCode: 400 }
        );
      }
    }

    return { data, schema, source: url };
  }

  /**
   * Validate a password against the current policy.
   * Returns { valid: boolean, errors: string[] }
   */
  async validatePassword(password) {
    const policy = await this.getPolicy();
    const errors = [];

    if (!password || typeof password !== 'string') {
      return { valid: false, errors: ['Password is required'] };
    }

    if (password.length < policy.minLength) {
      errors.push(`Password must be at least ${policy.minLength} characters`);
    }

    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain an uppercase letter');
    }

    if (policy.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain a lowercase letter');
    }

    if (policy.requireNumber && !/[0-9]/.test(password)) {
      errors.push('Password must contain a number');
    }

    if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
      errors.push('Password must contain a special character');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get human-readable password requirements message.
   */
  async getRequirements() {
    const policy = await this.getPolicy();
    const parts = [];
    parts.push(`at least ${policy.minLength} characters`);
    if (policy.requireUppercase) parts.push('uppercase letter');
    if (policy.requireLowercase) parts.push('lowercase letter');
    if (policy.requireNumber) parts.push('number');
    if (policy.requireSpecial) parts.push('special character');
    return `Password must contain ${parts.join(', ')}.`;
  }

  /**
   * Import policy from a JSON object (replaces entire policy).
   * Validates schema version for forward/backward compatibility.
   * @param {object} data - The full policy object from JSON (may include _schema)
   * @param {object} [auditInfo] - Optional user info for audit logging
   * @returns {Promise<object>} The saved policy
   */
  async importPolicy(data, auditInfo) {
    // Validate that all required fields exist
    if (!data || typeof data !== 'object') {
      throw Object.assign(new Error('Invalid JSON: expected an object'), { statusCode: 400 });
    }

    // ── Schema version validation ────────────────────────────────
    const schema = data._schema;
    if (schema) {
      const fileVersion = parseInt(schema.version) || 0;
      if (fileVersion > SCHEMA_VERSION) {
        throw Object.assign(
          new Error(`Cannot import: policy schema v${fileVersion} is newer than this panel supports (v${SCHEMA_VERSION}). Please update Panelku before importing.`),
          { statusCode: 400 }
        );
      }
      if (fileVersion < SCHEMA_VERSION) {
        logger.info(`Importing policy from older schema v${fileVersion} → current v${SCHEMA_VERSION}. Missing fields will use defaults.`);
      }
    } else {
      logger.info('Importing policy without _schema field — assuming v1 compatibility.');
    }

    // Strip _schema metadata before processing policy fields
    const { _schema, ...policyData } = data;

    // ── Build full policy ────────────────────────────────────────
    const policy = { ...DEFAULT_POLICY };

    // Override with provided values, with type coercion
    if (policyData.minLength !== undefined) policy.minLength = Number(policyData.minLength);
    if (policyData.expiryDays !== undefined) policy.expiryDays = Number(policyData.expiryDays);
    if (policyData.reminderDays !== undefined) policy.reminderDays = Number(policyData.reminderDays);
    if (policyData.requireUppercase !== undefined) policy.requireUppercase = Boolean(policyData.requireUppercase);
    if (policyData.requireLowercase !== undefined) policy.requireLowercase = Boolean(policyData.requireLowercase);
    if (policyData.requireNumber !== undefined) policy.requireNumber = Boolean(policyData.requireNumber);
    if (policyData.requireSpecial !== undefined) policy.requireSpecial = Boolean(policyData.requireSpecial);
    if (policyData.expiryEnabled !== undefined) policy.expiryEnabled = Boolean(policyData.expiryEnabled);

    // Validate ranges
    if (policy.minLength < 6 || policy.minLength > 128 || isNaN(policy.minLength)) {
      throw Object.assign(new Error('minLength must be between 6 and 128'), { statusCode: 400 });
    }
    if (policy.expiryDays < 1 || policy.expiryDays > 365 || isNaN(policy.expiryDays)) {
      throw Object.assign(new Error('expiryDays must be between 1 and 365'), { statusCode: 400 });
    }
    if (policy.reminderDays < 1 || policy.reminderDays > 90 || isNaN(policy.reminderDays)) {
      throw Object.assign(new Error('reminderDays must be between 1 and 90'), { statusCode: 400 });
    }

    await Setting.set(SETTING_KEY, policy, 'security');

    // [WS NOTIFICATION] Notify online admins of policy import
    eventBus.publish(EVENTS.PASSWORD_POLICY_CHANGED, {
      action: 'imported',
      username: auditInfo?.username || 'system',
      userId: auditInfo?.userId || null,
      source: auditInfo?.source || 'JSON file',
    });

    // [AUDIT] Log policy import
    if (auditInfo) {
      const details = {
        action: 'Password policy imported from JSON',
        schemaVersion: schema ? schema.version : 'none',
        imported: { ...policy },
      };
      auditRepository.log({
        userId:     auditInfo.userId,
        username:   auditInfo.username,
        action:     'PASSWORD_POLICY_IMPORTED',
        resource:   'system',
        resourceId: 'password_policy',
        details:    JSON.stringify(details),
        ip:         auditInfo.ip || '',
        userAgent:  auditInfo.userAgent || '',
        status:     'success',
      }).catch((e) => logger.error('Failed to write audit log: ' + e.message));
    }

    return policy;
  }
}

const passwordPolicyService = new PasswordPolicyService();
export default passwordPolicyService;
