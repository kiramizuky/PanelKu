import cron from 'node-cron';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

class CronService {
  constructor() {
    this.jobs = new Map(); // Store active node-cron instances
    this.tasks = []; // Store metadata of the tasks
  }

  getTasks() {
    return this.tasks;
  }

  addTask(schedule, command, name) {
    if (!cron.validate(schedule)) {
      throw new Error('Invalid cron expression');
    }

    const id = randomUUID();
    const taskData = { id, name, schedule, command, status: 'active', lastRun: null };
    
    const job = cron.schedule(schedule, async () => {
      try {
        taskData.lastRun = new Date();
        // Here we could log the output to a file or database
        await execPromise(command);
      } catch (err) {
        console.error(`Cron job ${name} failed:`, err);
      }
    });

    this.jobs.set(id, job);
    this.tasks.push(taskData);
    return taskData;
  }

  deleteTask(id) {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
      this.tasks = this.tasks.filter(t => t.id !== id);
      return true;
    }
    throw new Error('Task not found');
  }

  toggleTask(id) {
    const job = this.jobs.get(id);
    const task = this.tasks.find(t => t.id === id);
    if (job && task) {
      if (task.status === 'active') {
        job.stop();
        task.status = 'paused';
      } else {
        job.start();
        task.status = 'active';
      }
      return task;
    }
    throw new Error('Task not found');
  }
}

// Single instance for the application lifecycle
export default new CronService();
