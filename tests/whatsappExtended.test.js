/**
 * Extended Unit Tests for WhatsApp Module:
 * - src/modules/whatsapp/whatsapp.service.js
 * - src/modules/whatsapp/whatsapp.controller.js
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Boom } from '@hapi/boom';

const mockSockEvents = new Map();
const mockSock = {
  ev: {
    on: jest.fn((event, handler) => {
      mockSockEvents.set(event, handler);
    }),
  },
  sendMessage: jest.fn().mockResolvedValue({ key: { id: 'msg123' } }),
  logout: jest.fn(),
};

const mockMakeWASocket = jest.fn(() => mockSock);

jest.unstable_mockModule('@whiskeysockets/baileys', () => ({
  default: mockMakeWASocket,
  useMultiFileAuthState: jest.fn().mockResolvedValue({
    state: {},
    saveCreds: jest.fn(),
  }),
  DisconnectReason: { loggedOut: 401 },
  fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 0] }),
}));

const mockWhatsappSession = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
};

jest.unstable_mockModule('../src/models/WhatsappSession.js', () => ({
  default: mockWhatsappSession,
}));

const mockAxios = {
  post: jest.fn().mockResolvedValue({ data: { status: 'received' } }),
};

jest.unstable_mockModule('axios', () => ({
  default: mockAxios,
  ...mockAxios,
}));

const mockFs = {
  rm: jest.fn().mockResolvedValue(undefined),
};

jest.unstable_mockModule('fs/promises', () => ({
  default: mockFs,
  ...mockFs,
}));

const mockQrcode = {
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockqr'),
};

jest.unstable_mockModule('qrcode', () => ({
  default: mockQrcode,
  ...mockQrcode,
}));

const { default: whatsappService } = await import('../src/modules/whatsapp/whatsapp.service.js');
const { default: whatsappController } = await import('../src/modules/whatsapp/whatsapp.controller.js');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  mockSockEvents.clear();
  whatsappService.sessions.clear();
  whatsappService.qrs.clear();
  jest.clearAllMocks();
});

describe('WhatsappService — Session Lifecycle & Baileys Events', () => {
  test('restoreSessions auto-restores connected sessions', async () => {
    mockWhatsappSession.find.mockResolvedValue([
      { session_name: 'sess_live', status: 'connected' },
      { session_name: 'sess_dead', status: 'disconnected' },
    ]);

    const initSpy = jest.spyOn(whatsappService, 'initSession').mockResolvedValue(mockSock);
    await whatsappService.restoreSessions();
    expect(initSpy).toHaveBeenCalledWith('sess_live');
    expect(initSpy).not.toHaveBeenCalledWith('sess_dead');
    initSpy.mockRestore();
  });

  test('initSession creates socket, caches instance, and registers event handlers', async () => {
    mockWhatsappSession.findOne.mockResolvedValue({ id: 10, session_name: 'sess_test', status: 'connecting' });

    const sock = await whatsappService.initSession('sess_test');
    expect(sock).toBeDefined();
    expect(mockMakeWASocket).toHaveBeenCalled();
    expect(mockSock.ev.on).toHaveBeenCalledWith('connection.update', expect.any(Function));
    expect(mockSock.ev.on).toHaveBeenCalledWith('creds.update', expect.any(Function));
    expect(mockSock.ev.on).toHaveBeenCalledWith('messages.upsert', expect.any(Function));

    // Calling again returns cached session
    const cached = await whatsappService.initSession('sess_test');
    expect(cached).toBe(sock);
  });

  test('handles connection.update for QR, open, and close events', async () => {
    mockWhatsappSession.findOne.mockResolvedValue({ id: 10, session_name: 'sess_test' });

    await whatsappService.initSession('sess_test');
    const updateHandler = mockSockEvents.get('connection.update');
    expect(updateHandler).toBeDefined();

    // 1. QR Code update
    await updateHandler({ qr: 'mock_qr_string_123' });
    expect(whatsappService.qrs.get('sess_test')).toBe('mock_qr_string_123');

    // 2. Connection open
    await updateHandler({ connection: 'open' });
    expect(whatsappService.qrs.has('sess_test')).toBe(false);
    expect(mockWhatsappSession.findByIdAndUpdate).toHaveBeenCalledWith(10, { status: 'connected' });

    // 3. Connection close with loggedOut reason
    const loggedOutBoom = new Boom('Logged out', { statusCode: 401 });
    await updateHandler({
      connection: 'close',
      lastDisconnect: { error: loggedOutBoom },
    });
    expect(mockWhatsappSession.findByIdAndUpdate).toHaveBeenCalledWith(10, { status: 'disconnected' });
  });

  test('handles messages.upsert and forwards incoming messages to webhook', async () => {
    mockWhatsappSession.findOne.mockResolvedValue({
      session_name: 'sess_webhook',
      webhook_url: 'https://api.example.com/wa-webhook',
    });

    await whatsappService.initSession('sess_webhook');
    const upsertHandler = mockSockEvents.get('messages.upsert');
    expect(upsertHandler).toBeDefined();

    await upsertHandler({
      type: 'notify',
      messages: [
        { key: { fromMe: false }, message: { conversation: 'Hello from client' } },
        { key: { fromMe: true }, message: { conversation: 'Hello from panel' } },
      ],
    });

    expect(mockAxios.post).toHaveBeenCalledTimes(1);
    expect(mockAxios.post).toHaveBeenCalledWith(
      'https://api.example.com/wa-webhook',
      expect.objectContaining({ sessionName: 'sess_webhook' }),
      expect.any(Object)
    );
  });

  test('sendMessage dispatches text and rich media (image, video, audio, document)', async () => {
    whatsappService.sessions.set('sess_media', mockSock);

    // 1. Text
    await whatsappService.sendMessage('sess_media', '62811111111', 'Plain text');
    expect(mockSock.sendMessage).toHaveBeenCalledWith('62811111111@s.whatsapp.net', { text: 'Plain text' });

    // 2. Image
    await whatsappService.sendMessage('sess_media', '62811111111', 'Look at photo', 'https://img.com/p.jpg', 'image');
    expect(mockSock.sendMessage).toHaveBeenCalledWith('62811111111@s.whatsapp.net', {
      image: { url: 'https://img.com/p.jpg' },
      caption: 'Look at photo',
    });

    // 3. Video
    await whatsappService.sendMessage('sess_media', '62811111111', 'Look at clip', 'https://vid.com/v.mp4', 'video');
    expect(mockSock.sendMessage).toHaveBeenCalledWith('62811111111@s.whatsapp.net', {
      video: { url: 'https://vid.com/v.mp4' },
      caption: 'Look at clip',
    });

    // 4. Audio
    await whatsappService.sendMessage('sess_media', '62811111111', null, 'https://aud.com/a.mp3', 'audio');
    expect(mockSock.sendMessage).toHaveBeenCalledWith('62811111111@s.whatsapp.net', {
      audio: { url: 'https://aud.com/a.mp3' },
    });

    // 5. Document
    await whatsappService.sendMessage('sess_media', '62811111111', 'Report doc', 'https://doc.com/r.pdf', 'document', 'report.pdf', 'application/pdf');
    expect(mockSock.sendMessage).toHaveBeenCalledWith('62811111111@s.whatsapp.net', {
      document: { url: 'https://doc.com/r.pdf' },
      fileName: 'report.pdf',
      mimetype: 'application/pdf',
      caption: 'Report doc',
    });
  });

  test('deleteSession cleans runtime socket, QR, and disk auth files', async () => {
    whatsappService.sessions.set('sess_to_del', mockSock);
    whatsappService.qrs.set('sess_to_del', 'some_qr');
    mockWhatsappSession.findOne.mockResolvedValue({ id: 55, session_name: 'sess_to_del' });

    const deleted = await whatsappService.deleteSession('sess_to_del');
    expect(deleted).toBe(true);
    expect(mockSock.logout).toHaveBeenCalled();
    expect(whatsappService.sessions.has('sess_to_del')).toBe(false);
    expect(whatsappService.qrs.has('sess_to_del')).toBe(false);
    expect(mockWhatsappSession.findByIdAndDelete).toHaveBeenCalledWith(55);
    expect(mockFs.rm).toHaveBeenCalled();
  });
});

describe('WhatsappController — Extended Endpoints', () => {
  test('listAccounts returns active list with runtime status and qr', async () => {
    mockWhatsappSession.find.mockResolvedValue([
      { id: 1, session_name: 's1', status: 'connected', webhook_url: 'http://wh' },
    ]);
    jest.spyOn(whatsappService, 'getSessionStatus').mockResolvedValue({
      id: 1,
      sessionName: 's1',
      status: 'connected',
      webhookUrl: 'http://wh',
      qr: 'qr_abc',
    });

    const res = mockRes();
    await whatsappController.listAccounts({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.accounts[0].qr).toBe('qr_abc');
  });

  test('getSession returns base64 QR code image when QR is present', async () => {
    jest.spyOn(whatsappService, 'getSessionStatus').mockResolvedValue({
      id: 2,
      sessionName: 's2',
      status: 'connecting',
      qr: 'raw_qr_data',
    });

    const res = mockRes();
    await whatsappController.getSession({ params: { name: 's2' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.qrImage).toContain('data:image/png;base64');
  });

  test('initSession, sendMessage, and deleteSession endpoints', async () => {
    jest.spyOn(whatsappService, 'initSession').mockResolvedValue(mockSock);
    jest.spyOn(whatsappService, 'sendMessage').mockResolvedValue({});
    jest.spyOn(whatsappService, 'deleteSession').mockResolvedValue(true);

    const resInit = mockRes();
    await whatsappController.initSession({ body: { name: 's3' } }, resInit);
    expect(resInit.statusCode).toBe(200);

    const resSend = mockRes();
    await whatsappController.sendMessage(
      { params: { name: 's3' }, body: { to: '62811111', message: 'Hello media', mediaUrl: 'http://img.png', mediaType: 'image' } },
      resSend
    );
    expect(resSend.statusCode).toBe(200);

    const resDel = mockRes();
    await whatsappController.deleteSession({ params: { name: 's3' } }, resDel);
    expect(resDel.statusCode).toBe(200);
  });
});
