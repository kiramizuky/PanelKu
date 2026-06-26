import auditRepository from '../repositories/audit.repository.js';
import logger from '../config/logger.js';

/**
 * Audit logging middleware.
 * Logs all mutating requests (POST, PUT, PATCH, DELETE) to AuditLog.
 */
export const requestLogger = (req, res, next) => {
  const start = Date.now();

  // Only log mutating requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    res.on('finish', async () => {
      try {
        const duration = Date.now() - start;
        const status = res.statusCode < 400 ? 'success' : 'failure';

        await auditRepository.log({
          userId: req.user?._id,
          username: req.user?.username || 'anonymous',
          action: `${req.method} ${req.route?.path || req.path}`,
          resource: req.baseUrl?.split('/')[2] || req.path.split('/')[2],
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          status,
          duration,
          details: {
            statusCode: res.statusCode,
            query: req.query,
          },
        });
      } catch (err) {
        logger.warn('Audit log failed:', err.message);
      }
    });
  }

  next();
};
