import autohealService from '../modules/autoheal/autoheal.service.js';
import logger from '../config/logger.js';

/**
 * Health checking job — delegates to the Auto-Healing Engine.
 * The old hardcoded watchdog logic has been replaced by the
 * configurable AutoHeal module (accessible via /autoheal).
 */
export const startHealthJob = () => {
  autohealService.init().catch(err => {
    logger.error('Failed to initialize Auto-Healing Engine:', err.message);
  });
  logger.info('Health checking job initialized (delegated to AutoHeal Engine)');
};
