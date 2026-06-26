import cronService from './cron.service.js';
import { successResponse, errorResponse } from '../../helpers/response.js';

class CronController {
  async getTasks(req, res) {
    try {
      const tasks = await cronService.getTasks();
      successResponse(res, tasks);
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }

  async addTask(req, res) {
    try {
      const { schedule, command, name } = req.body;
      if (!schedule || !command || !name) return errorResponse(res, 400, 'Missing fields');

      const task = await cronService.addTask(schedule, command, name);
      successResponse(res, task, 'Cron task created successfully');
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }

  async deleteTask(req, res) {
    try {
      const { id } = req.params;
      await cronService.deleteTask(id);
      successResponse(res, null, 'Cron task deleted');
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }

  async toggleTask(req, res) {
    try {
      const { id } = req.params;
      const task = await cronService.toggleTask(id);
      successResponse(res, task, `Task is now ${task.status}`);
    } catch (error) {
      errorResponse(res, 500, error.message);
    }
  }
}

export default new CronController();
