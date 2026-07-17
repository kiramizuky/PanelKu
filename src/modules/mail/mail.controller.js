import mailService from './mail.service.js';
import { success, error } from '../../helpers/response.js';

class MailController {
  async getStatus(req, res) {
    try { return success(res, await mailService.getStatus()); }
    catch (err) { return error(res, err.message, 500); }
  }

  async install(req, res) {
    try { return success(res, await mailService.install(), 'Mail server installed'); }
    catch (err) { return error(res, err.message, 500); }
  }

  async uninstall(req, res) {
    try { return success(res, await mailService.uninstall(), 'Mail server removed'); }
    catch (err) { return error(res, err.message, 500); }
  }

  async controlService(req, res) {
    try {
      const { service, action } = req.body;
      if (!service || !action) return error(res, 'Service and action are required', 400);
      return success(res, await mailService.controlService(service, action), `${action} ${service}`);
    } catch (err) { return error(res, err.message, 500); }
  }

  async getAccounts(req, res) {
    try { return success(res, { accounts: await mailService.getAccounts() }); }
    catch (err) { return error(res, err.message, 500); }
  }

  async addAccount(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) return error(res, 'Email and password are required', 400);
      return success(res, await mailService.addAccount(email, password), 'Account created');
    } catch (err) { return error(res, err.message, 500); }
  }

  async deleteAccount(req, res) {
    try {
      const { email } = req.body;
      if (!email) return error(res, 'Email is required', 400);
      return success(res, await mailService.deleteAccount(email), 'Account deleted');
    } catch (err) { return error(res, err.message, 500); }
  }

  async updatePassword(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) return error(res, 'Email and password are required', 400);
      return success(res, await mailService.updatePassword(email, password), 'Password updated');
    } catch (err) { return error(res, err.message, 500); }
  }

  async getDomains(req, res) {
    try { return success(res, { domains: await mailService.getDomains() }); }
    catch (err) { return error(res, err.message, 500); }
  }

  async addDomain(req, res) {
    try {
      const { domain } = req.body;
      if (!domain) return error(res, 'Domain is required', 400);
      return success(res, await mailService.addDomain(domain), 'Domain added');
    } catch (err) { return error(res, err.message, 500); }
  }

  async removeDomain(req, res) {
    try {
      const { domain } = req.body;
      if (!domain) return error(res, 'Domain is required', 400);
      return success(res, await mailService.removeDomain(domain), 'Domain removed');
    } catch (err) { return error(res, err.message, 500); }
  }

  async getQueue(req, res) {
    try { return success(res, await mailService.getQueue()); }
    catch (err) { return error(res, err.message, 500); }
  }

  async flushQueue(req, res) {
    try { return success(res, await mailService.flushQueue(), 'Mail queue flushed'); }
    catch (err) { return error(res, err.message, 500); }
  }

  async deleteFromQueue(req, res) {
    try {
      const { queueId } = req.body;
      if (!queueId) return error(res, 'Queue ID is required', 400);
      return success(res, await mailService.deleteFromQueue(queueId), 'Message removed from queue');
    } catch (err) { return error(res, err.message, 500); }
  }

  async getSpamConfig(req, res) {
    try { return success(res, await mailService.getSpamConfig()); }
    catch (err) { return error(res, err.message, 500); }
  }

  async updateSpamConfig(req, res) {
    try {
      const { requiredScore } = req.body;
      if (requiredScore === undefined) return error(res, 'Required score is required', 400);
      return success(res, await mailService.updateSpamConfig(requiredScore), 'Spam config updated');
    } catch (err) { return error(res, err.message, 500); }
  }

  async getSslInfo(req, res) {
    try { return success(res, { certs: await mailService.getSslInfo() }); }
    catch (err) { return error(res, err.message, 500); }
  }

  async getLogs(req, res) {
    try {
      const { service = 'postfix', lines = 50 } = req.query;
      const logs = await mailService.getLogs(service, parseInt(lines));
      return success(res, { logs });
    } catch (err) { return error(res, err.message, 500); }
  }
}

export default new MailController();
