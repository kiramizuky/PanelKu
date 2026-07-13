import cron from 'node-cron';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../config/logger.js';

const execPromise = util.promisify(exec);
const STORAGE_PATH = path.resolve('storage', 'cron-tasks.json');

// [HIGH-3 FIX] Dangerous command patterns that should never be scheduled
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\//,           // rm -rf /
  /\bchmod\s+777\s+\//,        // chmod 777 /
  /\bmkfs\b/,                   // format disk
  /\bdd\s+if=/,                 // disk dump
  /\bshred\b/,                  // secure delete
  /\b(wget|curl)\s+.*\|.*sh/,  // download and execute
  /\bnc\b.*\s+-e\s+/,          // netcat reverse shell
  /\bpython.*-c.*exec/,         // python code exec
  />\/dev\/sd[a-z]/,            // write to disk device
  /\/etc\/passwd/,              // accessing passwd
  /\/etc\/shadow/,              // accessing shadow
];

/**
 * [HIGH-3 FIX] Validate cron command against dangerous patterns.
 * Note: Cron jobs run as the panel process user — typically root.
 * Only allow explicit safe patterns.
 */
function validateCronCommand(command) {
  if (!command || typeof command !== 'string') {
    throw new Error('Command must be a non-empty string');
  }
  if (command.length > 500) {
    throw new Error('Command is too long (max 500 characters)');
  }
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      throw Object.assign(
        new Error('Command contains a potentially dangerous pattern and was rejected for safety.'),
        { statusCode: 400 }
      );
    }
  }
}

class CronService {
  constructor() {
    this.jobs = new Map(); // Store active node-cron instances
    this.tasks = []; // Store metadata of the tasks
    this._loaded = false;
  }

  async _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const raw = await fs.readFile(STORAGE_PATH, 'utf8');
      const savedTasks = JSON.parse(raw);
      for (const task of savedTasks) {
        if (task.status === 'active') {
          this._scheduleJob(task);
        } else {
          this.tasks.push(task);
        }
      }
    } catch {
      // File doesn't exist yet — fresh start
    }
  }

  async _save() {
    try {
      await fs.mkdir(path.dirname(STORAGE_PATH), { recursive: true });
      await fs.writeFile(STORAGE_PATH, JSON.stringify(this.tasks, null, 2), 'utf8');
    } catch (err) {
      logger.error('CronService: failed to persist tasks:', err.message);
    }
  }

  _scheduleJob(taskData) {
    if (!cron.validate(taskData.schedule)) return;
    const job = cron.schedule(taskData.schedule, async () => {
      try {
        taskData.lastRun = new Date();
        await execPromise(taskData.command);
        this._save();
      } catch (err) {
        logger.error(`Cron job [${taskData.name}] failed: ${err.message}`);
      }
    });
    this.jobs.set(taskData.id, job);
    this.tasks.push(taskData);
  }

  async getTasks() {
    await this._ensureLoaded();
    return this.tasks;
  }

  async addTask(schedule, command, name) {
    await this._ensureLoaded();
    if (!cron.validate(schedule)) {
      throw new Error('Invalid cron expression');
    }
    // [HIGH-3 FIX] Validate command before scheduling
    validateCronCommand(command);

    const id = randomUUID();
    const taskData = { id, name, schedule, command, status: 'active', lastRun: null, createdAt: new Date() };

    this._scheduleJob(taskData);
    await this._save();
    return taskData;
  }

  async deleteTask(id) {
    await this._ensureLoaded();
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
      this.tasks = this.tasks.filter(t => t.id !== id);
      await this._save();
      return true;
    }
    throw new Error('Task not found');
  }

  async toggleTask(id) {
    await this._ensureLoaded();
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
      await this._save();
      return task;
    }
    throw new Error('Task not found');
  }
}

// Single instance for the application lifecycle
export default new CronService();
