/**
 * Password Expiry Reminder Job
 *
 * Runs daily and checks all users whose passwords will expire within 7 days.
 * Creates in-app notifications and sends email reminders if SMTP is configured.
 *
 * Query logic:
 *   - passwordExpiry.days = 90 (configurable via PASSWORD_EXPIRY_DAYS env)
 *   - Reminder window: 7 days before expiry
 *   - Looks for users where password_changed_at is between:
 *     (now - 90 days) and (now - 83 days)  → 7 day reminder window
 *
 * For users with password_changed_at = NULL (never changed since account creation),
 * the expiry is computed from created_at instead.
 *
 * @module jobs/password-expiry-reminder
 */

import scheduler from '../core/scheduler/Scheduler.js';
import appConfig from '../config/app.js';
import logger from '../config/logger.js';
import { getDb } from '../core/db/sqlite.js';
import Notification from '../models/Notification.js';
import alertsService from '../modules/alerts/alerts.service.js';
import passwordPolicyService from '../modules/system/password-policy.service.js';

// Prevent duplicate notifications — track last sent day per user.
// Uses a Map that naturally overwrites old entries, no memory leak.
// Key: userId, Value: dayNumber (Math.floor(Date.now() / 86400000))
const _reminderSent = new Map();

export const startPasswordExpiryReminder = () => {
  // Try loading policy from DB; if it fails, fall back to appConfig
  (async () => {
    const policy = await passwordPolicyService.getPolicy().catch(() => null);
    if (policy && !policy.expiryEnabled) {
      logger.info('Password expiry reminder: disabled (policy.expiryEnabled=false)');
      return;
    }
    if (!policy && !appConfig.passwordExpiry.enabled) {
      logger.info('Password expiry reminder: disabled (PASSWORD_EXPIRY_ENABLED=false)');
      return;
    }

    scheduler.register(
      'password-expiry:reminder',
      async () => {
        try {
          await checkExpiringPasswords();
        } catch (err) {
          logger.error(`Password expiry reminder job error: ${err.message}`);
        }
      },
      24 * 60 * 60 * 1000, // every 24 hours
      true // run immediately on startup so admins get notified quickly
    );

    const days = policy ? policy.expiryDays : appConfig.passwordExpiry.days;
    const reminder = policy ? policy.reminderDays : 7;
    logger.info(`Password expiry reminder job started (${days} day policy, ${reminder} day reminder window)`);
  })();
};

/**
 * Query users with expiring passwords and create notifications + send emails.
 * Exported for testing.
 */
export async function checkExpiringPasswords() {
  const db = getDb();

  // Load policy from DB settings, fall back to appConfig defaults
  const policy = await passwordPolicyService.getPolicy().catch(() => null);
  const expiryDays = policy ? policy.expiryDays : appConfig.passwordExpiry.days;
  const reminderDays = policy ? policy.reminderDays : 7;

  const maxAge = expiryDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const todayKey = Math.floor(now / 86400000); // day number

  // Query: all active users
  const rows = db.prepare(`
    SELECT id, username, email, password_changed_at, created_at
    FROM users WHERE is_active = 1
  `).all();

  if (!rows || rows.length === 0) {
    logger.debug('Password expiry reminder: no users to check');
    return [];
  }

  // Load alerts config once for email integration
  const alertConfig = await alertsService.getConfig().catch(() => null);
  const emailEnabled = alertConfig?.email?.enabled && alertConfig.email.smtpHost;

  const notified = [];

  for (const row of rows) {
    const changedAt = row.password_changed_at || row.created_at;
    if (!changedAt) continue;

    const age = now - new Date(changedAt).getTime();
    const daysUntilExpiry = Math.ceil((maxAge - age) / (24 * 60 * 60 * 1000));

    // Only notify within the reminder window
    if (daysUntilExpiry > reminderDays || daysUntilExpiry <= 0) continue;

    // Dedup: skip if already notified today
    const lastSent = _reminderSent.get(row.id);
    if (lastSent === todayKey) continue;
    _reminderSent.set(row.id, todayKey);

    try {
      // 1. Create in-app notification
      const notification = await Notification.create({
        userId: row.id,
        title: 'Password Expiring Soon',
        message: `Your password will expire in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}. Please change it to avoid losing access to the panel.`,
        type: 'warning',
        icon: 'bi bi-clock-history',
        link: '/settings/profile?forceChange=1&reason=expired',
        isGlobal: false,
        metadata: {
          event: 'password_expiry_reminder',
          daysUntilExpiry,
          expiresAt: new Date(now + (maxAge - age)).toISOString(),
        },
      });

      notified.push({
        userId: row.id,
        username: row.username,
        email: row.email,
        daysUntilExpiry,
        notificationId: notification._id,
      });

      logger.info(`Password expiry reminder sent to user ${row.username} (${row.email}): ${daysUntilExpiry} days remaining`);

      // 2. Send email reminder if SMTP is configured
      if (emailEnabled && row.email) {
        try {
          await alertsService.sendEmail(
            `Password Expiring in ${daysUntilExpiry} Days — Panelku`,
            `Hi ${row.username},\n\nYour Panelku password will expire in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}.\n\nTo avoid losing access, please change your password by visiting:\n${appConfig.appUrl}/settings/profile?forceChange=1&reason=expired\n\nThis is an automated reminder from your Panelku server.`,
            alertConfig
          );
          logger.info(`Password expiry email sent to ${row.email}`);
        } catch (emailErr) {
          logger.error(`Failed to send password expiry email to ${row.email}: ${emailErr.message}`);
        }
      }

      // 3. Send to webhook/chat channels (Telegram, Discord, Slack, Custom Webhook, WhatsApp)
      // Note: NOT using triggerAlert() because that also calls sendEmail() — email is already sent in step 2.
      // Each channel has its own try/catch inside alertsService, so fire-and-forget is safe.
      if (alertConfig) {
        const subject = `Password Expiring: ${row.username}`;
        const message = `🚨 Password for user "${row.username}" (${row.email || 'no email'}) will expire in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}.\n\nPlease visit: ${appConfig.appUrl}/settings/profile?forceChange=1&reason=expired`;
        alertsService.sendTelegram(message, alertConfig);
        alertsService.sendDiscord(subject, message, alertConfig);
        alertsService.sendSlack(subject, message, alertConfig);
        alertsService.sendWebhook(subject, message, alertConfig);
        alertsService.sendWhatsApp(message, alertConfig);
        logger.info(`Password expiry webhook alerts triggered for ${row.username}`);
      }
    } catch (err) {
      logger.error(`Failed to create password expiry notification for user ${row.username}: ${err.message}`);
    }
  }

  if (notified.length > 0) {
    logger.info(`Password expiry reminders sent: ${notified.length} user(s) notified`);
  }

  return notified;
}
