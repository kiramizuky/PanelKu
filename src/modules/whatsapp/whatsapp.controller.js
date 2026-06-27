import whatsappService from './whatsapp.service.js';
import WhatsappSession from '../../models/WhatsappSession.js';
import { successResponse, errorResponse } from '../../helpers/response.js';
import qrcode from 'qrcode';

class WhatsappController {
  async listAccounts(req, res) {
    try {
      const list = await WhatsappSession.find();
      const detailedList = [];
      for (const item of list) {
        const live = await whatsappService.getSessionStatus(item.session_name);
        detailedList.push({
          id: item.id,
          sessionName: item.session_name,
          status: live ? live.status : item.status,
          webhookUrl: item.webhook_url,
          qr: live?.qr || null
        });
      }
      return successResponse(res, { accounts: detailedList });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getSession(req, res) {
    try {
      const { name } = req.params;
      const status = await whatsappService.getSessionStatus(name);
      if (!status) return errorResponse(res, 'Session not found', 404);

      let qrImage = null;
      if (status.qr) {
        qrImage = await qrcode.toDataURL(status.qr);
      }

      return successResponse(res, { ...status, qrImage });
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async initSession(req, res) {
    try {
      const { name } = req.body;
      if (!name) return errorResponse(res, 'Session name is required', 400);

      await whatsappService.initSession(name);
      return successResponse(res, null, `Session ${name} initialized. Please scan the QR.`);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async sendMessage(req, res) {
    try {
      const { name } = req.params;
      const { to, message, mediaUrl, mediaType, filename, mimetype } = req.body;
      if (!to) return errorResponse(res, 'Destination number (to) is required', 400);

      await whatsappService.sendMessage(name, to, message, mediaUrl, mediaType, filename, mimetype);
      return successResponse(res, null, 'Message sent successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async updateWebhook(req, res) {
    try {
      const { name } = req.params;
      const { webhookUrl } = req.body;

      const session = await WhatsappSession.findOne({ sessionName: name });
      if (!session) return errorResponse(res, 'Session not found', 404);

      await WhatsappSession.findByIdAndUpdate(session.id, { webhookUrl });
      return successResponse(res, null, 'Webhook URL updated successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async deleteSession(req, res) {
    try {
      const { name } = req.params;
      await whatsappService.deleteSession(name);
      return successResponse(res, null, 'Session deleted successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
}

export default new WhatsappController();
