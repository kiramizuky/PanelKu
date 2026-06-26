import AlertConfig from '../../models/AlertConfig.js';
import logger from '../../config/logger.js';
// Node mailer for email might be needed, but we can just stub or use a basic fetch for Telegram
// To make it simple, we use fetch for Telegram. For Email, we can require nodemailer.
import nodemailer from 'nodemailer';

class AlertsService {
  async getConfig() {
    let config = await AlertConfig.findOne({ singleton: 'global' });
    if (!config) {
      config = await AlertConfig.create({});
    }
    return config;
  }

  async updateConfig(data) {
    let config = await AlertConfig.findOne({ singleton: 'global' });
    if (!config) {
      config = new AlertConfig();
    }
    
    if (data.telegram) config.telegram = { ...config.telegram, ...data.telegram };
    if (data.email) config.email = { ...config.email, ...data.email };
    if (data.discord) config.discord = { ...config.discord, ...data.discord };
    if (data.slack) config.slack = { ...config.slack, ...data.slack };
    if (data.webhook) config.webhook = { ...config.webhook, ...data.webhook };
    if (data.thresholds) config.thresholds = { ...config.thresholds, ...data.thresholds };

    await config.save();
    return config;
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
          text: `🚨 *Linux Panel Alert*\n\n${message}`,
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
        subject: `[Linux Panel] ${subject}`,
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
          content: `🚨 **[Linux Panel] ${subject}**\n${message}`
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
          text: `🚨 *[Linux Panel] ${subject}*\n${message}`
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

  async triggerAlert(subject, message) {
    const config = await this.getConfig();
    // Fire and forget
    this.sendTelegram(message, config);
    this.sendEmail(subject, message, config);
    this.sendDiscord(subject, message, config);
    this.sendSlack(subject, message, config);
    this.sendWebhook(subject, message, config);
  }
}

export default new AlertsService();
