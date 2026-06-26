import terminalService from './terminal.service.js';
import { success, error } from '../../helpers/response.js';

class TerminalController {
  async create(req, res) {
    try {
      const { shell = 'bash', cols = 80, rows = 24 } = req.body;
      const result = terminalService.create(req.user._id, shell, cols, rows);
      return success(res, result, 'Terminal session created');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async kill(req, res) {
    try {
      const { sessionId } = req.params;
      terminalService.kill(sessionId);
      return success(res, {}, 'Terminal session killed');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getStats(req, res) {
    try {
      const stats = terminalService.getStats();
      return success(res, stats);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }
}

const terminalController = new TerminalController();
export default terminalController;
