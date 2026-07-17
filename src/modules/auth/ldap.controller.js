import ldapService from './ldap.service.js';
import authService from './auth.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class LDAPController {
  /**
   * GET /api/auth/ldap/config
   */
  async getConfig(req, res) {
    try {
      const config = await ldapService.getConfig();
      // Return safely (hide bindPassword)
      return successResponse(res, {
        config: {
          ...config,
          bindPassword: config.bindPassword ? '••••••••' : '',
        },
      });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/auth/ldap/config
   */
  async saveConfig(req, res) {
    try {
      const result = await ldapService.saveConfig(req.body);
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 400);
    }
  }

  /**
   * POST /api/auth/ldap/test
   * Test LDAP connection and search.
   */
  async testConnection(req, res) {
    try {
      const result = await ldapService.testConnection();
      return successResponse(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * POST /api/auth/ldap/login
   * Authenticate via LDAP.
   */
  async login(req, res) {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return errorResponse(res, 'Username and password are required', 400);
      }

      // Authenticate against LDAP
      const ldapProfile = await ldapService.authenticate(username, password);

      // Find or create local user
      const user = await ldapService.findOrCreateUser(ldapProfile);

      // Complete login (generate JWT, create session)
      const loginResult = await authService.completeLogin(user, req);

      return successResponse(res, {
        accessToken: loginResult.accessToken,
        refreshToken: loginResult.refreshToken,
        user: loginResult.user,
      }, 'LDAP login successful');
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 401);
    }
  }
}

export default new LDAPController();
