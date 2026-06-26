import { EventEmitter } from 'events';
import logger from '../../config/logger.js';

/**
 * Internal Event Bus — pub/sub for decoupled module communication.
 * Singleton pattern ensures a single bus across the application.
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this._handlers = new Map();
  }

  /**
   * Subscribe to an event with a named handler.
   */
  subscribe(event, handler, name = null) {
    const wrappedHandler = async (...args) => {
      try {
        await handler(...args);
      } catch (err) {
        logger.error(`EventBus handler error [${event}]: ${err.message}`, { stack: err.stack });
      }
    };

    if (name) {
      if (!this._handlers.has(name)) this._handlers.set(name, []);
      this._handlers.get(name).push({ event, handler: wrappedHandler });
    }

    this.on(event, wrappedHandler);
    logger.debug(`EventBus: subscribed to [${event}]${name ? ` (${name})` : ''}`);
    return wrappedHandler;
  }

  /**
   * Publish an event with data.
   */
  publish(event, data = {}) {
    logger.debug(`EventBus: publishing [${event}]`);
    this.emit(event, data);
  }

  /**
   * Unsubscribe all handlers for a named subscriber.
   */
  unsubscribeAll(name) {
    if (this._handlers.has(name)) {
      for (const { event, handler } of this._handlers.get(name)) {
        this.removeListener(event, handler);
      }
      this._handlers.delete(name);
      logger.debug(`EventBus: unsubscribed all [${name}]`);
    }
  }
}

// Singleton
const eventBus = new EventBus();

// Well-known domain events
export const EVENTS = {
  USER_LOGGED_IN: 'user.logged_in',
  USER_LOGGED_OUT: 'user.logged_out',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  SYSTEM_ALERT: 'system.alert',
  MONITOR_THRESHOLD: 'monitor.threshold',
  DOCKER_EVENT: 'docker.event',
  BACKUP_COMPLETE: 'backup.complete',
  BACKUP_FAILED: 'backup.failed',
  SSL_EXPIRING: 'ssl.expiring',
  DEPLOY_COMPLETE: 'deploy.complete',
};

export default eventBus;
