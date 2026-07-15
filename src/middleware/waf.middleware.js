import logger from '../config/logger.js';
import WafRule from '../models/WafRule.js';

// Simple lightweight WAF for Node.js Application level (protects the panel itself)
// It detects common SQLi and XSS payloads in query string and body

// Strict SQLi: require actual SQL attack context, not plain English words like "or"/"and"
// Matches: UNION SELECT, SELECT * FROM, OR 1=, DROP TABLE, INSERT INTO, --<space>, /* comment */
const SQLI_PATTERN = /(UNION\s+SELECT|SELECT\s+\S+\s+FROM|INSERT\s+INTO|DROP\s+TABLE|UPDATE\s+\w+\s+SET|DELETE\s+FROM|;\s*(DROP|DELETE|INSERT|UPDATE|SELECT)|\bOR\s+[\d'"(]|--\s|\/\*\s)/i;

// [MED-4 FIX] Comprehensive XSS pattern covering:
// - <script> tags (including encoded variants)
// - javascript: URI scheme
// - Inline event handlers (onerror, onload, onclick, onmouseover, etc.)
// - <img>, <svg>, <iframe>, <object>, <embed> XSS vectors
// - data:text/html execution
// - expression() CSS injection (IE)
// - HTML-encoded angle brackets (&#60; &#x3c;)
const XSS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script\s*>/i,           // <script>...</script>
  /<script[\s>]/i,                                      // <script src=...>
  /javascript\s*:/i,                                    // javascript: URI
  /data\s*:\s*text\s*\/\s*(html|javascript)/i,          // data:text/html or data:text/javascript
  /on\w+\s*=\s*["']?\s*(javascript|eval|alert|document|window)/i, // onclick="javascript:..."
  /\bon(?:error|load|click|mouseover|mouseout|focus|blur|submit|change|keyup|keydown|keypress|input|dblclick|contextmenu|drag|drop|resize|scroll|copy|cut|paste|select|abort|animationstart|animationend|canplay|ended|invalid|message|offline|online|open|pagehide|pageshow|popstate|reset|storage|toggle|touchstart|touchend|touchmove|unload|wheel)\s*=/i,
  /<\s*(img|svg|iframe|object|embed|link|meta|base|form|input|button|select|textarea|details|summary)\s[^>]*\bon\w+\s*=/i, // <img onerror=...>
  /<\s*iframe[^>]*src\s*=/i,                           // <iframe src=...>
  /expression\s*\(/i,                                   // CSS expression()
  /&#\s*[xX]?\s*[0-9a-fA-F]+\s*;.*?<\s*script/i,      // HTML entity encoded <script
  /vbscript\s*:/i,                                      // vbscript: URI
];

const DIR_TRAVERSAL = /(\.\.\/)|(\.\.\\)/;

// Endpoints that may carry arbitrary log/text content — skip deep body scan
const SKIP_BODY_SCAN_PATHS = [
  '/api/ai/chat',
  '/api/system/logs',
  '/api/backup',
  '/api/agent',     // cluster agent — metrics/log data may trigger false positives
  // [MED-3 FIX] File manager write/read/unzip endpoints may contain arbitrary file content.
  // e.g. editing nginx.conf which contains "../" patterns, or ZIP archives with relative paths.
  // Path traversal is already validated server-side by _resolvePath() in filemanager.service.js.
  '/api/filemanager/write',
  '/api/filemanager/read',
  '/api/filemanager/unzip',
];

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
  // Use req.ip which respects trust proxy setting — more reliable than raw header
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

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
    // [MED-4 FIX] Check all XSS patterns
    if (XSS_PATTERNS.some((p) => p.test(str))) return 'XSS';
    if (DIR_TRAVERSAL.test(str)) return 'Directory Traversal';
    return false;
  };

  const queryThreat = inspectPayload(req.query);
  if (queryThreat) {
    logger.warn(`WAF Block (${queryThreat} in Query): ${clientIp} -> ${req.originalUrl}`);
    return res.status(403).send(`Forbidden: Suspected ${queryThreat}`);
  }

  // Skip body inspection for endpoints that handle arbitrary text/log content
  const skipBodyScan = SKIP_BODY_SCAN_PATHS.some(p => req.path.startsWith(p));
  if (!skipBodyScan) {
    const bodyThreat = inspectPayload(req.body);
    if (bodyThreat) {
      logger.warn(`WAF Block (${bodyThreat} in Body): ${clientIp} -> ${req.originalUrl}`);
      return res.status(403).send(`Forbidden: Suspected ${bodyThreat}`);
    }
  }

  next();
};
