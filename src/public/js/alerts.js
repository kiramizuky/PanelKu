const AlertsPage = {
  async init() {
    await this.loadConfig();
  },

  async loadConfig() {
    try {
      const res = await LP.get('/alerts/config');
      if (res?.success) {
        const c = res.data;
        
        // Telegram
        document.getElementById('telegramEnabled').checked = c.telegram.enabled;
        document.getElementById('botToken').value = c.telegram.botToken;
        document.getElementById('chatId').value = c.telegram.chatId;

        // Email
        document.getElementById('emailEnabled').checked = c.email.enabled;
        document.getElementById('smtpHost').value = c.email.smtpHost;
        document.getElementById('smtpPort').value = c.email.smtpPort;
        document.getElementById('smtpUser').value = c.email.smtpUser;
        document.getElementById('smtpPass').value = c.email.smtpPass;
        document.getElementById('fromAddress').value = c.email.fromAddress;
        document.getElementById('toAddress').value = c.email.toAddress;

        // Thresholds
        document.getElementById('cpuPercent').value = c.thresholds.cpuPercent || 90;
        document.getElementById('ramPercent').value = c.thresholds.ramPercent || 90;
        document.getElementById('diskPercent').value = c.thresholds.diskPercent || 90;

        // Discord
        if (c.discord) {
          document.getElementById('discordEnabled').checked = c.discord.enabled;
          document.getElementById('discordWebhookUrl').value = c.discord.webhookUrl;
        }

        // Slack
        if (c.slack) {
          document.getElementById('slackEnabled').checked = c.slack.enabled;
          document.getElementById('slackWebhookUrl').value = c.slack.webhookUrl;
        }

        // Custom Webhook
        if (c.webhook) {
          document.getElementById('webhookEnabled').checked = c.webhook.enabled;
          document.getElementById('customWebhookUrl').value = c.webhook.url;
        }
      }
    } catch (err) {
      LP.toast('Failed to load alert config', 'error');
    }
  },

  async saveConfig(e) {
    e.preventDefault();
    const payload = {
      telegram: {
        enabled: document.getElementById('telegramEnabled').checked,
        botToken: document.getElementById('botToken').value,
        chatId: document.getElementById('chatId').value
      },
      email: {
        enabled: document.getElementById('emailEnabled').checked,
        smtpHost: document.getElementById('smtpHost').value,
        smtpPort: parseInt(document.getElementById('smtpPort').value) || 587,
        smtpUser: document.getElementById('smtpUser').value,
        smtpPass: document.getElementById('smtpPass').value,
        fromAddress: document.getElementById('fromAddress').value,
        toAddress: document.getElementById('toAddress').value
      },
      discord: {
        enabled: document.getElementById('discordEnabled').checked,
        webhookUrl: document.getElementById('discordWebhookUrl').value
      },
      slack: {
        enabled: document.getElementById('slackEnabled').checked,
        webhookUrl: document.getElementById('slackWebhookUrl').value
      },
      webhook: {
        enabled: document.getElementById('webhookEnabled').checked,
        url: document.getElementById('customWebhookUrl').value
      },
      thresholds: {
        cpuPercent: parseInt(document.getElementById('cpuPercent').value) || 90,
        ramPercent: parseInt(document.getElementById('ramPercent').value) || 90,
        diskPercent: parseInt(document.getElementById('diskPercent').value) || 90
      }
    };

    try {
      const res = await LP.post('/alerts/config', payload);
      if (res?.success) {
        LP.toast('Alert configuration saved successfully', 'success');
      } else {
        LP.toast(res.message, 'error');
      }
    } catch (err) {
      LP.toast('Connection error', 'error');
    }
  },

  async testAlert() {
    try {
      LP.toast('Sending test alert...', 'info');
      const res = await LP.post('/alerts/test');
      if (res?.success) {
        LP.toast('Test alert dispatched!', 'success');
      } else {
        LP.toast(res.message, 'error');
      }
    } catch (err) {
      LP.toast('Connection error', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  AlertsPage.init();
});
