import terminalService from './terminal.service.js';
import copilotService from './copilot.service.js';
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

  async generateCommand(req, res) {
    try {
      const { prompt, context } = req.body;
      if (!prompt) return error(res, 'Prompt is required', 400);
      const result = await copilotService.generateCommand(prompt, context);
      return success(res, result, 'Command generated');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async explainCommand(req, res) {
    try {
      const { command } = req.body;
      if (!command) return error(res, 'Command is required', 400);
      const result = await copilotService.explainCommand(command);
      return success(res, result, 'Command explained');
    } catch (err) {
      return error(res, err.message, 500);
    }
  }
}

const terminalController = new TerminalController();
export default terminalController;

