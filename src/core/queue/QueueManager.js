import { Queue, Worker } from 'bullmq';
import redisConfig from '../../config/redis.js';
import logger from '../../config/logger.js';
import eventBus, { EVENTS } from '../events/EventBus.js';

/**
 * In-memory representation of a queued job when Redis/BullMQ is unavailable.
 */
class MemoryJob {
  constructor(queueName, id, name, data, opts = {}, queueManager = null) {
    this.id = id;
    this.name = name;
    this.data = data || {};
    this.opts = opts;
    this.queueName = queueName;
    this.progress = 0;
    this.progressMessage = '';
    this.status = 'waiting'; // waiting | active | completed | failed | cancelled
    this.timestamp = Date.now();
    this.processedOn = null;
    this.finishedOn = null;
    this.returnvalue = null;
    this.failedReason = null;
    this._queueManager = queueManager;
  }

  async updateProgress(progress, message = '') {
    this.progress = progress;
    this.progressMessage = message;
    if (this._queueManager) {
      this._queueManager._emitProgress(this.queueName, this, progress, message);
    }
    return progress;
  }

  async getState() {
    return this.status;
  }
}

/**
 * Unified Queue Manager for background and heavy asynchronous tasks.
 * Uses BullMQ backed by Redis with seamless in-memory fallback when Redis is absent.
 */
class QueueManager {
  constructor() {
    this._queues = new Map();
    this._workers = new Map();
    this._processors = new Map();
    this._inMemoryQueues = new Map();
    this._useBullMQ = false;
    this._redisClient = null;
    this._io = null;
  }

  /**
   * Set Socket.IO server reference for broadcasting task updates
   */
  setIo(io) {
    this._io = io;
  }

  /**
   * Initialize QueueManager with Redis client status.
   * @param {import('ioredis').Redis} [redisClient]
   */
  init(redisClient) {
    this._redisClient = redisClient;
    if (redisClient) {
      if (redisClient.status === 'ready') {
        this._useBullMQ = true;
      }
      redisClient.on('ready', () => {
        this._useBullMQ = true;
        logger.info('QueueManager: Redis ready, BullMQ mode active');
        this._promoteProcessorsToWorkers();
      });
      redisClient.on('close', () => {
        this._useBullMQ = false;
        logger.warn('QueueManager: Redis disconnected, fallback to in-memory mode');
      });
      redisClient.on('error', (err) => {
        logger.warn(`QueueManager: Redis error (${err.message}), fallback mode available`);
      });
    }
  }

  /**
   * Get Redis connection options suitable for BullMQ
   */
  _getConnectionOpts() {
    return {
      host: redisConfig.host || 'localhost',
      port: redisConfig.port || 6379,
      password: redisConfig.password || undefined,
      db: redisConfig.db || 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  }

  /**
   * Get or create a BullMQ queue
   */
  getOrCreateQueue(queueName) {
    if (!this._queues.has(queueName)) {
      const queue = new Queue(queueName, {
        connection: this._getConnectionOpts(),
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      });
      this._queues.set(queueName, queue);
    }
    return this._queues.get(queueName);
  }

  /**
   * Register a worker processor for a queue name.
   * @param {string} queueName
   * @param {Function} processor - async function(job) => result
   * @param {Object} [opts] - { concurrency: 1 }
   */
  registerWorker(queueName, processor, opts = {}) {
    const concurrency = opts.concurrency || 1;
    this._processors.set(queueName, { processor, opts: { concurrency } });

    if (this._useBullMQ) {
      this._createBullWorker(queueName, processor, concurrency);
    } else {
      logger.info(`QueueManager: Registered in-memory worker for [${queueName}] (concurrency: ${concurrency})`);
    }
  }

  _createBullWorker(queueName, processor, concurrency = 1) {
    if (this._workers.has(queueName)) return;

    try {
      const worker = new Worker(
        queueName,
        async (job) => processor(job),
        {
          connection: this._getConnectionOpts(),
          concurrency,
        }
      );

      worker.on('progress', (job, progress) => {
        const message = typeof progress === 'object' ? (progress.message || '') : '';
        const numericProgress = typeof progress === 'object' ? (progress.percent ?? progress.progress ?? 0) : progress;
        this._emitProgress(queueName, job, numericProgress, message);
      });

      worker.on('completed', (job, result) => {
        this._emitCompleted(queueName, job, result);
      });

      worker.on('failed', (job, err) => {
        this._emitFailed(queueName, job, err);
      });

      worker.on('error', (err) => {
        logger.warn(`QueueWorker [${queueName}] error: ${err.message}`);
      });

      this._workers.set(queueName, worker);
      logger.info(`QueueManager: Registered BullMQ worker for [${queueName}] (concurrency: ${concurrency})`);
    } catch (err) {
      logger.warn(`Failed to create BullMQ worker for [${queueName}]: ${err.message}. Using in-memory.`);
    }
  }

  _promoteProcessorsToWorkers() {
    for (const [queueName, { processor, opts }] of this._processors.entries()) {
      if (!this._workers.has(queueName)) {
        this._createBullWorker(queueName, processor, opts.concurrency);
      }
    }
  }

  /**
   * Add a job to a queue.
   * @param {string} queueName
   * @param {string} jobName
   * @param {Object} data
   * @param {Object} [opts]
   * @returns {Promise<{ id: string, name: string, queueName: string, isFallback: boolean }>}
   */
  async addJob(queueName, jobName, data = {}, opts = {}) {
    if (this._useBullMQ) {
      try {
        const queue = this.getOrCreateQueue(queueName);
        const job = await queue.add(jobName, data, opts);
        return { id: String(job.id), name: job.name, queueName, isFallback: false };
      } catch (err) {
        logger.warn(`BullMQ addJob [${queueName}] failed: ${err.message}. Falling back to in-memory.`);
      }
    }

    return this._addMemoryJob(queueName, jobName, data, opts);
  }

  /**
   * Internal in-memory job dispatch and management
   */
  _getMemoryQueue(queueName) {
    if (!this._inMemoryQueues.has(queueName)) {
      this._inMemoryQueues.set(queueName, {
        waiting: [],
        active: new Map(),
        history: new Map(),
        concurrency: this._processors.get(queueName)?.opts?.concurrency || 1,
        isDraining: false,
      });
    }
    return this._inMemoryQueues.get(queueName);
  }

  _addMemoryJob(queueName, jobName, data, opts) {
    const memQueue = this._getMemoryQueue(queueName);
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const job = new MemoryJob(queueName, id, jobName, data, opts, this);

    memQueue.waiting.push(job);
    memQueue.history.set(id, job);

    // Limit history memory to last 100 entries per queue
    if (memQueue.history.size > 100) {
      const oldestId = memQueue.history.keys().next().value;
      memQueue.history.delete(oldestId);
    }

    // Schedule draining asynchronously
    setImmediate(() => this._drainMemoryQueue(queueName));

    return { id: job.id, name: job.name, queueName, isFallback: true };
  }

  async _drainMemoryQueue(queueName) {
    const memQueue = this._getMemoryQueue(queueName);
    const processorInfo = this._processors.get(queueName);
    if (!processorInfo || memQueue.isDraining) return;

    memQueue.isDraining = true;

    try {
      while (memQueue.active.size < memQueue.concurrency && memQueue.waiting.length > 0) {
        const job = memQueue.waiting.shift();
        if (!job) break;

        job.status = 'active';
        job.processedOn = Date.now();
        memQueue.active.set(job.id, job);

        // Run processor in background without blocking loop
        (async () => {
          try {
            const result = await processorInfo.processor(job);
            job.status = 'completed';
            job.returnvalue = result;
            job.finishedOn = Date.now();
            this._emitCompleted(queueName, job, result);
          } catch (err) {
            job.status = 'failed';
            job.failedReason = err.message;
            job.finishedOn = Date.now();
            this._emitFailed(queueName, job, err);
          } finally {
            memQueue.active.delete(job.id);
            setImmediate(() => this._drainMemoryQueue(queueName));
          }
        })();
      }
    } finally {
      memQueue.isDraining = false;
    }
  }

  _getMemoryJob(queueName, jobId) {
    const memQueue = this._inMemoryQueues.get(queueName);
    if (!memQueue) return null;
    return memQueue.history.get(jobId) || null;
  }

  /**
   * Get details and state of a job.
   */
  async getJob(queueName, jobId) {
    if (this._useBullMQ) {
      try {
        const queue = this.getOrCreateQueue(queueName);
        const job = await queue.getJob(jobId);
        if (job) {
          const state = await job.getState();
          return {
            id: String(job.id),
            name: job.name,
            data: job.data,
            progress: job.progress,
            status: state,
            returnvalue: job.returnvalue,
            failedReason: job.failedReason,
            timestamp: job.timestamp,
            isFallback: false,
          };
        }
      } catch (err) {
        logger.warn(`BullMQ getJob [${queueName}:${jobId}] error: ${err.message}`);
      }
    }

    const memJob = this._getMemoryJob(queueName, jobId);
    if (!memJob) return null;

    return {
      id: memJob.id,
      name: memJob.name,
      data: memJob.data,
      progress: memJob.progress,
      status: memJob.status,
      returnvalue: memJob.returnvalue,
      failedReason: memJob.failedReason,
      timestamp: memJob.timestamp,
      isFallback: true,
    };
  }

  /**
   * Get queue counts and operational mode
   */
  async getQueueMetrics(queueName) {
    if (this._useBullMQ) {
      try {
        const queue = this.getOrCreateQueue(queueName);
        const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        return { ...counts, isFallback: false };
      } catch (err) {
        logger.warn(`BullMQ getQueueMetrics [${queueName}] error: ${err.message}`);
      }
    }

    const memQueue = this._inMemoryQueues.get(queueName);
    if (!memQueue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, isFallback: true };
    }

    let completed = 0;
    let failed = 0;
    for (const j of memQueue.history.values()) {
      if (j.status === 'completed') completed++;
      if (j.status === 'failed') failed++;
    }

    return {
      waiting: memQueue.waiting.length,
      active: memQueue.active.size,
      completed,
      failed,
      delayed: 0,
      isFallback: true,
    };
  }

  _emitProgress(queueName, job, progress, message = '') {
    const payload = {
      queueName,
      jobId: String(job.id),
      name: job.name,
      progress,
      message,
      timestamp: Date.now(),
    };
    eventBus.publish(EVENTS.TASK_PROGRESS, payload);
    if (this._io) {
      this._io.emit('task:progress', payload);
    }
  }

  _emitCompleted(queueName, job, result) {
    logger.info(`Queue [${queueName}] job [${job.id}:${job.name}] completed`);
    const payload = {
      queueName,
      jobId: String(job.id),
      name: job.name,
      result,
      timestamp: Date.now(),
    };
    if (queueName === 'backup') {
      eventBus.publish(EVENTS.BACKUP_COMPLETE, { jobId: job.id, name: job.name, result });
    } else if (queueName === 'deploy') {
      eventBus.publish(EVENTS.DEPLOY_COMPLETE, { jobId: job.id, name: job.name, result });
    }
    eventBus.publish(EVENTS.TASK_COMPLETED, payload);
    if (this._io) {
      this._io.emit('task:completed', payload);
    }
  }

  _emitFailed(queueName, job, err) {
    logger.error(`Queue [${queueName}] job [${job?.id}:${job?.name}] failed: ${err.message}`);
    const payload = {
      queueName,
      jobId: String(job?.id),
      name: job?.name,
      error: err.message,
      timestamp: Date.now(),
    };
    if (queueName === 'backup') {
      eventBus.publish(EVENTS.BACKUP_FAILED, { jobId: job?.id, name: job?.name, error: err.message });
    } else if (queueName === 'deploy') {
      eventBus.publish(EVENTS.DEPLOY_FAILED, { jobId: job?.id, name: job?.name, error: err.message });
    }
    eventBus.publish(EVENTS.TASK_FAILED, payload);
    if (this._io) {
      this._io.emit('task:failed', payload);
    }
  }

  /**
   * Get list of all registered queue names
   */
  getRegisteredQueueNames() {
    const names = new Set([
      ...this._queues.keys(),
      ...this._inMemoryQueues.keys(),
      ...this._processors.keys(),
    ]);
    return Array.from(names);
  }

  /**
   * Get operational metrics across all registered queues
   */
  async getAllQueueMetrics() {
    const queueNames = this.getRegisteredQueueNames();
    const result = {};
    for (const name of queueNames) {
      result[name] = await this.getQueueMetrics(name);
    }
    return result;
  }

  /**
   * Get all recent & active jobs across all queues
   */
  async getAllRecentJobs(limit = 50) {
    const allJobs = [];

    // 1. In-memory jobs
    for (const [queueName, memQueue] of this._inMemoryQueues.entries()) {
      for (const j of memQueue.history.values()) {
        allJobs.push({
          id: j.id,
          name: j.name,
          queueName,
          data: j.data,
          progress: j.progress || 0,
          progressMessage: j.progressMessage || '',
          status: j.status,
          timestamp: j.timestamp,
          processedOn: j.processedOn,
          finishedOn: j.finishedOn,
          returnvalue: j.returnvalue,
          failedReason: j.failedReason,
          isFallback: true,
        });
      }
    }

    // 2. BullMQ jobs
    if (this._useBullMQ) {
      for (const [queueName, queue] of this._queues.entries()) {
        try {
          const bullJobs = await queue.getJobs(['active', 'waiting', 'completed', 'failed', 'delayed'], 0, limit);
          for (const bj of bullJobs) {
            const state = await bj.getState();
            allJobs.push({
              id: String(bj.id),
              name: bj.name,
              queueName,
              data: bj.data,
              progress: bj.progress || 0,
              progressMessage: bj.data?.progressMessage || '',
              status: state,
              timestamp: bj.timestamp,
              processedOn: bj.processedOn,
              finishedOn: bj.finishedOn,
              returnvalue: bj.returnvalue,
              failedReason: bj.failedReason,
              isFallback: false,
            });
          }
        } catch (err) {
          logger.warn(`Failed reading BullMQ jobs for [${queueName}]: ${err.message}`);
        }
      }
    }

    // Sort descending by timestamp
    allJobs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return allJobs.slice(0, limit);
  }

  /**
   * Cancel or remove a queued job
   */
  async cancelJob(queueName, jobId) {
    if (this._useBullMQ) {
      try {
        const queue = this.getOrCreateQueue(queueName);
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
          return { success: true, message: `Job ${jobId} removed from queue ${queueName}` };
        }
      } catch (err) {
        logger.warn(`BullMQ cancelJob [${queueName}:${jobId}] error: ${err.message}`);
      }
    }

    const memQueue = this._inMemoryQueues.get(queueName);
    if (memQueue) {
      const job = memQueue.history.get(jobId);
      if (job) {
        if (job.status === 'waiting') {
          const idx = memQueue.waiting.indexOf(job);
          if (idx !== -1) memQueue.waiting.splice(idx, 1);
        }
        job.status = 'cancelled';
        job.finishedOn = Date.now();
        return { success: true, message: `Job ${jobId} cancelled` };
      }
    }

    return { success: false, message: 'Job not found' };
  }

  /**
   * Cleanly shutdown all workers and queues
   */
  async closeAll() {
    for (const [name, worker] of this._workers.entries()) {
      try {
        await worker.close();
        logger.info(`QueueManager: Closed worker [${name}]`);
      } catch (err) {
        logger.warn(`Error closing worker [${name}]: ${err.message}`);
      }
    }
    this._workers.clear();

    for (const [name, queue] of this._queues.entries()) {
      try {
        await queue.close();
        logger.info(`QueueManager: Closed queue [${name}]`);
      } catch (err) {
        logger.warn(`Error closing queue [${name}]: ${err.message}`);
      }
    }
    this._queues.clear();
  }
}

const queueManager = new QueueManager();
export default queueManager;
export { QueueManager };
