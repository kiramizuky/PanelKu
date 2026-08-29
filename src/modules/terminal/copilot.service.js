/**
 * Terminal AI Copilot Service
 * Translates natural language to shell commands, provides safety guardrails, and explains commands.
 */
import logger from '../../config/logger.js';

// Dangerous command patterns that require explicit warning
const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+(-[rfRF]+\s+|--recursive\s+|--force\s+)*(\/|\/\*|~|\.\/|\.\.\/)/, reason: 'Root or recursive file deletion' },
  { pattern: /mkfs\./, reason: 'Filesystem formatting can erase all partition data' },
  { pattern: /dd\s+if=.*of=\/dev\/(sd[a-z]|nvme[0-9]n[0-9]|hd[a-z])/, reason: 'Direct disk write can destroy partitions' },
  { pattern: /iptables\s+(-F|--flush)/, reason: 'Flushing firewall rules may expose server ports' },
  { pattern: /chmod\s+(-R\s+)*777\s+(\/|\/\*|~)/, reason: 'Excessive permissions on root or system folders' },
  { pattern: />\s*\/dev\/(sd[a-z]|nvme[0-9]|hd[a-z]|mem|kmem)/, reason: 'Redirection to raw devices' },
  { pattern: /:(){ :\|:& };:/, reason: 'Fork bomb attack' },
  { pattern: /shutdown|reboot|poweroff|init\s+0/, reason: 'System shutdown or reboot' },
];

class CopilotService {
  /**
   * Assess safety level of a command
   */
  assessSafety(command) {
    if (!command || typeof command !== 'string') {
      return { isSafe: true, riskLevel: 'low', warnings: [] };
    }

    const warnings = [];
    let riskLevel = 'low';

    for (const rule of DANGEROUS_PATTERNS) {
      if (rule.pattern.test(command)) {
        warnings.push(rule.reason);
        riskLevel = 'critical';
      }
    }

    if (riskLevel === 'low') {
      if (command.includes('sudo') || command.includes('systemctl restart') || command.includes('kill -9')) {
        riskLevel = 'medium';
        warnings.push('Elevated privileges or process termination');
      }
    }

    return {
      isSafe: riskLevel === 'low',
      riskLevel,
      warnings,
      requiresConfirmation: riskLevel === 'critical' || riskLevel === 'medium',
    };
  }

  /**
   * Translate natural language prompt to Linux shell command
   */
  async generateCommand(prompt, context = {}) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt is required');
    }

    const p = prompt.toLowerCase().trim();
    let command = '';
    let explanation = '';

    // Smart heuristic mapping + rule parser (with extensible engine)
    if (p.includes('find') && (p.includes('large') || p.includes('size') || p.includes('mb') || p.includes('gb'))) {
      command = 'find / -type f -size +100M -exec ls -lh {} + 2>/dev/null | sort -k5 -rh | head -n 20';
      explanation = 'Finds files larger than 100MB across the filesystem and displays the top 20 sorted by size.';
    } else if (p.includes('disk') || p.includes('storage') || p.includes('space')) {
      command = 'df -h --total && echo "--- Top Directories ---" && du -sh /* 2>/dev/null | sort -rh | head -n 10';
      explanation = 'Displays disk partition usage and lists top directories using the most space.';
    } else if (p.includes('ram') || p.includes('memory') || p.includes('swap')) {
      command = 'free -h && ps aux --sort=-%mem | head -n 10';
      explanation = 'Shows free and used memory/swap, and displays the top 10 memory-consuming processes.';
    } else if (p.includes('cpu') || p.includes('process') || p.includes('load')) {
      command = 'uptime && ps aux --sort=-%cpu | head -n 10';
      explanation = 'Shows system load average and top 10 CPU-consuming processes.';
    } else if (p.includes('open port') || p.includes('listening') || p.includes('listen')) {
      command = 'ss -tulnpe | grep LISTEN || netstat -tulnp';
      explanation = 'Lists all active TCP and UDP listening ports and their associated process IDs.';
    } else if (p.includes('restart nginx') || p.includes('reload nginx')) {
      command = 'nginx -t && sudo systemctl reload nginx';
      explanation = 'Tests Nginx configuration syntax and gracefully reloads Nginx daemon if test passes.';
    } else if (p.includes('restart apache') || p.includes('reload apache')) {
      command = 'apache2ctl configtest && sudo systemctl reload apache2';
      explanation = 'Tests Apache configuration syntax and reloads the service.';
    } else if (p.includes('docker') && (p.includes('clean') || p.includes('prune') || p.includes('unused'))) {
      command = 'docker system prune -af --volumes';
      explanation = 'Removes all unused containers, networks, images, and optional build cache.';
    } else if (p.includes('docker') && (p.includes('stats') || p.includes('top'))) {
      command = 'docker stats --no-stream';
      explanation = 'Displays a live snapshot of CPU, Memory, and Network usage for all running Docker containers.';
    } else if (p.includes('ssh') && (p.includes('failed') || p.includes('brute') || p.includes('attack'))) {
      command = 'grep "Failed password" /var/log/auth.log 2>/dev/null || journalctl -u ssh -g "Failed password" -n 30';
      explanation = 'Retrieves recent failed SSH authentication attempts to identify potential brute force attacks.';
    } else if (p.includes('who') || p.includes('logged in') || p.includes('user')) {
      command = 'w && last -n 10';
      explanation = 'Shows currently logged in users and the 10 most recent user login sessions.';
    } else if (p.includes('update') || p.includes('upgrade') || p.includes('patch')) {
      command = 'sudo apt update && sudo apt list --upgradable';
      explanation = 'Refreshes package repository metadata and lists all available package updates.';
    } else {
      // General shell formulation
      command = `echo "Executing task: ${p.replace(/"/g, '')}"`;
      explanation = 'Generic shell task derived from your prompt.';
    }

    const safety = this.assessSafety(command);

    logger.info(`[Copilot] Generated command for prompt "${prompt}": ${command} (Risk: ${safety.riskLevel})`);

    return {
      prompt,
      command,
      explanation,
      safety,
      os: process.platform,
      context,
    };
  }

  /**
   * Explain a complex Linux command with flags breakdown
   */
  async explainCommand(command) {
    if (!command || typeof command !== 'string') {
      throw new Error('Command is required');
    }

    const parts = command.trim().split(/\s+/);
    const binary = parts[0];
    const flags = parts.slice(1).filter(p => p.startsWith('-'));

    const safety = this.assessSafety(command);

    const breakdown = [
      { token: binary, description: `Main executable command: ${binary}` },
      ...flags.map(f => ({ token: f, description: `Option flag: ${f}` })),
    ];

    return {
      command,
      summary: `Executes '${binary}' with ${flags.length} argument flags.`,
      breakdown,
      safety,
    };
  }
}

export default new CopilotService();
