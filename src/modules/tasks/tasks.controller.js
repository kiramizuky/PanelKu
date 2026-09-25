import queueManager from '../../core/queue/QueueManager.js';
import { success, error } from '../../helpers/response.js';

class TasksController {
  async getAllTasks(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
      const jobs = await queueManager.getAllRecentJobs(limit);
      return success(res, { jobs, total: jobs.length });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getQueueMetrics(req, res) {
    try {
      const metrics = await queueManager.getAllQueueMetrics();
      return success(res, { metrics });
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async getTask(req, res) {
    try {
      const { queueName, jobId } = req.params;
      const job = await queueManager.getJob(queueName, jobId);
      if (!job) {
        return error(res, `Task [${queueName}:${jobId}] not found`, 404);
      }
      return success(res, job);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }

  async cancelTask(req, res) {
    try {
      const { queueName, jobId } = req.params;
      const result = await queueManager.cancelJob(queueName, jobId);
      if (!result.success) {
        return error(res, result.message, 404);
      }
      return success(res, result, result.message);
    } catch (err) {
      return error(res, err.message, 500);
    }
  }
}

export default new TasksController();
