import cronService from './cron.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class CronController {
  getTasks(req, res) {
    try {
      successResponse(res, cronService.getTasks());
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }

  addTask(req, res) {
    try {
      const { schedule, command, name } = req.body;
      if (!schedule || !command || !name) return errorResponse(res, 400, 'Missing fields');

      const task = cronService.addTask(schedule, command, name);
      successResponse(res, task, 'Cron task created successfully');
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }

  deleteTask(req, res) {
    try {
      const { id } = req.params;
      cronService.deleteTask(id);
      successResponse(res, null, 'Cron task deleted');
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }

  toggleTask(req, res) {
    try {
      const { id } = req.params;
      const task = cronService.toggleTask(id);
      successResponse(res, task, `Task is now ${task.status}`);
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }
}

export default new CronController();
