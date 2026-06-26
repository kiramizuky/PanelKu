import logger from '../config/logger.js';
import WafRule from '../models/WafRule.js';

// Simple lightweight WAF for Node.js Application level (protects the panel itself)
// It detects common SQLi and XSS payloads in query string and body

const SQLI_PATTERN = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|OR|AND)\b)|(--\s)|\/\*/i;
const XSS_PATTERN = /(<script.*?>.*?<\/script>)|(javascript:)|(onerror=)|(onload=)/i;
const DIR_TRAVERSAL = /(\.\.\/)|(\.\.\\)/;

// Cache global rules to avoid DB hits on every request
let globalRulesCache = {
  blacklistedIps: [],
  whitelistedIps: []
};

// We can export a function to refresh this cache when WAF rules change
export const refreshWafCache = async () => {
  try {
    const rules = await WafRule.find({});
    globalRulesCache.blacklistedIps = rules.filter(r => r.type === 'ip' && r.action === 'block').map(r => r.value);
    globalRulesCache.whitelistedIps = rules.filter(r => r.type === 'ip' && r.action === 'allow').map(r => r.value);
  } catch (error) {
    logger.error('Failed to refresh WAF cache:', error.message);
  }
};

export const wafMiddleware = (req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // 1. Check IP Whitelist (bypasses other checks)
  if (globalRulesCache.whitelistedIps.includes(clientIp)) {
    return next();
  }

  // 2. Check IP Blacklist
  if (globalRulesCache.blacklistedIps.includes(clientIp)) {
    logger.warn(`WAF Block (Blacklist IP): ${clientIp} -> ${req.method} ${req.originalUrl}`);
    return res.status(403).send('Forbidden: Your IP is blocked.');
  }

  // 3. Payload inspection (Query & Body)
  const inspectPayload = (payload) => {
    if (!payload) return false;
    const str = JSON.stringify(payload);
    if (SQLI_PATTERN.test(str)) return 'SQL Injection';
    if (XSS_PATTERN.test(str)) return 'XSS';
    if (DIR_TRAVERSAL.test(str)) return 'Directory Traversal';
    return false;
  };

  const queryThreat = inspectPayload(req.query);
  if (queryThreat) {
    logger.warn(`WAF Block (${queryThreat} in Query): ${clientIp} -> ${req.originalUrl}`);
    return res.status(403).send(`Forbidden: Suspected ${queryThreat}`);
  }

  const bodyThreat = inspectPayload(req.body);
  if (bodyThreat) {
    logger.warn(`WAF Block (${bodyThreat} in Body): ${clientIp} -> ${req.originalUrl}`);
    return res.status(403).send(`Forbidden: Suspected ${bodyThreat}`);
  }

  next();
};
