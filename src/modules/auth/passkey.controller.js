import passkeyService from './passkey.service.js';
import { success, error } from '../../helpers/response.js';
import appConfig from '../../config/app.js';

class PasskeyController {
  /**
   * Start Passkey Registration (Auth required)
   */
  async getRegistrationOptions(req, res) {
    try {
      const options = await passkeyService.getRegistrationOptions(req.user._id, req);
      return success(res, options, 'Registration options generated');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  /**
   * Verify Passkey Registration (Auth required)
   */
  async verifyRegistration(req, res) {
    try {
      const { response, deviceName } = req.body;
      if (!response) {
        return error(res, 'Registration response is required', 400);
      }
      const result = await passkeyService.verifyRegistration(req.user._id, response, deviceName, req);
      return success(res, result, 'Passkey registered successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  /**
   * Start Passkey Login (Public)
   */
  async getAuthenticationOptions(req, res) {
    try {
      const { username } = req.query;
      const result = await passkeyService.getAuthenticationOptions(username, req);
      return success(res, result, 'Authentication options generated');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }

  /**
   * Verify Passkey Login (Public)
   */
  async verifyAuthentication(req, res) {
    try {
      const { response, challengeKey } = req.body;
      if (!response || !challengeKey) {
        return error(res, 'Response and challengeKey are required', 400);
      }
      const result = await passkeyService.verifyAuthentication(response, challengeKey, req);

      // Set refresh token cookie
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: appConfig.isProd,
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      return success(res, {
        accessToken: result.accessToken,
        user: result.user,
        mustChangePassword: result.mustChangePassword || false,
        passwordExpired: result.passwordExpired || false,
      }, 'Passkey login successful');
    } catch (err) {
      return error(res, err.message, err.statusCode || 401);
    }
  }

  /**
   * List user's registered passkeys (Auth required)
   */
  async listPasskeys(req, res) {
    try {
      const passkeys = await passkeyService.listPasskeys(req.user._id);
      return success(res, { passkeys });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  /**
   * Delete passkey (Auth required)
   */
  async deletePasskey(req, res) {
    try {
      const { id } = req.params;
      const result = await passkeyService.deletePasskey(req.user._id, id);
      return success(res, result, 'Passkey deleted successfully');
    } catch (err) {
      return error(res, err.message, err.statusCode || 500);
    }
  }
}

export default new PasskeyController();
