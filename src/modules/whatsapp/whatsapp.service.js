import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion 
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import pino from 'pino';
import axios from 'axios';
import WhatsappSession from '../../models/WhatsappSession.js';
import logger from '../../config/logger.js';

class WhatsappService {
  constructor() {
    this.sessions = new Map(); // runtime instance baileys
    this.qrs = new Map(); // runtime qr codes
    this.sessionsDir = path.resolve(process.cwd(), 'storage', 'whatsapp-sessions');
    mkdirSync(this.sessionsDir, { recursive: true });

    // Auto-restore sessions after boot
    setTimeout(() => this.restoreSessions(), 5000);
  }

  async restoreSessions() {
    try {
      const active = await WhatsappSession.find();
      for (const item of active) {
        if (item.status === 'connected') {
          logger.info(`Auto-restoring WhatsApp Session: ${item.session_name}`);
          this.initSession(item.session_name).catch(err => {
            logger.error(`Failed auto-restoring session ${item.session_name}:`, err.message);
          });
        }
      }
    } catch (e) {
      logger.error('Restore WhatsApp Sessions failed:', e.message);
    }
  }

  async getSessionStatus(sessionName) {
    const item = await WhatsappSession.findOne({ sessionName });
    if (!item) return null;
    return {
      id: item.id,
      sessionName: item.session_name,
      status: item.status,
      webhookUrl: item.webhook_url,
      qr: this.qrs.get(sessionName) || null
    };
  }

  async initSession(sessionName) {
    if (this.sessions.has(sessionName)) {
      return this.sessions.get(sessionName);
    }

    let dbSession = await WhatsappSession.findOne({ sessionName });
    if (!dbSession) {
      dbSession = await WhatsappSession.create({ sessionName, status: 'connecting' });
    }

    const authDir = path.join(this.sessionsDir, sessionName);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const silentLogger = pino({ level: 'silent' });

    const makeWASocketFn = makeWASocket.default || makeWASocket;
    const sock = makeWASocketFn({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger,
      browser: ['LinuxPanel', 'Chrome', '1.0.0'],
      keepAliveIntervalMs: 30000,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000
    });

    this.sessions.set(sessionName, sock);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrs.set(sessionName, qr);
      }

      if (connection === 'close') {
        this.qrs.delete(sessionName);
        const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
          ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut 
          : true;

        logger.warn(`WhatsApp Connection closed for ${sessionName}. Reconnecting: ${shouldReconnect}`);
        
        await WhatsappSession.findByIdAndUpdate(dbSession.id, { status: 'disconnected' });

        if (shouldReconnect) {
          this.sessions.delete(sessionName);
          setTimeout(() => this.initSession(sessionName), 5000);
        } else {
          this.sessions.delete(sessionName);
          // Delete auth dir
          try {
            await fs.rm(authDir, { recursive: true, force: true });
          } catch {}
        }
      } else if (connection === 'open') {
        logger.info(`WhatsApp Session ${sessionName} connected successfully!`);
        this.qrs.delete(sessionName);
        await WhatsappSession.findByIdAndUpdate(dbSession.id, { status: 'connected' });
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Forward messages to Webhook
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        const currentSession = await WhatsappSession.findOne({ sessionName });
        if (currentSession && currentSession.webhook_url) {
          for (const msg of m.messages) {
            if (!msg.key.fromMe) {
              this.forwardToWebhook(currentSession.webhook_url, sessionName, msg);
            }
          }
        }
      }
    });

    return sock;
  }

  async forwardToWebhook(url, sessionName, message) {
    try {
      await axios.post(url, {
        sessionName,
        message
      }, { timeout: 5000 });
    } catch (err) {
      logger.warn(`Failed forwarding to WhatsApp webhook ${url}:`, err.message);
    }
  }

  async sendMessage(sessionName, to, text, mediaUrl = null, mediaType = null, filename = null, mimetype = null) {
    const sock = this.sessions.get(sessionName);
    if (!sock) throw new Error('Session is not active or connected');

    const formattedTo = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;

    if (mediaUrl) {
      const options = {};
      if (mediaType === 'image') {
        return await sock.sendMessage(formattedTo, { image: { url: mediaUrl }, caption: text });
      } else if (mediaType === 'video') {
        return await sock.sendMessage(formattedTo, { video: { url: mediaUrl }, caption: text });
      } else if (mediaType === 'audio') {
        return await sock.sendMessage(formattedTo, { audio: { url: mediaUrl } });
      } else if (mediaType === 'document') {
        return await sock.sendMessage(formattedTo, { 
          document: { url: mediaUrl }, 
          fileName: filename || 'document', 
          mimetype: mimetype || 'application/octet-stream',
          caption: text
        });
      }
    }

    return await sock.sendMessage(formattedTo, { text });
  }

  async deleteSession(sessionName) {
    const sock = this.sessions.get(sessionName);
    if (sock) {
      try { sock.logout(); } catch {}
      this.sessions.delete(sessionName);
    }
    this.qrs.delete(sessionName);

    const dbSession = await WhatsappSession.findOne({ sessionName });
    if (dbSession) {
      await WhatsappSession.findByIdAndDelete(dbSession.id);
    }

    try {
      const authDir = path.join(this.sessionsDir, sessionName);
      await fs.rm(authDir, { recursive: true, force: true });
    } catch {}
    return true;
  }
}

export default new WhatsappService();
