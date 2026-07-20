import crypto from 'crypto';
import Setting from '../../models/Setting.js';
import userRepository from '../../repositories/user.repository.js';
import roleRepository from '../../repositories/role.repository.js';
import logger from '../../config/logger.js';

/**
 * LDAP/AD Authentication Service.
 * Allows users to authenticate against an LDAP directory (OpenLDAP, AD, etc.).
 * Config stored in settings database.
 */

class LDAPService {
  /**
   * Get LDAP config from settings.
   */
  async getConfig() {
    const raw = await Setting.get('ldap_config') || '{}';
    const config = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    return {
      enabled: !!config.enabled,
      url: config.url || '',
      bindDn: config.bindDn || '',
      bindPassword: config.bindPassword || '',
      baseDn: config.baseDn || '',
      userFilter: config.userFilter || '(uid={{username}})',
      usernameAttribute: config.usernameAttribute || 'uid',
      emailAttribute: config.emailAttribute || 'mail',
      firstNameAttribute: config.firstNameAttribute || 'givenName',
      lastNameAttribute: config.lastNameAttribute || 'sn',
      displayNameAttribute: config.displayNameAttribute || 'displayName',
      defaultRole: config.defaultRole || 'read_only',
      autoCreate: config.autoCreate !== false,
      tls: !!config.tls,
    };
  }

  /**
   * Save LDAP config.
   */
  async saveConfig(data) {
    const config = {
      enabled: !!data.enabled,
      url: data.url?.trim() || '',
      bindDn: data.bindDn?.trim() || '',
      bindPassword: data.bindPassword || '',
      baseDn: data.baseDn?.trim() || '',
      userFilter: data.userFilter?.trim() || '(uid={{username}})',
      usernameAttribute: data.usernameAttribute?.trim() || 'uid',
      emailAttribute: data.emailAttribute?.trim() || 'mail',
      firstNameAttribute: data.firstNameAttribute?.trim() || 'givenName',
      lastNameAttribute: data.lastNameAttribute?.trim() || 'sn',
      displayNameAttribute: data.displayNameAttribute?.trim() || 'displayName',
      defaultRole: data.defaultRole?.trim() || 'read_only',
      autoCreate: data.autoCreate !== false,
      tls: !!data.tls,
    };

    await Setting.set('ldap_config', JSON.stringify(config), 'json');
    return { message: 'LDAP configuration saved' };
  }

  /**
   * Authenticate a user against LDAP.
   * Steps:
   * 1. Bind with service account
   * 2. Search for user by username
   * 3. Attempt to bind as the found user DN with provided password
   * 4. Return user profile
   */
  async authenticate(username, password) {
    if (!username || !password) {
      throw Object.assign(new Error('Username and password are required'), { statusCode: 400 });
    }

    const config = await this.getConfig();
    if (!config.enabled || !config.url) {
      throw Object.assign(new Error('LDAP is not configured'), { statusCode: 400 });
    }

    // Dynamic import of ldapjs
    let ldap;
    try {
      ldap = await import('ldapjs');
    } catch {
      throw new Error('ldapjs package is not installed. Run: npm install ldapjs');
    }
    // ldapjs v3+ wraps exports in a default object
    const ldapClient = ldap.default?.createClient || ldap.createClient;
    if (!ldapClient) throw new Error('ldapjs createClient not found. Try: npm install ldapjs@2');

    return new Promise((resolve, reject) => {
      const client = ldapClient({
        url: config.url,
        tlsOptions: config.tls ? {} : { rejectUnauthorized: false },
        timeout: 10000,
        connectTimeout: 10000,
      });

      const errors = [];

      client.on('error', (err) => {
        errors.push(err.message);
      });

      // Step 1: Bind with service account
      client.bind(config.bindDn, config.bindPassword, (bindErr) => {
        if (bindErr) {
          client.unbind();
          return reject(new Error(`LDAP bind failed: ${bindErr.message}`));
        }

        // Step 2: Search for user
        const searchFilter = config.userFilter.replace(/{{username}}/g, username);
        const searchOptions = {
          scope: 'sub',
          filter: searchFilter,
          attributes: [
            config.usernameAttribute,
            config.emailAttribute,
            config.firstNameAttribute,
            config.lastNameAttribute,
            config.displayNameAttribute,
            'dn',
          ],
          timeLimit: 10,
        };

        client.search(config.baseDn, searchOptions, (searchErr, res) => {
          if (searchErr) {
            client.unbind();
            return reject(new Error(`LDAP search failed: ${searchErr.message}`));
          }

          let userEntry = null;

          res.on('searchEntry', (entry) => {
            userEntry = entry;
          });

          res.on('error', (err) => {
            errors.push(err.message);
          });

          res.on('end', (result) => {
            if (result?.status !== 0) {
              client.unbind();
              return reject(new Error(`LDAP search ended with status ${result?.status}`));
            }

            if (!userEntry) {
              client.unbind();
              return reject(Object.assign(new Error('User not found in LDAP directory'), { statusCode: 404 }));
            }

            const userDn = userEntry.dn;
            const attributes = userEntry.attributes || [];

            // Helper to get attribute
            const getAttr = (name) => {
              const attr = attributes.find(a => a.type?.toLowerCase() === name.toLowerCase() || a.name === name);
              if (attr && attr.values && attr.values.length > 0) return attr.values[0];
              // Also check object-style
              if (userEntry.object && userEntry.object[name]) return userEntry.object[name];
              return null;
            };

            // Step 3: Verify user password by binding as the user
            client.bind(userDn, password, (authErr) => {
              client.unbind();

              if (authErr) {
                return reject(Object.assign(new Error('Invalid LDAP credentials'), { statusCode: 401 }));
              }

              // Step 4: Build user profile
              const profile = {
                username: getAttr(config.usernameAttribute) || username,
                email: getAttr(config.emailAttribute) || `${username}@ldap.local`,
                firstName: getAttr(config.firstNameAttribute) || '',
                lastName: getAttr(config.lastNameAttribute) || '',
                displayName: getAttr(config.displayNameAttribute) || username,
                dn: userDn,
              };

              resolve(profile);
            });
          });
        });
      });
    });
  }

  /**
   * Find or create a local user based on LDAP profile.
   */
  async findOrCreateUser(ldapProfile) {
    // Try to find existing user by email or username
    let user;
    try {
      user = await userRepository.findByEmail(ldapProfile.email);
    } catch { /* ignore */ }

    if (!user) {
      try {
        user = await userRepository.findByUsername(ldapProfile.username);
      } catch { /* ignore */ }
    }

    if (user) {
      return user;
    }

    // Auto-create if configured
    const config = await this.getConfig();
    if (!config.autoCreate) {
      throw Object.assign(new Error('User not found locally. LDAP auto-creation is disabled.'), { statusCode: 404 });
    }

    const defaultRole = await roleRepository.findBySlug(config.defaultRole);
    if (!defaultRole) throw new Error('Default role not found');

    // Generate a random password (LDAP users authenticate via LDAP, not local password)
      const randomPass = crypto.randomBytes(24).toString('hex');

    user = await userRepository.create({
      username: ldapProfile.username,
      email: ldapProfile.email,
      password: randomPass,
      firstName: ldapProfile.firstName || '',
      lastName: ldapProfile.lastName || '',
      role: defaultRole._id,
      isActive: true,
      isLdapUser: true,
    });

    logger.info(`LDAP: Auto-created user "${user.username}" from directory`);
    return user;
  }

  /**
   * Test LDAP connection and search.
   */
  async testConnection() {
    const config = await this.getConfig();

    if (!config.url) {
      throw new Error('LDAP URL is not configured');
    }

    let ldap;
    try {
      ldap = await import('ldapjs');
    } catch {
      throw new Error('ldapjs package is not installed. Run: npm install ldapjs');
    }
    const ldapClient = ldap.default?.createClient || ldap.createClient;
    if (!ldapClient) throw new Error('ldapjs createClient not found. Try: npm install ldapjs@2');

    return new Promise((resolve, reject) => {
      const client = ldapClient({
        url: config.url,
        tlsOptions: config.tls ? {} : { rejectUnauthorized: false },
        timeout: 10000,
        connectTimeout: 10000,
      });

      client.on('connectRefused', () => {
        reject(new Error('Connection refused'));
      });
      client.on('connectTimeout', () => {
        reject(new Error('Connection timed out'));
      });

      client.bind(config.bindDn, config.bindPassword, (err) => {
        if (err) {
          client.unbind();
          return reject(new Error(`Bind failed: ${err.message}`));
        }

        // Try searching top level
        client.search(config.baseDn || '', '(objectClass=*)', { scope: 'base', timeLimit: 5, attributes: ['defaultNamingContext'] }, (searchErr, res) => {
          let info = {};
          let entries = [];

          res.on('searchEntry', (entry) => {
            entries.push(entry);
            info = entry.object || {};
          });

          res.on('end', () => {
            client.unbind();
            resolve({
              success: true,
              message: 'LDAP connection successful',
              server: info,
              entriesFound: entries.length,
              baseDn: config.baseDn,
            });
          });

          res.on('error', (e) => {
            client.unbind();
            reject(new Error(`Search error: ${e.message}`));
          });
        });
      });
    });
  }
}

export default new LDAPService();
