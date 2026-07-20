import crypto from 'crypto';
import Setting from '../../models/Setting.js';
import userRepository from '../../repositories/user.repository.js';
import roleRepository from '../../repositories/role.repository.js';
import logger from '../../config/logger.js';

/**
 * SSO (OAuth2/OIDC) Service
 * Supports: Google, GitHub, and any generic OIDC provider.
 * Provider configs are stored in the settings database.
 */

const PROVIDER_CONFIGS = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scope: 'openid email profile',
    mapUser: (data) => ({
      email: data.email,
      username: data.email?.split('@')[0] || `google_${data.id}`,
      firstName: data.given_name || '',
      lastName: data.family_name || '',
      avatar: data.picture || null,
    }),
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
    mapUser: (data) => ({
      email: data.email,
      username: data.login || `github_${data.id}`,
      firstName: data.name?.split(' ')[0] || data.login,
      lastName: data.name?.split(' ').slice(1).join(' ') || '',
      avatar: data.avatar_url || null,
    }),
  },
};

class SSOService {
  /**
   * Get SSO provider config from settings.
   */
  async _getProviderConfig(provider) {
    const raw = await Setting.get('sso_config') || '{}';
    let config = {};
    try {
      config = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch {
      config = {};
    }
    const providerCfg = config[provider];
    if (!providerCfg || !providerCfg.enabled || !providerCfg.clientId || !providerCfg.clientSecret) {
      throw new Error(`SSO provider "${provider}" is not configured or disabled`);
    }
    return providerCfg;
  }

  /**
   * Get all SSO config.
   */
  async getConfig() {
    const raw = await Setting.get('sso_config') || '{}';
    try {
      return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch {
      return {};
    }
  }

  /**
   * Save SSO config.
   */
  async saveConfig(config) {
    const validProviders = ['google', 'github', 'oidc'];
    const clean = {};
    for (const provider of Object.keys(config)) {
      if (!validProviders.includes(provider)) continue;
      clean[provider] = {
        enabled: !!config[provider].enabled,
        clientId: config[provider].clientId?.trim() || '',
        clientSecret: config[provider].clientSecret?.trim() || '',
        redirectUri: config[provider].redirectUri?.trim() || '',
        // For generic OIDC
        authorizeUrl: config[provider].authorizeUrl?.trim() || '',
        tokenUrl: config[provider].tokenUrl?.trim() || '',
        userInfoUrl: config[provider].userInfoUrl?.trim() || '',
        scope: config[provider].scope?.trim() || 'openid email',
      };
    }
    await Setting.set('sso_config', JSON.stringify(clean), 'json');
    return { message: 'SSO configuration saved', providers: Object.keys(clean) };
  }

  /**
   * Generate OAuth2 authorize URL.
   */
  async getAuthorizeUrl(provider) {
    const providerCfg = await this._getProviderConfig(provider);
    const providerMeta = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.oidc;

    const state = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');

    // Store state temporarily in settings (expires in 10 min)
    let states = {};
    try {
      states = JSON.parse(await Setting.get('sso_states') || '{}');
    } catch {
      states = {};
    }
    states[state] = { provider, nonce, createdAt: Date.now() };
    await Setting.set('sso_states', JSON.stringify(states), 'json');

    const params = new URLSearchParams({
      client_id: providerCfg.clientId,
      redirect_uri: providerCfg.redirectUri || `${this._getBaseUrl()}/api/auth/sso/${provider}/callback`,
      response_type: 'code',
      scope: providerCfg.scope || providerMeta.scope,
      state,
    });

    const authorizeUrl = providerCfg.authorizeUrl || providerMeta.authorizeUrl;
    return { url: `${authorizeUrl}?${params.toString()}`, state };
  }

  /**
   * Handle OAuth2 callback — exchange code for token, fetch user info, create/login user.
   */
  async handleCallback(provider, code, state) {
    // Verify state
    let states = {};
    try {
      states = JSON.parse(await Setting.get('sso_states') || '{}');
    } catch {
      states = {};
    }
    const stateData = states[state];
    if (!stateData) throw Object.assign(new Error('Invalid or expired state parameter'), { statusCode: 401 });
    if (stateData.provider !== provider) throw Object.assign(new Error('State-provider mismatch'), { statusCode: 401 });
    if (Date.now() - stateData.createdAt > 600000) {
      // State expired after 10 min
      delete states[state];
      await Setting.set('sso_states', JSON.stringify(states), 'json');
      throw Object.assign(new Error('State expired. Please try again.'), { statusCode: 401 });
    }

    // Clean up used state
    delete states[state];
    await Setting.set('sso_states', JSON.stringify(states), 'json');

    const providerCfg = await this._getProviderConfig(provider);
    const providerMeta = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.oidc;

    // Exchange authorization code for access token
    const tokenUrl = providerCfg.tokenUrl || providerMeta.tokenUrl;
    const redirectUri = providerCfg.redirectUri || `${this._getBaseUrl()}/api/auth/sso/${provider}/callback`;

    let tokenResponse;
    try {
      const tokenBody = new URLSearchParams({
        code,
        client_id: providerCfg.clientId,
        client_secret: providerCfg.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });

      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: tokenBody.toString(),
      });
      tokenResponse = await res.json();
    } catch (err) {
      throw new Error(`Failed to exchange authorization code: ${err.message}`);
    }

    const accessToken = tokenResponse.access_token;
    if (!accessToken) throw new Error('No access token in provider response');

    // Fetch user info
    const userInfoUrl = providerCfg.userInfoUrl || providerMeta.userInfoUrl;
    let userInfoResponse;
    try {
      const res = await fetch(userInfoUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'User-Agent': 'Panelku-SSO/1.0',
        },
      });
      userInfoResponse = await res.json();
    } catch (err) {
      throw new Error(`Failed to fetch user info: ${err.message}`);
    }

    // Map user info to panel user
    const mapFn = providerMeta.mapUser;
    const profile = mapFn(userInfoResponse);

    if (!profile.email) {
      throw new Error('Could not retrieve email from SSO provider');
    }

    // Find or create user
    return this._findOrCreateSSOUser(provider, profile);
  }

  /**
   * Find existing SSO-linked user or create a new one.
   */
  async _findOrCreateSSOUser(provider, profile) {
    // Check if user exists with this email
    let user = await userRepository.findByEmail(profile.email);

    if (user) {
      // Link SSO provider if not already linked
      const ssoLinks = user.ssoLinks || {};
      if (!ssoLinks[provider]) {
        ssoLinks[provider] = { linkedAt: new Date().toISOString() };
        await userRepository.updateById(user._id, { ssoLinks });
      }
      return user;
    }

    // Auto-create user with default role
    const defaultRole = await roleRepository.findBySlug('read_only');
    if (!defaultRole) throw new Error('Default role not found');

    const tempPass = crypto.randomBytes(24).toString('hex');

    user = await userRepository.create({
      username: profile.username || profile.email.split('@')[0],
      email: profile.email,
      password: tempPass,
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
      avatar: profile.avatar || null,
      role: defaultRole._id,
      isActive: true,
      ssoLinks: { [provider]: { linkedAt: new Date().toISOString() } },
    });

    logger.info(`SSO: Auto-created user "${user.username}" via ${provider}`);
    return user;
  }

  _getBaseUrl() {
    return process.env.APP_URL || `http://localhost:${process.env.PANEL_PORT || 23456}`;
  }
}

export default new SSOService();
