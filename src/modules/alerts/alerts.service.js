import AlertConfig from '../../models/AlertConfig.js';
import logger from '../../config/logger.js';
import nodemailer from 'nodemailer';
import webpushService from './webpush.service.js';

class AlertsService {
  async getConfig() {
    return AlertConfig.findOne({ singleton: 'global' });
  }

  async updateConfig(data) {
    const existing = await AlertConfig.findOne({ singleton: 'global' });
    const merged = {
      telegram:   data.telegram   ? { ...existing.telegram,   ...data.telegram   } : existing.telegram,
      email:      data.email      ? { ...existing.email,      ...data.email      } : existing.email,
      discord:    data.discord    ? { ...existing.discord,    ...data.discord    } : existing.discord,
      slack:      data.slack      ? { ...existing.slack,      ...data.slack      } : existing.slack,
      webhook:    data.webhook    ? { ...existing.webhook,    ...data.webhook    } : existing.webhook,
      whatsapp:   data.whatsapp   ? { ...existing.whatsapp,   ...data.whatsapp   } : existing.whatsapp,
      thresholds: data.thresholds ? { ...existing.thresholds, ...data.thresholds } : existing.thresholds,
    };
    return AlertConfig.findOneAndUpdate({ singleton: 'global' }, merged, { upsert: true, new: true });
  }

  async sendTelegram(message, config) {
    if (!config.telegram.enabled || !config.telegram.botToken || !config.telegram.chatId) return;

    try {
      const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text: `🚨 *Panelku Alert*\n\n${message}`,
          parse_mode: 'Markdown'
        })
      });
      logger.info('Telegram alert sent.');
    } catch (error) {
      logger.error('Failed to send Telegram alert:', error.message);
    }
  }

  async sendEmail(subject, message, config) {
    if (!config.email.enabled || !config.email.smtpHost) return;

    try {
      const transporter = nodemailer.createTransport({
        host: config.email.smtpHost,
        port: config.email.smtpPort,
        secure: config.email.smtpPort === 465,
        auth: {
          user: config.email.smtpUser,
          pass: config.email.smtpPass
        }
      });

      await transporter.sendMail({
        from: config.email.fromAddress,
        to: config.email.toAddress,
        subject: `[Panelku] ${subject}`,
        text: message
      });
      logger.info('Email alert sent.');
    } catch (error) {
      logger.error('Failed to send Email alert:', error.message);
    }
  }

  async sendDiscord(subject, message, config) {
    if (!config.discord?.enabled || !config.discord?.webhookUrl) return;
    try {
      await fetch(config.discord.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `🚨 **[Panelku] ${subject}**\n${message}`
        })
      });
      logger.info('Discord alert sent.');
    } catch (error) {
      logger.error('Failed to send Discord alert:', error.message);
    }
  }

  async sendSlack(subject, message, config) {
    if (!config.slack?.enabled || !config.slack?.webhookUrl) return;
    try {
      await fetch(config.slack.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 *[Panelku] ${subject}*\n${message}`
        })
      });
      logger.info('Slack alert sent.');
    } catch (error) {
      logger.error('Failed to send Slack alert:', error.message);
    }
  }

  async sendWebhook(subject, message, config) {
    if (!config.webhook?.enabled || !config.webhook?.url) return;
    try {
      await fetch(config.webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'alert',
          subject,
          message,
          timestamp: new Date().toISOString()
        })
      });
      logger.info('Custom webhook alert sent.');
    } catch (error) {
      logger.error('Failed to send Webhook alert:', error.message);
    }
  }

  async sendWhatsApp(message, config) {
    if (!config.whatsapp?.enabled || !config.whatsapp?.phoneNumber) return;
    try {
      const whatsappService = (await import('../whatsapp/whatsapp.service.js')).default;
      const sessionName = 'default'; 
      await whatsappService.sendMessage(sessionName, config.whatsapp.phoneNumber, `🚨 *Panelku Alert*\n\n${message}`);
      logger.info('WhatsApp alert sent.');
    } catch (error) {
      logger.error('Failed to send WhatsApp alert:', error.message);
    }
  }

  async triggerAlert(subject, message) {
    const config = await this.getConfig();
    // Fire and forget multi-channel dispatch
    this.sendTelegram(message, config);
    this.sendEmail(subject, message, config);
    this.sendDiscord(subject, message, config);
    this.sendSlack(subject, message, config);
    this.sendWebhook(subject, message, config);
    this.sendWhatsApp(message, config);

    // Browser WebPush notification
    webpushService.sendNotification(null, {
      title: subject,
      body: message,
      url: '/alerts',
    }).catch(err => logger.warn(`[WebPush] triggerAlert push error: ${err.message}`));
  }

  /**
   * Enterprise Multi-Channel Alert & Incident Dispatcher
   */
  async dispatchMultiChannelAlert({ title, message, level = 'warning', metadata = {} }) {
    const icons = {
      critical: '🚨',
      warning: '⚠️',
      info: 'ℹ️',
      recovery: '✅',
      resolved: '🎉',
    };
    const icon = icons[level] || '📢';
    const formattedSubject = `${icon} [${level.toUpperCase()}] ${title}`;
    const formattedBody = `${message}\n\nTimestamp: ${new Date().toLocaleString()}\nHost: ${process.env.APP_HOST || 'Panelku Server'}`;

    // 1. Dispatch across all configured third-party channels
    await this.triggerAlert(formattedSubject, formattedBody);

    // 2. Persist to system notifications center
    try {
      const { default: Notification } = await import('../../models/Notification.js');
      await Notification.create({
        title: formattedSubject,
        message,
        type: level === 'critical' ? 'danger' : (level === 'warning' ? 'warning' : 'info'),
        icon: icon,
        is_global: 1,
        metadata: JSON.stringify(metadata),
      });
    } catch (err) {
      logger.warn(`Failed to store notification in DB: ${err.message}`);
    }

    return { success: true, title: formattedSubject, level };
  }

  async testChannel(channel) {
    const config = await this.getConfig();
    const testTitle = `Test Notification: ${channel.toUpperCase()}`;
    const testMsg = `This is a test notification from your Panelku Server (${new Date().toLocaleTimeString()}). All systems operational.`;

    switch (channel.toLowerCase()) {
      case 'telegram':
        await this.sendTelegram(testMsg, config);
        break;
      case 'discord':
        await this.sendDiscord(testTitle, testMsg, config);
        break;
      case 'slack':
        await this.sendSlack(testTitle, testMsg, config);
        break;
      case 'email':
        await this.sendEmail(testTitle, testMsg, config);
        break;
      case 'webhook':
        await this.sendWebhook(testTitle, testMsg, config);
        break;
      case 'whatsapp':
        await this.sendWhatsApp(testMsg, config);
        break;
      default:
        throw new Error(`Unsupported alert channel: ${channel}`);
    }

    return { success: true, channel, message: `Test alert dispatched to ${channel}` };
  }
}

export default new AlertsService();

