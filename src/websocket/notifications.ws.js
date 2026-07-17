import Notification from '../models/Notification.js';
import eventBus, { EVENTS } from '../core/events/EventBus.js';
import logger from '../config/logger.js';

/**
 * Notifications WebSocket namespace.
 * Handles real-time push notifications per user.
 */
export const registerNotificationSocket = (namespace) => {
  namespace.on('connection', async (socket) => {
    const userId = socket.userId;
    socket.join(`user:${userId}`);
    logger.debug(`Notification WS: user ${socket.user?.username} connected`);

    // Send unread notifications on connect
    try {
      // [FIX] SQLite adapter doesn't support $or operator or .sort().limit() chaining.
      // We fetch all notifications for this user and filter manually.
      const all = await Notification.find({ userId }, { limit: 100 });
      const unread = all.filter(n => !n.isRead).slice(0, 20);

      if (unread.length) socket.emit('notifications:unread', unread);
    } catch (err) {
      logger.warn('Failed to load unread notifications:', err.message);
    }

    // Mark notification as read
    socket.on('notification:read', async ({ notificationId }) => {
      try {
        await Notification.findByIdAndUpdate(notificationId, { isRead: true });
        socket.emit('notification:marked_read', { notificationId });
      } catch (err) {
        logger.warn('Notification mark read error:', err.message);
      }
    });

    // Mark all as read
    socket.on('notifications:read_all', async () => {
      try {
        // [FIX] SQLite adapter doesn't support $or — mark all for this user
        await Notification.updateMany({ userId }, { isRead: true });
        socket.emit('notifications:all_read');
      } catch (err) {
        logger.warn('Notifications mark all read error:', err.message);
      }
    });

    socket.on('disconnect', () => {
      logger.debug(`Notification WS: user ${socket.user?.username} disconnected`);
    });
  });

  // Listen to system events and push notifications
  eventBus.subscribe(EVENTS.SYSTEM_ALERT, async (alert) => {
    try {
      const notification = await Notification.create({
        title: `System Alert: ${alert.type.toUpperCase()}`,
        message: `${alert.type} usage at ${alert.value}% (threshold: ${alert.threshold}%)`,
        type: 'alert',
        isGlobal: true,
      });
      namespace.emit('notification:new', notification);
    } catch (err) {
      logger.warn('Failed to create system alert notification:', err.message);
    }
  }, 'notifications-ws');
};

/**
 * Push a notification to a specific user or all users.
 * @param {SocketIO.Namespace} namespace
 * @param {string|null} userId - null = broadcast to all
 * @param {Object} notification
 */
export const pushNotification = async (namespace, userId, notification) => {
  const doc = await Notification.create({ ...notification, userId, isGlobal: !userId });
  if (userId) {
    namespace.to(`user:${userId}`).emit('notification:new', doc);
  } else {
    namespace.emit('notification:new', doc);
  }
  return doc;
};
