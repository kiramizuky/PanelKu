import logger from '../../config/logger.js';

/**
 * Simple in-process job scheduler using setInterval.
 * For heavy jobs (backup, deploy), use BullMQ instead.
 */
class Scheduler {
  constructor() {
    this._jobs = new Map();
  }

  /**
   * Register a recurring job.
   * @param {string} name - Unique job name
   * @param {Function} fn - Async function to execute
   * @param {number} intervalMs - Interval in milliseconds
   * @param {boolean} runImmediately - Run once immediately on register
   */
  register(name, fn, intervalMs, runImmediately = false) {
    if (this._jobs.has(name)) {
      logger.warn(`Scheduler: job [${name}] already registered, skipping.`);
      return;
    }

    const wrappedFn = async () => {
      try {
        await fn();
      } catch (err) {
        logger.error(`Scheduler job [${name}] error: ${err.message}`, { stack: err.stack });
      }
    };

    if (runImmediately) wrappedFn();

    const timer = setInterval(wrappedFn, intervalMs);
    this._jobs.set(name, { timer, intervalMs });
    logger.info(`Scheduler: registered job [${name}] every ${intervalMs}ms`);
  }

  /**
   * Cancel a registered job.
   */
  cancel(name) {
    if (this._jobs.has(name)) {
      clearInterval(this._jobs.get(name).timer);
      this._jobs.delete(name);
      logger.info(`Scheduler: cancelled job [${name}]`);
    }
  }

  /**
   * Cancel all jobs.
   */
  cancelAll() {
    for (const [name] of this._jobs) {
      this.cancel(name);
    }
  }

  list() {
    return [...this._jobs.entries()].map(([name, { intervalMs }]) => ({ name, intervalMs }));
  }
}

const scheduler = new Scheduler();
export default scheduler;
