/**
 * WebPush Notification Service
 * Manages VAPID keys, browser push subscriptions, and push dispatch.
 */
import webpush from 'web-push';
import { getDb, generateId, now } from '../../core/db/sqlite.js';
import logger from '../../config/logger.js';

class WebPushService {
  constructor() {
    this._initialized = false;
    this._vapidKeys = null;
  }

  _initVapid() {
    if (this._initialized) return;
    const db = getDb();

    // Check DB settings for VAPID keys
    const pubRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('webpush_vapid_public_key');
    const privRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('webpush_vapid_private_key');
    const emailRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('webpush_vapid_email');

    let publicKey = pubRow?.value || process.env.VAPID_PUBLIC_KEY;
    let privateKey = privRow?.value || process.env.VAPID_PRIVATE_KEY;
    let contactEmail = emailRow?.value || process.env.VAPID_EMAIL || 'mailto:admin@localhost';

    if (!publicKey || !privateKey) {
      // Auto-generate VAPID keys and save in DB settings
      const generated = webpush.generateVAPIDKeys();
      publicKey = generated.publicKey;
      privateKey = generated.privateKey;

      const insertStmt = db.prepare('INSERT OR REPLACE INTO settings (id, key, value, type, group_name, label, description, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      insertStmt.run(generateId(), 'webpush_vapid_public_key', publicKey, 'string', 'notifications', 'WebPush Public Key', 'VAPID public key for browser push', 1, now(), now());
      insertStmt.run(generateId(), 'webpush_vapid_private_key', privateKey, 'string', 'notifications', 'WebPush Private Key', 'VAPID private key', 0, now(), now());
      insertStmt.run(generateId(), 'webpush_vapid_email', contactEmail, 'string', 'notifications', 'WebPush Contact Email', 'Contact email for VAPID', 0, now(), now());

      logger.info('[WebPush] Auto-generated and persisted new VAPID keys in settings');
    }

    try {
      webpush.setVapidDetails(contactEmail, publicKey, privateKey);
      this._vapidKeys = { publicKey, privateKey, contactEmail };
      this._initialized = true;
    } catch (err) {
      logger.error(`[WebPush] Failed to set VAPID details: ${err.message}`);
    }
  }

  getPublicKey() {
    this._initVapid();
    return this._vapidKeys?.publicKey || null;
  }

  /**
   * Save or update a subscription
   */
  async subscribe(userId, subscription, userAgent = '') {
    this._initVapid();
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      throw Object.assign(new Error('Invalid push subscription payload'), { statusCode: 400 });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM webpush_subscriptions WHERE endpoint = ?').get(subscription.endpoint);

    if (existing) {
      db.prepare('UPDATE webpush_subscriptions SET user_id = ?, keys_p256dh = ?, keys_auth = ?, user_agent = ? WHERE id = ?')
        .run(userId, subscription.keys.p256dh, subscription.keys.auth, userAgent, existing.id);
      return { success: true, id: existing.id };
    }

    const newId = generateId();
    db.prepare(`
      INSERT INTO webpush_subscriptions (id, user_id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(newId, userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent, now());

    return { success: true, id: newId };
  }

  /**
   * Unsubscribe endpoint
   */
  async unsubscribe(endpoint) {
    const db = getDb();
    db.prepare('DELETE FROM webpush_subscriptions WHERE endpoint = ?').run(endpoint);
    return { success: true };
  }

  /**
   * List subscriptions for user
   */
  async listSubscriptions(userId) {
    const db = getDb();
    return db.prepare('SELECT id, endpoint, user_agent, created_at FROM webpush_subscriptions WHERE user_id = ?').all(userId);
  }

  /**
   * Send WebPush notification
   */
  async sendNotification(userIdOrNull, payload) {
    this._initVapid();
    if (!this._initialized) return { sent: 0, failed: 0 };

    const db = getDb();
    let subs;
    if (userIdOrNull) {
      subs = db.prepare('SELECT id, endpoint, keys_p256dh, keys_auth FROM webpush_subscriptions WHERE user_id = ?').all(userIdOrNull);
    } else {
      subs = db.prepare('SELECT id, endpoint, keys_p256dh, keys_auth FROM webpush_subscriptions').all();
    }

    if (subs.length === 0) return { sent: 0, failed: 0 };

    const notificationPayload = JSON.stringify({
      title: payload.title || 'Panelku Alert',
      body: payload.body || payload.message || 'Notification from Panelku',
      icon: payload.icon || '/public/img/logo.png',
      badge: '/public/img/logo.png',
      url: payload.url || payload.link || '/',
      timestamp: Date.now(),
      data: payload.data || {},
    });

    let sent = 0;
    let failed = 0;

    for (const sub of subs) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys_p256dh,
          auth: sub.keys_auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, notificationPayload);
        sent++;
      } catch (err) {
        failed++;
        // If subscription is expired/unsubscribed (404 / 410), cleanup DB
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare('DELETE FROM webpush_subscriptions WHERE id = ?').run(sub.id);
          logger.info(`[WebPush] Removed expired subscription ${sub.id}`);
        } else {
          logger.warn(`[WebPush] Delivery failed for ${sub.id}: ${err.message}`);
        }
      }
    }

    return { sent, failed };
  }
}

export default new WebPushService();
