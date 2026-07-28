import authService from './auth.service.js';
import { success, error, unauthorized } from '../../helpers/response.js';
import appConfig from '../../config/app.js';
import logger from '../../config/logger.js';

class AuthController {
  async login(req, res) {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return error(res, 'Username and password are required', 400);
      }

      const result = await authService.login(username, password, req);

      if (result.requiresTwoFactor) {
        return success(res, { requiresTwoFactor: true, tempToken: result.tempToken }, '2FA required');
      }

      // Set refresh token in HTTP-only cookie
      // [MED-3 FIX] Set refresh token in HTTP-only cookie with SameSite=Strict
      // to prevent CSRF attacks via cross-site requests.
      // [LOW-4 FIX] Use appConfig.isProd instead of req.protocol check:
      // behind a reverse proxy (nginx), req.protocol may be 'http' even though
      // the external connection is HTTPS.
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: appConfig.isProd,
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      // [LOW-2 FIX] Pass mustChangePassword flag to frontend
      // so the UI can redirect the user to change their default password immediately.
      // [PASSWORD EXPIRY] Also pass passwordExpired and forceChangeReason for password expiry policy.
      return success(res, {
        accessToken: result.accessToken,
        user: result.user,
        mustChangePassword: result.mustChangePassword || false,
        passwordExpired: result.passwordExpired || false,
        forceChangeReason: result.forceChangeReason || null,
      }, 'Login successful');
    } catch (err) {
      logger.warn(`Login failed: ${err.message}`);
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async verifyTwoFactor(req, res) {
    try {
      const { tempToken, otp } = req.body;
      const result = await authService.verifyTwoFactor(tempToken, otp, req);

      // [MED-3 FIX] SameSite=Strict to prevent CSRF
      // [LOW-4 FIX] Use appConfig.isProd for secure flag
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: appConfig.isProd,
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      // [LOW-2 FIX] Pass mustChangePassword flag on 2FA login path
      // [PASSWORD EXPIRY] Also pass passwordExpired for password expiry policy.
      return success(res, {
        accessToken: result.accessToken,
        user: result.user,
        mustChangePassword: result.mustChangePassword || false,
        passwordExpired: result.passwordExpired || false,
        forceChangeReason: result.forceChangeReason || null,
      }, '2FA verified');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async refresh(req, res) {
    try {
      const refreshToken = req.cookies?.refresh_token || req.body?.refreshToken;
      if (!refreshToken) return unauthorized(res, 'Refresh token required');

      const result = await authService.refreshToken(refreshToken);

      // [MED-3 FIX] SameSite=Strict to prevent CSRF
      // [LOW-4 FIX] Use appConfig.isProd for secure flag
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: appConfig.isProd,
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      return success(res, { accessToken: result.accessToken }, 'Token refreshed');
    } catch (err) {
      return error(res, err.message, err.statusCode || 401);
    }
  }

  async logout(req, res) {
    try {
      const refreshToken = req.cookies?.refresh_token || req.body?.refreshToken;
      await authService.logout(refreshToken);
      res.clearCookie('refresh_token', { path: '/' });
      return success(res, {}, 'Logged out successfully');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async logoutAll(req, res) {
    try {
      await authService.logoutAll(req.user._id);
      res.clearCookie('refresh_token', { path: '/api/auth/refresh' });
      return success(res, {}, 'Logged out from all devices');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async logoutSession(req, res) {
    try {
      const { sessionId } = req.params;
      await authService.logoutSession(req.user._id, sessionId);
      return success(res, {}, 'Session logged out');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async getSessions(req, res) {
    try {
      const sessions = await authService.getSessions(req.user._id);
      return success(res, { sessions });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getProfile(req, res) {
    return success(res, { user: req.user });
  }

  async setup2FA(req, res) {
    try {
      const result = await authService.setup2FA(req.user._id);
      return success(res, result, '2FA setup initiated');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async enable2FA(req, res) {
    try {
      const { otp } = req.body;
      const result = await authService.enable2FA(req.user._id, otp);
      return success(res, result, '2FA enabled');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  async disable2FA(req, res) {
    try {
      const { password } = req.body;
      await authService.disable2FA(req.user._id, password);
      return success(res, {}, '2FA disabled');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }
}

const authController = new AuthController();
export default authController;
