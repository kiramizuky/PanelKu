import { Router } from 'express';
import whatsappController from './whatsapp.controller.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

// Require authenticated panel users
router.use(requireAuth);

router.get('/accounts', whatsappController.listAccounts);
router.post('/accounts', whatsappController.initSession);
router.get('/accounts/:name', whatsappController.getSession);
router.post('/accounts/:name/send', whatsappController.sendMessage);
router.post('/accounts/:name/webhook', whatsappController.updateWebhook);
router.delete('/accounts/:name', whatsappController.deleteSession);

export default router;

/**
 * @swagger
 * components:
 *   schemas:
 *     WhatsappAccount:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: UUID of the session
 *         sessionName:
 *           type: string
 *           description: Unique name identifying the WA session
 *         status:
 *           type: string
 *           enum: [connecting, connected, disconnected]
 *         webhookUrl:
 *           type: string
 *           description: Webhook target to forward incoming messages
 *         qr:
 *           type: string
 *           description: Raw QR code text
 * 
 * /api/whatsapp/accounts:
 *   get:
 *     summary: Retrieve list of all WhatsApp accounts
 *     responses:
 *       200:
 *         description: List of accounts
 *   post:
 *     summary: Initialize a new WhatsApp account session
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique session identifier
 * 
 * /api/whatsapp/accounts/{name}:
 *   get:
 *     summary: Get details & live QR image of a specific session
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session details + base64 QR image
 *   delete:
 *     summary: Delete a session and logout
 * 
 * /api/whatsapp/accounts/{name}/send:
 *   post:
 *     summary: Send text message to a WhatsApp number
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - message
 *             properties:
 *               to:
 *                 type: string
 *                 description: Target phone number (e.g. 628123456789)
 *               message:
 *                 type: string
 *                 description: Text content to send
 * 
 * /api/whatsapp/accounts/{name}/webhook:
 *   post:
 *     summary: Configure webhook target URL for message forwarding
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - webhookUrl
 *             properties:
 *               webhookUrl:
 *                 type: string
 *                 description: HTTP URL to post incoming messages to
 */
