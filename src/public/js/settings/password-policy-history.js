/**
 * Password Policy History Page Controller
 * Displays a timeline of policy changes with diff view.
 */
const PolicyHistoryPage = {
  _loading: false,

  async load() {
    if (this._loading) return;
    this._loading = true;

    const container = document.getElementById('historyTimeline');
    container.innerHTML = '<div class="text-center py-5"><span class="spinner-border spinner-border-sm me-2" style="width:14px; height:14px;"></span><span style="color:var(--text-muted); font-size:13px;">Loading history...</span></div>';

    try {
      const res = await LP.api('/api/system/password-policy/history?limit=50');
      const entries = res.data || [];

      if (entries.length === 0) {
        container.innerHTML = `
          <div class="text-center py-5" style="color:var(--text-muted);">
            <i class="bi bi-inbox" style="font-size:32px; display:block; margin-bottom:10px;"></i>
            <p style="font-size:13px;">No password policy changes recorded yet.</p>
            <p style="font-size:11px;">Changes will appear here after you update the password policy.</p>
          </div>
        `;
        return;
      }

      let html = '<div style="position:relative; padding-left:20px;">';

      // Build timeline
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;

        html += this._renderTimelineEntry(entry, isLast);
      }

      html += '</div>';
      container.innerHTML = html;

      // Animate entries
      const items = container.querySelectorAll('.policy-history-entry');
      items.forEach((el, idx) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        setTimeout(() => {
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        }, idx * 50);
      });

    } catch (err) {
      const container = document.getElementById('historyTimeline');
      container.innerHTML = `
        <div class="text-center py-5" style="color:var(--text-muted);">
          <i class="bi bi-exclamation-triangle" style="font-size:32px; display:block; margin-bottom:10px; color:#ef4444;"></i>
          <p style="font-size:13px;">Failed to load history: ${LP.escHtml(err.message || err)}</p>
          <button class="btn-lp btn-lp-ghost mt-2" onclick="PolicyHistoryPage.load()" style="font-size:12px; padding:6px 12px;">
            <i class="bi bi-arrow-clockwise me-1"></i> Retry
          </button>
        </div>
      `;
    } finally {
      this._loading = false;
    }
  },

  /**
   * Render a single timeline entry with diff view.
   */
  _renderTimelineEntry(entry, isLast) {
    const { timestamp, username, action, summary, details } = entry;
    const changes = details.changes || [];
    const date = new Date(timestamp);
    const timeStr = date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    // Choose icon and color based on action type
    const actionConfig = this._getActionConfig(action);

    // Build diff table if there are changes
    let diffHtml = '';
    if (changes.length > 0) {
      diffHtml = '<div style="margin-top:10px; border-top:1px solid rgba(255,255,255,0.06); padding-top:10px;">';
      diffHtml += '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
      diffHtml += '<tr style="color:var(--text-muted); font-size:10px; text-transform:uppercase;">';
      diffHtml += '<th style="text-align:left; padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">Field</th>';
      diffHtml += '<th style="text-align:left; padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">Before</th>';
      diffHtml += '<th style="text-align:left; padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">After</th>';
      diffHtml += '</tr>';

      for (const change of changes) {
        diffHtml += '<tr style="border-bottom:1px solid rgba(255,255,255,0.03);">';
        diffHtml += `<td style="padding:5px 8px; font-weight:600; white-space:nowrap;">${this._formatFieldName(change.field)}</td>`;
        diffHtml += `<td style="padding:5px 8px;">${this._formatValue(change.from)}</td>`;
        diffHtml += `<td style="padding:5px 8px;">${this._formatValue(change.to)}</td>`;
        diffHtml += '</tr>';
      }

      diffHtml += '</table></div>';
    }

    return `
      <div class="policy-history-entry" style="position:relative; padding-left:24px; padding-bottom:${isLast ? '0' : '20px'}; border-left:2px solid ${isLast ? 'transparent' : actionConfig.color}; margin-left:10px;">
        <!-- Timeline dot -->
        <div style="position:absolute; left:-9px; top:2px; width:16px; height:16px; border-radius:50%; background:${actionConfig.color}; display:flex; align-items:center; justify-content:center; font-size:8px; color:#fff;">
          <i class="${actionConfig.icon}"></i>
        </div>

        <!-- Entry header -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px; margin-bottom:4px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <strong style="font-size:13px; color:var(--text-primary);">${LP.escHtml(summary)}</strong>
            <span class="lp-badge" style="font-size:9px; padding:2px 6px; background:${actionConfig.color}20; color:${actionConfig.color}; border:1px solid ${actionConfig.color}30;">
              ${actionConfig.label}
            </span>
          </div>
          <span style="font-size:10px; color:var(--text-muted);">${LP.escHtml(timeStr)}</span>
        </div>

        <!-- Actor -->
        <div style="font-size:11px; color:var(--text-secondary); margin-bottom:${changes.length > 0 ? '0' : '0'};">
          <i class="bi bi-person-circle me-1"></i> ${LP.escHtml(username)}
        </div>

        <!-- Diff table -->
        ${diffHtml}
      </div>
    `;
  },

  /**
   * Get display config for each action type.
   */
  _getActionConfig(action) {
    switch (action) {
      case 'PASSWORD_POLICY_UPDATED':
        return { color: '#3b82f6', icon: 'bi bi-pencil-fill', label: 'Updated' };
      case 'PASSWORD_POLICY_RESET':
        return { color: '#f59e0b', icon: 'bi bi-arrow-counterclockwise', label: 'Reset' };
      case 'PASSWORD_POLICY_IMPORTED':
        return { color: '#22c55e', icon: 'bi bi-download', label: 'Imported' };
      default:
        return { color: '#6b7280', icon: 'bi bi-circle-fill', label: 'Changed' };
    }
  },

  /**
   * Format field names for display.
   */
  _formatFieldName(field) {
    const map = {
      minLength: 'Min Length',
      requireUppercase: 'Uppercase',
      requireLowercase: 'Lowercase',
      requireNumber: 'Digits',
      requireSpecial: 'Special Char',
      expiryEnabled: 'Expiry',
      expiryDays: 'Expiry Days',
      reminderDays: 'Reminder Days',
    };
    return map[field] || field;
  },

  /**
   * Format a value for display in diff table.
   */
  _formatValue(val) {
    if (val === undefined || val === null) {
      return '<span style="color:var(--text-muted);">—</span>';
    }
    if (typeof val === 'boolean') {
      return val
        ? '<span class="lp-badge lp-badge-success" style="font-size:9px;">Enabled</span>'
        : '<span class="lp-badge lp-badge-danger" style="font-size:9px;">Disabled</span>';
    }
    return `<code style="background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; font-size:11px;">${LP.escHtml(String(val))}</code>`;
  },
};

// Auto-load on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  PolicyHistoryPage.load();
});

// Expose for inline onclick handlers
window.PolicyHistoryPage = PolicyHistoryPage;
