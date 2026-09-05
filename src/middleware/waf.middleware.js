import logger from '../config/logger.js';
import WafRule from '../models/WafRule.js';
import geoipService from '../modules/waf/geoip.service.js';
import { getDb, generateId, now } from '../core/db/sqlite.js';

// Strict SQLi pattern
const SQLI_PATTERN = /(UNION\s+SELECT|SELECT\s+\S+\s+FROM|INSERT\s+INTO|DROP\s+TABLE|UPDATE\s+\w+\s+SET|DELETE\s+FROM|;\s*(DROP|DELETE|INSERT|UPDATE|SELECT)|\bOR\s+[\d'"(]|--\s|\/\*\s)/i;

// Comprehensive XSS patterns
const XSS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script\s*>/i,
  /<script[\s>]/i,
  /javascript\s*:/i,
  /data\s*:\s*text\s*\/\s*(html|javascript)/i,
  /on\w+\s*=\s*["']?\s*(javascript|eval|alert|document|window)/i,
  /\bon(?:error|load|click|mouseover|mouseout|focus|blur|submit|change|keyup|keydown|keypress|input|dblclick|contextmenu|drag|drop|resize|scroll|copy|cut|paste|select|abort|animationstart|animationend|canplay|ended|invalid|message|offline|online|open|pagehide|pageshow|popstate|reset|storage|toggle|touchstart|touchend|touchmove|unload|wheel)\s*=/i,
  /<\s*(img|svg|iframe|object|embed|link|meta|base|form|input|button|select|textarea|details|summary)\s[^>]*\bon\w+\s*=/i,
  /<\s*iframe[^>]*src\s*=/i,
  /expression\s*\(/i,
  /&#\s*[xX]?\s*[0-9a-fA-F]+\s*;.*?<\s*script/i,
  /vbscript\s*:/i,
];

// Path Traversal pattern
const DIR_TRAVERSAL = /(\.\.\/)|(\.\.\\)/;

// RCE & Shellshock patterns
const RCE_PATTERNS = [
  /;\s*(cat|ls|id|whoami|curl|wget|bash|sh|nc|ncat|netcat|python|perl|ruby|php|uname|rm|chmod|chown)\b/i,
  /`\s*(cat|ls|id|whoami|curl|wget|bash|sh)\b/i,
  /\$\((cat|ls|id|whoami|curl|wget|bash|sh)\b/i,
  /\b(passthru|shell_exec|system|exec|popen|proc_open)\s*\(/i,
  /\(\)\s*\{\s*:;\s*\};/i, // Shellshock
];

// Known Bad Bot & Vulnerability Scanner User-Agents
const BAD_BOT_UA_PATTERN = /(nikto|sqlmap|acunetix|masscan|zgrab|gobuster|dirbuster|wpscan|nmap|havij|nessus|openvas|vega|arachni)/i;

// Honeypot trap paths
const HONEYPOT_PATHS = [
  '/.env',
  '/.env.local',
  '/.env.production',
  '/.git/config',
  '/.git/HEAD',
  '/wp-login.php',
  '/wp-admin',
  '/phpmyadmin',
  '/pma',
  '/actuator/health',
  '/telescope/requests',
  '/vendor/phpunit',
  '/solr/admin',
  '/aws/credentials',
  '/config.json',
];

// Endpoints that carry arbitrary text/log content
const SKIP_BODY_SCAN_PATHS = [
  '/api/ai/chat',
  '/api/system/logs',
  '/api/backup',
  '/api/agent',
  '/api/filemanager/write',
  '/api/filemanager/read',
  '/api/filemanager/unzip',
  '/api/database/explore',
  '/api/database/import/sql',
  '/api/database/import/csv',
  '/api/mongodb/query',
  '/api/git-deploy/webhook',
  '/api/plugins/git-deploy',
  '/plugins/db-admin-manager',
  '/api/plugins/db-admin-manager',
  '/api/whatsapp/accounts',
  '/api/ai-repair',
];

// Cache global rules to avoid DB hits on every request
let globalRulesCache = {
  blacklistedIps: [],
  whitelistedIps: [],
  blockedCountries: [],
};

export const refreshWafCache = async () => {
  try {
    const rules = await WafRule.find({});
    globalRulesCache.blacklistedIps = rules.filter(r => r.type === 'ip' && r.action === 'block').map(r => r.value);
    globalRulesCache.whitelistedIps = rules.filter(r => r.type === 'ip' && r.action === 'allow').map(r => r.value);
    globalRulesCache.blockedCountries = rules.filter(r => r.type === 'country' && r.action === 'block').map(r => r.value.toUpperCase());
  } catch (error) {
    logger.error('Failed to refresh WAF cache:', error.message);
  }
};

export const wafMiddleware = async (req, res, next) => {
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const rawPath = (req.path || req.originalUrl || '').toLowerCase();
  const userAgent = req.headers['user-agent'] || '';

  // 1. Check IP Whitelist (bypasses other checks)
  if (globalRulesCache.whitelistedIps.includes(clientIp)) {
    return next();
  }

  // 2. Check IP Blacklist
  if (globalRulesCache.blacklistedIps.includes(clientIp)) {
    logger.warn(`WAF Block (Blacklist IP): ${clientIp} -> ${req.method} ${req.originalUrl}`);
    return res.status(403).send('Forbidden: Your IP is blocked by WAF.');
  }

  // 3. Honeypot Bot Trap Interceptor
  const isHoneypot = HONEYPOT_PATHS.some(hp => rawPath === hp || rawPath.startsWith(hp + '/') || rawPath.startsWith(hp + '?'));
  if (isHoneypot) {
    logger.warn(`[Honeypot Trap Hit] ${clientIp} attempted to access bot trap: ${rawPath}`);
    try {
      const db = getDb();
      const hitId = generateId();
      const ts = now();
      db.prepare(`
        INSERT INTO honeypot_hits (id, ip, path, user_agent, payload, action, created_at)
        VALUES (?, ?, ?, ?, ?, 'auto_ban', ?)
      `).run(hitId, clientIp, rawPath, userAgent.substring(0, 512), JSON.stringify(req.query || {}).substring(0, 1024), ts);

      // Auto-blacklist
      const existing = db.prepare("SELECT id FROM waf_rules WHERE type = 'ip' AND value = ?").get(clientIp);
      if (!existing) {
        db.prepare(`
          INSERT INTO waf_rules (id, type, value, action, description, created_at, updated_at)
          VALUES (?, 'ip', ?, 'block', ?, ?, ?)
        `).run(generateId(), clientIp, `Honeypot Trap: ${rawPath}`, ts, ts);
        await refreshWafCache();
      }
    } catch (e) {
      logger.error('Honeypot recording error:', e.message);
    }
    return res.status(403).send('Forbidden: Access Denied');
  }

  // 4. Bad Bot User-Agent Filter
  if (userAgent && BAD_BOT_UA_PATTERN.test(userAgent)) {
    logger.warn(`WAF Block (Malicious Bot UA): ${clientIp} [${userAgent}] -> ${req.originalUrl}`);
    return res.status(403).send('Forbidden: Malicious scanner user-agent detected');
  }

  // 5. GeoIP Country Blocking
  if (globalRulesCache.blockedCountries.length > 0 && clientIp !== '127.0.0.1' && !clientIp.startsWith('192.168.') && !clientIp.startsWith('10.')) {
    try {
      const geo = await geoipService.resolveIp(clientIp);
      if (geo && geo.countryCode && globalRulesCache.blockedCountries.includes(geo.countryCode.toUpperCase())) {
        logger.warn(`WAF Block (Geo-Shield [${geo.countryCode}]): ${clientIp} -> ${req.originalUrl}`);
        return res.status(403).send(`Forbidden: Inbound traffic from ${geo.countryName || geo.countryCode} is geo-blocked.`);
      }
    } catch {
      // ignore lookup error
    }
  }

  // 6. Payload Inspection (Query & Body)
  const inspectPayload = (payload) => {
    if (!payload) return false;
    const str = JSON.stringify(payload);
    if (SQLI_PATTERN.test(str)) return 'SQL Injection';
    if (XSS_PATTERNS.some(p => p.test(str))) return 'XSS';
    if (DIR_TRAVERSAL.test(str)) return 'Directory Traversal';
    if (RCE_PATTERNS.some(p => p.test(str))) return 'Remote Code Execution (RCE)';
    return false;
  };

  const queryThreat = inspectPayload(req.query);
  if (queryThreat) {
    logger.warn(`WAF Block (${queryThreat} in Query): ${clientIp} -> ${req.originalUrl}`);
    return res.status(403).send(`Forbidden: Suspected ${queryThreat}`);
  }

  // Skip body inspection for endpoints that handle arbitrary text/log content
  const isNginxConfigPath = req.path.startsWith('/api/websites/') && req.path.endsWith('/nginx-config');
  const skipBodyScan = isNginxConfigPath || SKIP_BODY_SCAN_PATHS.some(p => req.path.startsWith(p));
  if (!skipBodyScan) {
    const bodyThreat = inspectPayload(req.body);
    if (bodyThreat) {
      logger.warn(`WAF Block (${bodyThreat} in Body): ${clientIp} -> ${req.originalUrl}`);
      return res.status(403).send(`Forbidden: Suspected ${bodyThreat}`);
    }
  }

  next();
};
