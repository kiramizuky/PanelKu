import systemService from './system.service.js';
import sshService from './ssh.service.js';
import phpService from './php.service.js';
import { success, errorResponse } from '../../helpers/response.js';
import { runSecurityScan, fixSecurityIssue } from '../../helpers/security-advisor.js';
import passwordPolicyService, { SCHEMA_VERSION } from './password-policy.service.js';

class SystemController {
  async getServicesStatus(req, res) {
    try {
      const servicesToWatch = ['nginx', 'apache2', 'docker', 'mysql', 'ssh', 'cron'];
      const statuses = {};
      
      for (const svc of servicesToWatch) {
        statuses[svc] = await systemService.getServiceStatus(svc);
      }
      return success(res, statuses);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get services status', 500);
    }
  }

  async manageService(req, res) {
    try {
      const { service, action } = req.body;
      if (!service || !action) return errorResponse(res, 'Service and action are required', 400);

      await systemService.manageService(service, action);
      return success(res, null, `Service ${service} ${action}ed successfully`);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to manage service', 500);
    }
  }

  async getInstallStatus(req, res) {
    try {
      const apps = ['mysql', 'postgres', 'docker', 'nginx', 'syncthing'];
      const statuses = {};
      for (const app of apps) {
        statuses[app] = await systemService.isInstalled(app);
      }
      return success(res, statuses);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get install status', 500);
    }
  }

  async installPackage(req, res) {
    try {
      const { package: pkgName, password } = req.body;
      if (!pkgName) return errorResponse(res, 'Package name is required', 400);
      
      // Fire and forget or wait. apt-get takes time.
      // We will wait for it so the frontend spinner stays active.
      await systemService.installPackage(pkgName, password);
      return success(res, null, `${pkgName} installed successfully`);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to install package', 500);
    }
  }

  async getPackageManagerInfo(req, res) {
    try {
      const info = await systemService.getPackageManagerInfo();
      return success(res, info);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get package manager info', 500);
    }
  }

  async runUpdate(req, res) {
    try {
      const log = await systemService.runUpdate();
      return success(res, { log }, 'System update completed');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to run update', 500);
    }
  }

  async runUpgrade(req, res) {
    try {
      const log = await systemService.runUpgrade();
      return success(res, { log }, 'System upgrade completed');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to run upgrade', 500);
    }
  }

  async runAptUpdate(req, res) {
    try {
      const info = await systemService.getPackageManagerInfo();
      const log = await systemService.runAptUpdate();
      return success(res, { log }, `${info.name} update completed`);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to run update', 500);
    }
  }

  async runAptUpgrade(req, res) {
    try {
      const info = await systemService.getPackageManagerInfo();
      const log = await systemService.runAptUpgrade();
      return success(res, { log }, `${info.name} upgrade completed`);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to run upgrade', 500);
    }
  }

  async reboot(req, res) {
    try {
      await systemService.reboot();
      return success(res, null, 'Reboot initiated');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to reboot', 500);
    }
  }

  async getAutoUpdate(req, res) {
    try {
      const enabled = await systemService.getAutoUpdate();
      return success(res, { enabled });
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get auto-update status', 500);
    }
  }

  async setAutoUpdate(req, res) {
    try {
      const { enabled } = req.body;
      await systemService.setAutoUpdate(!!enabled);
      return success(res, null, `Auto-update ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to set auto-update', 500);
    }
  }

  // ── Panel Update ───────────────────────────────────

  async getPanelVersion(req, res) {
    try {
      const data = await systemService.getPanelVersion();
      return success(res, data);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get panel version', 500);
    }
  }

  async checkPanelUpdate(req, res) {
    try {
      const data = await systemService.checkPanelUpdate();
      return success(res, data);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to check panel update', 500);
    }
  }

  async runPanelUpdate(req, res) {
    try {
      const { method = 'git', branch = 'main' } = req.body;
      const log = await systemService.runPanelUpdate(method, branch);
      return success(res, { log }, 'Panel update started');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to run panel update', 500);
    }
  }

  async restartPanel(req, res) {
    try {
      await systemService.restartPanel();
      return success(res, null, 'Panel is restarting');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to restart panel', 500);
    }
  }

  async getPanelAutoUpdate(req, res) {
    try {
      const data = await systemService.getPanelAutoUpdate();
      return success(res, data);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get panel auto-update', 500);
    }
  }

  async setPanelAutoUpdate(req, res) {
    try {
      const { enabled, frequency } = req.body;
      await systemService.setPanelAutoUpdate({ enabled: !!enabled, frequency: frequency || 'daily' });
      return success(res, null, `Panel auto-update ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to set panel auto-update', 500);
    }
  }

  async getSSHKeys(req, res) {
    try {
      const keys = await sshService.getKeys();
      return success(res, keys);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get SSH keys', 500);
    }
  }

  async addSSHKey(req, res) {
    try {
      const { key } = req.body;
      await sshService.addKey(key);
      return success(res, null, 'SSH key added successfully');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to add SSH key', 500);
    }
  }

  async deleteSSHKey(req, res) {
    try {
      const { id } = req.body;
      await sshService.deleteKey(id);
      return success(res, null, 'SSH key deleted successfully');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to delete SSH key', 500);
    }
  }

  async getSSHConfig(req, res) {
    try {
      const config = await sshService.getSSHConfig();
      return success(res, config);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get SSH config', 500);
    }
  }

  async updateSSHConfig(req, res) {
    try {
      const { port, passwordAuth } = req.body;
      await sshService.updateSSHConfig({ port, passwordAuth });
      return success(res, null, 'SSH configuration updated successfully');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to update SSH config', 500);
    }
  }

  async getPHPConfig(req, res) {
    try {
      const config = await phpService.getConfig();
      return success(res, config);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get PHP config', 500);
    }
  }

  async updatePHPConfig(req, res) {
    try {
      await phpService.updateConfig(req.body);
      return success(res, null, 'PHP-FPM configuration updated successfully');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to update PHP config', 500);
    }
  }

  async getAuditStats(req, res) {
    try {
      const stats = await systemService.getAuditStats();
      return success(res, stats);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get audit stats', 500);
    }
  }

  async getAuditLogs(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const logs = await systemService.getAuditLogs(limit);
      return success(res, logs);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get audit logs', 500);
    }
  }

  async runSecurityScan(req, res) {
    try {
      const result = await runSecurityScan();
      return success(res, result);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to run security scan', 500);
    }
  }

  async fixSecurityIssue(req, res) {
    try {
      const { id } = req.body;
      if (!id) return errorResponse(res, 'Issue ID is required', 400);
      const result = await fixSecurityIssue(id);
      return success(res, result, result.message);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async getTailscaleStatus(req, res) {
    try {
      const status = await systemService.getTailscaleStatus();
      return success(res, status);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async installTailscale(req, res) {
    try {
      await systemService.installTailscale();
      return success(res, null, 'Tailscale installed successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async tailscaleUp(req, res) {
    try {
      const { authkey } = req.body;
      const result = await systemService.tailscaleUp(authkey);
      return success(res, result, 'Tailscale up command executed');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  async tailscaleDown(req, res) {
    try {
      await systemService.tailscaleDown();
      return success(res, null, 'Tailscale down command executed successfully');
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }

  // ── Password Policy ───────────────────────────────────

  async getPasswordPolicy(req, res) {
    try {
      const policy = await passwordPolicyService.getPolicy();
      return success(res, policy);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get password policy', 500);
    }
  }

  async updatePasswordPolicy(req, res) {
    try {
      const auditInfo = {
        userId:    req.user?._id || req.user?.id,
        username:  req.user?.username,
        ip:        req.ip || req.connection?.remoteAddress,
        userAgent: req.headers?.['user-agent'] || '',
      };
      const policy = await passwordPolicyService.savePolicy(req.body, auditInfo);
      return success(res, policy, 'Password policy updated');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to update password policy', error.statusCode || 500);
    }
  }

  async resetPasswordPolicy(req, res) {
    try {
      const auditInfo = {
        userId:    req.user?._id || req.user?.id,
        username:  req.user?.username,
        ip:        req.ip || req.connection?.remoteAddress,
        userAgent: req.headers?.['user-agent'] || '',
      };
      const policy = await passwordPolicyService.resetPolicy(auditInfo);
      return success(res, policy, 'Password policy reset to defaults');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to reset password policy', 500);
    }
  }

  async validatePassword(req, res) {
    try {
      const { password } = req.body;
      if (!password) return errorResponse(res, 'Password is required', 400);
      const result = await passwordPolicyService.validatePassword(password);
      return success(res, result);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to validate password', 500);
    }
  }

  async exportPasswordPolicy(req, res) {
    try {
      // Wrap policy with schema version for forward compatibility
      const policy = await passwordPolicyService.getPolicy();
      const exportData = {
        _schema: { version: SCHEMA_VERSION },
        ...policy,
      };
      return success(res, exportData);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to export password policy', 500);
    }
  }

  async importPasswordPolicy(req, res) {
    try {
      const auditInfo = {
        userId:    req.user?._id || req.user?.id,
        username:  req.user?.username,
        ip:        req.ip || req.connection?.remoteAddress,
        userAgent: req.headers?.['user-agent'] || '',
      };
      const policy = await passwordPolicyService.importPolicy(req.body, auditInfo);
      return success(res, policy, 'Password policy imported successfully');
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to import password policy', error.statusCode || 500);
    }
  }

  async previewUrlPasswordPolicy(req, res) {
    try {
      const { url } = req.query;
      if (!url) return errorResponse(res, 'URL query parameter is required', 400);

      const result = await passwordPolicyService.fetchPolicyFromUrl(url);
      // Return the fetched policy for preview (no changes made yet)
      return success(res, {
        source: result.source,
        schema: result.schema,
        data: result.data,
      });
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to fetch policy from URL', error.statusCode || 502);
    }
  }

  async getPasswordPolicyHistory(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const db = (await import('../../core/db/sqlite.js')).getDb();

      const rows = db.prepare(`
        SELECT * FROM audit_logs
        WHERE action IN ('PASSWORD_POLICY_UPDATED', 'PASSWORD_POLICY_RESET', 'PASSWORD_POLICY_IMPORTED')
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);

      // Parse JSON details and build diff-friendly entries
      const history = rows.map((r) => {
        let details = {};
        try { details = JSON.parse(r.details || '{}'); } catch { details = { raw: r.details }; }

        // Build a human-readable summary
        let summary = '';
        if (r.action === 'PASSWORD_POLICY_UPDATED') {
          summary = 'Policy settings updated';
          // Compute field-level changes
          const changes = [];
          const prev = details.previous || {};
          const curr = details.updated || {};
          for (const key of Object.keys(curr)) {
            if (key === 'action') continue;
            if (JSON.stringify(prev[key]) !== JSON.stringify(curr[key])) {
              changes.push({
                field: key,
                from: prev[key],
                to: curr[key],
              });
            }
          }
          details.changes = changes;
        } else if (r.action === 'PASSWORD_POLICY_RESET') {
          summary = 'Policy reset to defaults';
          const prev = details.previous || {};
          const defs = details.defaults || {};
          const changes = [];
          for (const key of Object.keys(defs)) {
            if (JSON.stringify(prev[key]) !== JSON.stringify(defs[key])) {
              changes.push({
                field: key,
                from: prev[key],
                to: defs[key],
              });
            }
          }
          details.changes = changes;
        } else if (r.action === 'PASSWORD_POLICY_IMPORTED') {
          summary = 'Policy imported from JSON';
          const imported = details.imported || {};
          const changes = Object.entries(imported).map(([key, val]) => ({
            field: key,
            from: undefined,
            to: val,
          })).filter(c => c.field !== 'action' && c.field !== 'schemaVersion');
          details.changes = changes;
        }

        return {
          id: r.id,
          timestamp: r.created_at,
          username: r.username || 'system',
          action: r.action,
          summary,
          details,
        };
      });

      return success(res, history);
    } catch (error) {
      return errorResponse(res, error.message || 'Failed to get password policy history', 500);
    }
  }
}

export default new SystemController();
