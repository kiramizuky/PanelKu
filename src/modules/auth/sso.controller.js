import ssoService from './sso.service.js';
import authService from './auth.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class SSOController {
  /**
   * GET /api/auth/sso/config
   * Get SSO provider configuration (safe, no secrets).
   */
  async getConfig(req, res) {
    try {
      const config = await ssoService.getConfig();
      // Strip secrets from response
      const safe = {};
      for (const [provider, cfg] of Object.entries(config)) {
        safe[provider] = {
          enabled: cfg.enabled,
          clientId: cfg.clientId ? cfg.clientId.substring(0, 8) + '...' : '',
          redirectUri: cfg.redirectUri || '',
          scope: cfg.scope || '',
        };
      }
      return successResponse(res, { config: safe });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/auth/sso/config
   * Save SSO provider configuration.
   */
  async saveConfig(req, res) {
    try {
      const result = await ssoService.saveConfig(req.body);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  /**
   * GET /api/auth/sso/:provider/authorize
   * Redirect user to OAuth2 provider authorize URL.
   */
  async authorize(req, res) {
    try {
      const { provider } = req.params;
      const result = await ssoService.getAuthorizeUrl(provider);
      return res.redirect(result.url);
    } catch (error) {
      // Redirect to login page with error
      const redirectUrl = `${req.protocol}://${req.get('host')}/?error=${encodeURIComponent(error.message)}`;
      return res.redirect(redirectUrl);
    }
  }

  /**
   * GET /api/auth/sso/:provider/callback
   * Handle OAuth2 callback from provider.
   */
  async callback(req, res) {
    try {
      const { provider } = req.params;
      const { code, state } = req.query;

      if (!code) return errorResponse(res, 'Authorization code is required', 400);
      if (!state) return errorResponse(res, 'State parameter is required', 400);

      const user = await ssoService.handleCallback(provider, code, state);

      // Complete login
      const loginResult = await authService.completeLogin(user, req);

      // Set refresh token in HTTP-only cookie
      res.cookie('refresh_token', loginResult.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth/refresh',
      });

      // Redirect to dashboard with access token in URL fragment (not query param)
      // Fragments are never sent to the server, so tokens aren't logged
      const redirectUrl = `${req.protocol}://${req.get('host')}/dashboard#token=${loginResult.accessToken}`;
      return res.redirect(redirectUrl);
    } catch (error) {
      // Redirect to login with error
      const redirectUrl = `${req.protocol}://${req.get('host')}/?error=${encodeURIComponent(error.message)}`;
      return res.redirect(redirectUrl);
    }
  }
}

export default new SSOController();
