/**
 * AI Repair Service — AI Auto-Repair & Intelligent Assistant
 *
 * Fase 18: GPT-powered log analysis, auto-fix suggestions, predictive alerts
 *
 * Features:
 *   - Log analysis with AI (OpenAI/Gemini/OpenRouter)
 *   - Auto-fix pipeline (apply fixes automatically or with approval)
 *   - Predictive alerts (trend analysis for CPU/RAM/Disk exhaustion)
 *   - System diagnostics (cross-module analysis)
 *   - Health trend analysis
 *   - AI-powered incident response
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import logger from '../../config/logger.js';
import Setting from '../../models/Setting.js';
import Notification from '../../models/Notification.js';
import alertsService from '../alerts/alerts.service.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ── Known fix patterns ─────────────────────────────────────────────
const FIX_PATTERNS = {
  'port.conflict': {
    name: 'Port Conflict',
    severity: 'critical',
    detect: (log) => /address already in use|EADDRINUSE|bind.*failed/i.test(log),
    diagnose: async () => {
      const { stdout } = await execAsync("ss -tlnp 2>/dev/null | head -20 || netstat -tlnp 2>/dev/null | head -20").catch(() => ({ stdout: '' }));
      return `Active ports:\n${stdout}`;
    },
    fix: async (port) => {
      port = parseInt(port) || 0;
      if (port > 0) {
        const { stdout } = await execAsync(`lsof -ti :${port} 2>/dev/null | head -1`).catch(() => ({ stdout: '' }));
        if (stdout.trim()) {
          await execAsync(`kill -9 ${stdout.trim()}`).catch(() => {});
          return `Killed process on port ${port} (PID: ${stdout.trim()})`;
        }
      }
      return 'No process found on that port. Try a different port.';
    },
  },
  'disk.full': {
    name: 'Disk Space Critical',
    severity: 'critical',
    detect: (log) => /no space left|disk full|ENOSPC|write error/i.test(log),
    diagnose: async () => {
      const { stdout } = await execAsync("df -h / 2>/dev/null | tail -1").catch(() => ({ stdout: '' }));
      return `Disk usage:\n${stdout}`;
    },
    fix: async () => {
      const cmds = [
        'journalctl --vacuum-time=3d 2>/dev/null',
        'docker system prune -f --volumes 2>/dev/null || true',
        'apt-get clean 2>/dev/null || yum clean all 2>/dev/null || true',
      ];
      for (const cmd of cmds) {
        try { await execAsync(cmd, { timeout: 60000 }); } catch { /* ignore */ }
      }
      return 'Cleaned journal logs (3d), Docker unused data, and package cache.';
    },
  },
  'service.down': {
    name: 'Service Not Running',
    severity: 'high',
    detect: (log) => /failed|not running|inactive|connection refused/i.test(log),
    diagnose: async (service) => {
      if (service) {
        const { stdout } = await execAsync(`systemctl status ${service} 2>/dev/null | head -10`).catch(() => ({ stdout: '' }));
        return `Service status:\n${stdout}`;
      }
      return 'Service not specified';
    },
    fix: async (service) => {
      if (!service) return 'No service specified';
      try {
        await execAsync(`systemctl restart ${service} 2>&1`, { timeout: 15000 });
        const { stdout } = await execAsync(`systemctl is-active ${service} 2>/dev/null`).catch(() => ({ stdout: '' }));
        return stdout.trim() === 'active'
          ? `${service} restarted successfully.`
          : `${service} restart attempted but still inactive.`;
      } catch (err) {
        throw new Error(`Failed to restart ${service}: ${err.message}`);
      }
    },
  },
  'permission.denied': {
    name: 'Permission Denied',
    severity: 'medium',
    detect: (log) => /permission denied|EACCES|access denied/i.test(log),
    diagnose: async (path) => {
      if (path) {
        try {
          const stat = await fs.stat(path).catch(() => null);
          if (stat) return `${path}: ${stat.mode.toString(8)} | owner: ${stat.uid}:${stat.gid}`;
        } catch { /* ignore */ }
      }
      return 'Path not specified or inaccessible';
    },
    fix: async (targetPath) => {
      if (!targetPath) return 'No path specified';
      try {
        await execAsync(`chmod -R 755 "${targetPath}" 2>/dev/null`).catch(() => {});
        return `Permissions reset on ${targetPath}`;
      } catch (err) {
        throw new Error(`Failed to fix permissions: ${err.message}`);
      }
    },
  },
  'high.cpu': {
    name: 'High CPU Usage',
    severity: 'high',
    detect: (metrics) => metrics?.cpu > 90,
    diagnose: async () => {
      const { stdout } = await execAsync("ps -eo pid,pcpu,pmem,cmd --sort=-pcpu 2>/dev/null | head -6").catch(() => ({ stdout: '' }));
      return `Top CPU processes:\n${stdout}`;
    },
    fix: async () => {
      // Just diagnostic, no automatic kill
      return 'High CPU detected. Check processes above. Consider restarting the offending service or adding resource limits.';
    },
  },
  'high.ram': {
    name: 'High RAM Usage',
    severity: 'high',
    detect: (metrics) => metrics?.ram > 90,
    diagnose: async () => {
      const { stdout } = await execAsync("ps -eo pid,pmem,rss,cmd --sort=-pmem 2>/dev/null | head -6").catch(() => ({ stdout: '' }));
      return `Top RAM processes:\n${stdout}`;
    },
    fix: async () => {
      await execAsync('sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null').catch(() => {});
      return 'Cleared OS cache. Consider restarting memory-heavy services if the issue persists.';
    },
  },
  'nginx.error': {
    name: 'Nginx Configuration Error',
    severity: 'high',
    detect: (log) => /nginx.*fail|nginx.*error|syntax error/i.test(log),
    diagnose: async () => {
      const { stdout } = await execAsync('nginx -t 2>&1').catch(() => ({ stdout: '' }));
      return `Nginx test:\n${stdout}`;
    },
    fix: async () => {
      // Can't auto-fix nginx config, but can suggest rollback
      return 'Nginx configuration test failed. Check /etc/nginx/nginx.conf for syntax errors. A backup of the previous config may be available at /etc/nginx/nginx.conf.bak.';
    },
  },
};

class AIRepairService {
  constructor() {
    this._predictiveCache = {};
    this._initialized = false;
  }

  // ── AI Provider Helpers ─────────────────────────────────────────

  async _getAIConfig() {
    const raw = await Setting.get('ai_repair_config') || '{}';
    return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
  }

  async _saveAIConfig(config) {
    await Setting.set('ai_repair_config', JSON.stringify(config), 'json');
  }

  async _callAI(prompt, systemPrompt = '') {
    const config = await this._getAIConfig();
    const provider = config.provider || 'openai';
    const apiKey = config.apiKey || '';
    const model = config.model || 'gpt-4o-mini';

    if (!apiKey) return null;

    try {
      if (provider === 'openai' || provider === 'openrouter') {
        const baseUrl = provider === 'openrouter'
          ? 'https://openrouter.ai/api/v1'
          : 'https://api.openai.com/v1';
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        };
        if (provider === 'openrouter') {
          headers['HTTP-Referer'] = 'https://github.com/kiramizuky/PanelKu';
          headers['X-Title'] = 'Panelku';
        }
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: provider === 'openrouter' ? (model || 'google/gemini-2.5-flash') : (model || 'gpt-4o-mini'),
            messages: [
              ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
              { role: 'user', content: prompt },
            ],
            max_tokens: 2000,
            temperature: 0.3,
          }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || JSON.stringify(data);
      } else if (provider === 'gemini') {
        const geminiModel = model.includes('/') ? model : `models/${model || 'gemini-1.5-flash'}`;
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${geminiModel}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }],
            }],
            generationConfig: { maxOutputTokens: 2000, temperature: 0.3 },
          }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data);
      }
    } catch (err) {
      logger.error(`AI call failed: ${err.message}`);
      return null;
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  LOG ANALYSIS
  // ═══════════════════════════════════════════════════════════════

  async analyzeLog(logText, logType = 'system', maxLines = 200) {
    const lines = logText.split('\n').filter(Boolean).slice(0, maxLines);
    const logSnippet = lines.join('\n');

    const results = {
      issues: [],
      patterns: [],
      summary: '',
      suggestions: [],
      autoFixable: [],
    };

    // 1. Rule-based pattern matching
    for (const [key, pattern] of Object.entries(FIX_PATTERNS)) {
      if (pattern.detect(logSnippet)) {
        const issue = {
          id: key,
          name: pattern.name,
          severity: pattern.severity,
          detected: true,
          autoFixable: !!pattern.fix,
        };

        // Run diagnosis
        try {
          const diag = await pattern.diagnose();
          issue.diagnosis = diag;
        } catch { /* ignore */ }

        results.issues.push(issue);
        if (pattern.fix) results.autoFixable.push(key);
      }
    }

    // 2. AI-powered analysis (if configured)
    const aiResult = await this._callAI(
      `Analyze these server logs and identify issues, patterns, and suggest fixes:\n\n${logSnippet}`,
      'You are a senior Linux server administrator. Analyze the logs and provide actionable insights. Format your response with: ISSUES, PATTERNS, RECOMMENDATIONS.'
    );

    if (aiResult) {
      results.aiAnalysis = aiResult;
    }

    // 3. Count error patterns
    const errorCounts = {};
    const errorPatterns = [
      { name: 'Failed connections', regex: /connection (refused|failed|timed out)/gi },
      { name: 'Permission errors', regex: /permission denied|eacces/gi },
      { name: 'Out of memory', regex: /out of memory|oom/gi },
      { name: 'File not found', regex: /no such file|not found/gi },
      { name: 'Timeout errors', regex: /timeout|timed out/gi },
    ];
    for (const pat of errorPatterns) {
      const matches = logSnippet.match(pat.regex);
      if (matches) errorCounts[pat.name] = matches.length;
    }
    results.errorCounts = errorCounts;

    // 4. Summary
    const totalErrors = Object.values(errorCounts).reduce((a, b) => a + b, 0);
    results.summary = results.issues.length > 0
      ? `Found ${results.issues.length} issue(s) and ${totalErrors} error pattern(s).`
      : `No known issues detected across ${lines.length} log lines.`;

    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  //  AUTO-FIX PIPELINE
  // ═══════════════════════════════════════════════════════════════

  async getAutoFixSuggestions(fixId, params = {}) {
    const pattern = FIX_PATTERNS[fixId];
    if (!pattern) throw new Error(`Unknown fix pattern: ${fixId}`);

    return {
      id: fixId,
      name: pattern.name,
      severity: pattern.severity,
      diagnosis: await pattern.diagnose(params.path || params.service || params.port),
      fixAvailable: !!pattern.fix,
      fixDescription: pattern.fix ? `Apply fix for: ${pattern.name}` : 'No automatic fix available',
    };
  }

  async applyAutoFix(fixId, params = {}) {
    const pattern = FIX_PATTERNS[fixId];
    if (!pattern) throw new Error(`Unknown fix pattern: ${fixId}`);
    if (!pattern.fix) throw new Error(`No automatic fix available for: ${pattern.name}`);

    // [SECURITY] Validate user-supplied parameters before they enter shell commands
    let context;
    if (params.service) {
      if (!/^[a-zA-Z0-9_\-]+$/.test(params.service)) throw new Error('Invalid service name');
      context = params.service;
    } else if (params.port) {
      const port = parseInt(params.port);
      if (isNaN(port) || port < 1 || port > 65535) throw new Error('Invalid port number (1-65535)');
      context = port;
    } else if (params.path) {
      // Only allow absolute paths starting with /
      if (typeof params.path !== 'string' || !params.path.startsWith('/') || params.path.includes('..') || /[;&|`$]/.test(params.path)) {
        throw new Error('Invalid path: must start with / and contain no shell metacharacters');
      }
      context = params.path;
    } else {
      context = '';
    }

    const diagnosis = await pattern.diagnose(context);

    try {
      const result = await pattern.fix(params.port || params.service || params.path);
      const message = `Auto-fix applied for "${pattern.name}": ${result}`;

      // Log the fix
      await Notification.create({
        title: `🔧 Auto-Fix: ${pattern.name}`,
        message,
        type: 'info',
        icon: 'auto_fix',
        isGlobal: true,
      });

      return {
        success: true,
        fix: fixId,
        name: pattern.name,
        message,
        diagnosis,
        result,
      };
    } catch (err) {
      throw new Error(`Auto-fix failed for "${pattern.name}": ${err.message}`);
    }
  }

  async runAutoDiagnostic() {
    const results = {
      timestamp: new Date().toISOString(),
      services: [],
      resources: {},
      docker: {},
      ports: [],
      issues: [],
      recommendations: [],
    };

    // 1. Check all core services
    const services = ['nginx', 'apache2', 'mysql', 'postgresql', 'redis-server', 'docker', 'ssh', 'ufw'];
    for (const svc of services) {
      try {
        const { stdout } = await execAsync(`systemctl is-active ${svc} 2>/dev/null || echo "inactive"`);
        const isActive = stdout.trim() === 'active';
        results.services.push({ name: svc, status: isActive ? 'running' : 'stopped' });
        if (!isActive) results.issues.push({ type: 'service', name: svc, severity: 'high' });
      } catch {
        results.services.push({ name: svc, status: 'unknown' });
      }
    }

    // 2. Check resources
    try {
      const si = await import('systeminformation');
      const [load, mem, disk] = await Promise.all([
        si.currentLoad(), si.mem(), si.fsSize(),
      ]);
      results.resources = {
        cpu: Math.round(load.currentLoad || 0),
        ram: mem.total ? Math.round((mem.used / mem.total) * 100) : 0,
        disk: (disk[0]?.use || 0),
        ramTotal: mem.total,
        ramUsed: mem.used,
        diskTotal: disk[0]?.size || 0,
        diskUsed: disk[0]?.used || 0,
      };

      if (results.resources.cpu > 90) results.issues.push({ type: 'resource', name: 'CPU', value: results.resources.cpu, severity: 'high' });
      if (results.resources.ram > 90) results.issues.push({ type: 'resource', name: 'RAM', value: results.resources.ram, severity: 'high' });
      if (results.resources.disk > 90) results.issues.push({ type: 'resource', name: 'Disk', value: results.resources.disk, severity: 'critical' });
    } catch { /* ignore */ }

    // 3. Check Docker
    try {
      const { stdout } = await execAsync('docker info --format "{{.Containers}}:{{.Images}}" 2>/dev/null || echo ""');
      const parts = stdout.trim().split(':');
      results.docker = {
        running: true,
        info: stdout.trim(),
        containers: parseInt(parts[0]) || 0,
        images: parseInt(parts[1]) || 0,
      };
    } catch {
      results.docker = { running: false };
    }

    // 4. Check listening ports
    try {
      const { stdout } = await execAsync('ss -tlnp 2>/dev/null | grep -E ":(80|443|3306|5432|6379|8080|27017)\\s" || echo ""');
      results.ports = stdout.split('\n').filter(Boolean).map(l => l.trim());
    } catch { /* ignore */ }

    // 5. Generate recommendations
    if (results.resources.disk > 85) {
      results.recommendations.push('Clean up disk: journalctl --vacuum-time=3d, docker system prune, apt-get clean');
    }
    if (results.services.filter(s => s.status === 'stopped').length > 0) {
      results.recommendations.push('Some core services are not running. Check the Auto-Heal module.');
    }
    if (!results.docker.running) {
      results.recommendations.push('Docker daemon is not running. Start it with: systemctl start docker');
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PREDICTIVE ALERTS
  // ═══════════════════════════════════════════════════════════════

  async analyzeTrends(hours = 24) {
    const results = {
      period: `${hours}h`,
      cpu: { samples: 0, trend: 'stable', prediction: null, confidence: 0 },
      ram: { samples: 0, trend: 'stable', prediction: null, confidence: 0 },
      disk: { samples: 0, trend: 'stable', prediction: null, confidence: 0 },
      warnings: [],
      recommendations: [],
    };

    try {
      const { getDb } = await import('../../core/db/sqlite.js');
      const db = getDb();
      const since = new Date(Date.now() - hours * 3600000).toISOString();

      const rows = db.prepare(`
        SELECT cpu, ram_used, ram_total, disk_used, disk_total, created_at
        FROM monitor_history
        WHERE created_at >= ? ORDER BY created_at ASC
      `).all(since);

      if (rows.length < 3) {
        results.warnings.push('Not enough data points for trend analysis. More monitoring data needed.');
        return results;
      }

      // Calculate trends
      const cpuVals = rows.map(r => r.cpu).filter(v => v > 0);
      const ramVals = rows.map(r => r.ram_total > 0 ? (r.ram_used / r.ram_total) * 100 : 0).filter(v => v > 0);
      const diskVals = rows.map(r => r.disk_total > 0 ? (r.disk_used / r.disk_total) * 100 : 0).filter(v => v > 0);

      results.cpu.samples = cpuVals.length;
      results.ram.samples = ramVals.length;
      results.disk.samples = diskVals.length;

      // Simple linear regression for prediction
      if (cpuVals.length >= 3) {
        const trend = this._calculateTrend(cpuVals);
        results.cpu.trend = trend.direction;
        results.cpu.current = cpuVals[cpuVals.length - 1];
        results.cpu.average = Math.round(cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length);
        if (trend.slope > 0.5) {
          results.cpu.prediction = `CPU may reach 100% in approximately ${Math.ceil((100 - trend.last) / trend.slope)} monitoring cycles`;
          results.cpu.confidence = Math.min(Math.round(trend.r2 * 100), 80);
          if (trend.last > 80) results.warnings.push(`CPU trending upward (${trend.direction}), currently at ${Math.round(trend.last)}%`);
        }
      }

      if (ramVals.length >= 3) {
        const trend = this._calculateTrend(ramVals);
        results.ram.trend = trend.direction;
        results.ram.current = ramVals[ramVals.length - 1];
        results.ram.average = Math.round(ramVals.reduce((a, b) => a + b, 0) / ramVals.length);
        if (trend.slope > 0.5) {
          results.ram.prediction = `RAM may reach 100% in approximately ${Math.ceil((100 - trend.last) / trend.slope)} monitoring cycles`;
          results.ram.confidence = Math.min(Math.round(trend.r2 * 100), 80);
          if (trend.last > 80) results.warnings.push(`RAM trending upward (${trend.direction}), currently at ${Math.round(trend.last)}%`);
        }
      }

      if (diskVals.length >= 3) {
        const trend = this._calculateTrend(diskVals);
        results.disk.trend = trend.direction;
        results.disk.current = diskVals[diskVals.length - 1];
        results.disk.average = Math.round(diskVals.reduce((a, b) => a + b, 0) / diskVals.length);
        if (trend.slope > 0.1) {
          const daysToFull = Math.ceil(((100 - trend.last) / trend.slope) * (hours / 24));
          results.disk.prediction = trend.slope > 0
            ? `Disk may reach capacity in approximately ${daysToFull} days at current growth rate`
            : 'Disk usage is stable or decreasing';
          results.disk.confidence = Math.min(Math.round(trend.r2 * 100), 90);
          if (trend.last > 85) results.warnings.push(`Disk usage trending upward (${trend.direction}), currently at ${Math.round(trend.last)}%`);
        }
      }

      // Recommendations
      if (results.cpu.trend === 'increasing' && results.cpu.current > 70) {
        results.recommendations.push('CPU trending high. Review running processes and consider adding resource limits.');
      }
      if (results.ram.trend === 'increasing' && results.ram.current > 70) {
        results.recommendations.push('RAM trending high. Consider adding swap or reducing service memory limits.');
      }
      if (results.disk.trend === 'increasing' && results.disk.current > 80) {
        results.recommendations.push('Disk filling up. Set up log rotation, prune Docker data, and add disk monitoring alerts.');
      }

      // AI-powered prediction
      const aiResult = await this._callAI(
        `Analyze these monitoring trends over the past ${hours} hours and provide a brief risk assessment:\n` +
        `CPU: avg ${results.cpu.average}%, trend ${results.cpu.trend}, current ${results.cpu.current}%\n` +
        `RAM: avg ${results.ram.average}%, trend ${results.ram.trend}, current ${results.ram.current}%\n` +
        `Disk: avg ${results.disk.average}%, trend ${results.disk.trend}, current ${results.disk.current}%\n` +
        `Data points: CPU=${results.cpu.samples}, RAM=${results.ram.samples}, Disk=${results.disk.samples}`,
        'You are a predictive infrastructure analyst. Provide a concise risk assessment and recommended actions in 3-4 sentences.'
      );

      if (aiResult) results.aiAssessment = aiResult;

    } catch (err) {
      logger.error(`Trend analysis error: ${err.message}`);
      results.warnings.push(`Analysis error: ${err.message}`);
    }

    return results;
  }

  _calculateTrend(values) {
    const n = values.length;
    const indices = values.map((_, i) => i);
    const sumX = indices.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = indices.reduce((a, _, i) => a + i * values[i], 0);
    const sumX2 = indices.reduce((a, b) => a + b * b, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
    const intercept = (sumY - slope * sumX) / n;
    const last = values[n - 1];

    // R² (coefficient of determination)
    const yMean = sumY / n;
    const ssRes = values.reduce((a, v, i) => a + (v - (slope * i + intercept)) ** 2, 0);
    const ssTot = values.reduce((a, v) => a + (v - yMean) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    const direction = slope > 0.1 ? 'increasing' : (slope < -0.1 ? 'decreasing' : 'stable');

    return { slope, intercept, last, r2: Math.max(0, r2), direction };
  }

  // ═══════════════════════════════════════════════════════════════
  //  AI CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  async getConfig() {
    const config = await this._getAIConfig();
    return {
      provider: config.provider || 'openai',
      model: config.model || 'gpt-4o-mini',
      hasApiKey: !!config.apiKey,
      autoFixEnabled: config.autoFixEnabled !== false,
      predictiveAlerts: config.predictiveAlerts !== false,
      notifyOnFix: config.notifyOnFix !== false,
    };
  }

  async saveConfig(data) {
    const config = {
      provider: data.provider || 'openai',
      model: data.model || 'gpt-4o-mini',
      autoFixEnabled: data.autoFixEnabled !== false,
      predictiveAlerts: data.predictiveAlerts !== false,
      notifyOnFix: data.notifyOnFix !== false,
    };

    // Only save API key if provided (don't overwrite with empty)
    if (data.apiKey) config.apiKey = data.apiKey;
    else {
      const existing = await this._getAIConfig();
      if (existing.apiKey) config.apiKey = existing.apiKey;
    }

    await this._saveAIConfig(config);
    return { message: 'AI configuration saved', config: { ...config, hasApiKey: !!config.apiKey } };
  }

  // ═══════════════════════════════════════════════════════════════
  //  SYSTEM HEALTH SCORE
  // ═══════════════════════════════════════════════════════════════

  async getHealthScore() {
    const diag = await this.runAutoDiagnostic();
    const trend = await this.analyzeTrends(1);

    let score = 100;

    // Deduct for stopped services
    const stoppedServices = diag.services.filter(s => s.status === 'stopped').length;
    score -= stoppedServices * 15;

    // Deduct for high resources
    if (diag.resources.cpu > 90) score -= 15;
    else if (diag.resources.cpu > 75) score -= 5;
    if (diag.resources.ram > 90) score -= 15;
    else if (diag.resources.ram > 75) score -= 5;
    if (diag.resources.disk > 95) score -= 25;
    else if (diag.resources.disk > 85) score -= 10;
    else if (diag.resources.disk > 75) score -= 5;

    // Deduct for negative trends
    if (trend.cpu.trend === 'increasing' && trend.cpu.current > 70) score -= 5;
    if (trend.ram.trend === 'increasing' && trend.ram.current > 70) score -= 5;
    if (trend.disk.trend === 'increasing' && trend.disk.current > 80) score -= 10;

    // Docker status
    if (!diag.docker.running) score -= 10;

    return {
      score: Math.max(0, Math.min(100, score)),
      level: score >= 90 ? 'excellent' : (score >= 70 ? 'good' : (score >= 50 ? 'fair' : 'poor')),
      issues: diag.issues.length,
      recommendations: diag.recommendations.length,
      servicesDown: stoppedServices,
      details: {
        services: diag.services.filter(s => s.status !== 'running'),
        resources: diag.resources,
        docker: diag.docker,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  SUGGEST FIX FROM LOG
  // ═══════════════════════════════════════════════════════════════

  async suggestFix(logText) {
    // First, try rule-based matching
    for (const [key, pattern] of Object.entries(FIX_PATTERNS)) {
      if (pattern.detect(logText)) {
        const diagnosis = await pattern.diagnose();
        return {
          matched: true,
          fixId: key,
          name: pattern.name,
          severity: pattern.severity,
          diagnosis,
          autoFixable: !!pattern.fix,
          message: `Detected: ${pattern.name}. ${pattern.fix ? 'Auto-fix is available.' : 'Manual intervention required.'}`,
        };
      }
    }

    // Fallback: ask AI
    const aiResult = await this._callAI(
      `Given this server log/error, identify the issue and suggest a fix command:\n\n${logText.slice(0, 2000)}`,
      'You are a senior Linux sysadmin. Identify the issue from the log and provide a single, specific bash command to fix it. If the issue requires multiple steps, list them briefly.'
    );

    if (aiResult) {
      return { matched: true, aiAnalysis: aiResult, autoFixable: false, message: 'AI analysis provided' };
    }

    return { matched: false, message: 'No matching fix pattern found for this log.' };
  }
}

export default new AIRepairService();
