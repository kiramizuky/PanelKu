/**
 * Linux Panel — task-drawer.js
 * Real-time background task management, progress drawer, and queue monitoring.
 */

const TaskDrawer = {
  drawer: null,
  tasks: [],
  metrics: {},
  pollTimer: null,
  socketAttached: false,

  init() {
    const el = document.getElementById('globalTaskDrawer');
    if (el && typeof bootstrap !== 'undefined' && bootstrap.Offcanvas) {
      this.drawer = new bootstrap.Offcanvas(el);
    }
    this.attachSocket();
    this.loadTasks().catch(() => {});
    // Polling every 15s when inactive, or 3s when active tasks exist
    this.startPeriodicSync();
  },

  toggle() {
    if (!this.drawer) {
      const el = document.getElementById('globalTaskDrawer');
      if (el && typeof bootstrap !== 'undefined' && bootstrap.Offcanvas) {
        this.drawer = new bootstrap.Offcanvas(el);
      }
    }
    if (this.drawer) {
      this.drawer.toggle();
      this.loadTasks();
    }
  },

  open() {
    if (!this.drawer) this.init();
    if (this.drawer) {
      this.drawer.show();
      this.loadTasks();
    }
  },

  attachSocket() {
    if (this.socketAttached) return;
    const socket = window.LP?.socket || (window.io ? window.io() : null);
    if (!socket) return;

    this.socketAttached = true;
    socket.on('task:progress', (data) => {
      this.handleProgressUpdate(data);
    });

    socket.on('task:completed', (data) => {
      this.handleTaskCompleted(data);
    });

    socket.on('task:failed', (data) => {
      this.handleTaskFailed(data);
    });
  },

  async loadTasks() {
    try {
      if (typeof LP === 'undefined' || !LP.get) return;
      const [tasksRes, metricsRes] = await Promise.allSettled([
        LP.get('/tasks?limit=30'),
        LP.get('/tasks/metrics'),
      ]);

      if (tasksRes.status === 'fulfilled' && tasksRes.value?.success) {
        this.tasks = tasksRes.value.data.jobs || [];
        this.renderTasks();
        this.updateBadge();
      }

      if (metricsRes.status === 'fulfilled' && metricsRes.value?.success) {
        this.metrics = metricsRes.value.data.metrics || {};
        this.renderMetrics();
      }
    } catch (err) {
      console.warn('Failed loading background tasks:', err);
    }
  },

  renderMetrics() {
    let waiting = 0;
    let active = 0;
    let completed = 0;
    let failed = 0;

    for (const counts of Object.values(this.metrics)) {
      waiting += counts.waiting || 0;
      active += counts.active || 0;
      completed += counts.completed || 0;
      failed += counts.failed || 0;
    }

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };

    setVal('taskStatWaiting', waiting);
    setVal('taskStatActive', active);
    setVal('taskStatCompleted', completed);
    setVal('taskStatFailed', failed);
  },

  updateBadge() {
    const activeCount = this.tasks.filter(t => t.status === 'active' || t.status === 'waiting').length;
    const badge = document.getElementById('taskDrawerBadge');
    const icon = document.getElementById('taskDrawerIcon');

    if (badge) {
      if (activeCount > 0) {
        badge.textContent = activeCount > 9 ? '9+' : String(activeCount);
        badge.classList.remove('d-none');
        if (icon) {
          icon.classList.add('text-primary');
          icon.style.animation = 'spin 2s linear infinite';
        }
      } else {
        badge.classList.add('d-none');
        if (icon) {
          icon.classList.remove('text-primary');
          icon.style.animation = 'none';
        }
      }
    }
  },

  handleProgressUpdate(data) {
    const existing = this.tasks.find(t => t.id === data.jobId);
    if (existing) {
      existing.progress = data.progress;
      existing.progressMessage = data.message;
      existing.status = 'active';
    } else {
      this.tasks.unshift({
        id: data.jobId,
        name: data.name,
        queueName: data.queueName,
        progress: data.progress,
        progressMessage: data.message,
        status: 'active',
        timestamp: data.timestamp || Date.now(),
      });
    }
    this.renderTasks();
    this.updateBadge();
  },

  handleTaskCompleted(data) {
    const existing = this.tasks.find(t => t.id === data.jobId);
    if (existing) {
      existing.status = 'completed';
      existing.progress = 100;
      existing.returnvalue = data.result;
    }
    this.renderTasks();
    this.updateBadge();
    if (typeof LP !== 'undefined' && LP.toast) {
      LP.toast(`Task [${data.name}] completed`, 'success');
    }
  },

  handleTaskFailed(data) {
    const existing = this.tasks.find(t => t.id === data.jobId);
    if (existing) {
      existing.status = 'failed';
      existing.failedReason = data.error;
    }
    this.renderTasks();
    this.updateBadge();
    if (typeof LP !== 'undefined' && LP.toast) {
      LP.toast(`Task [${data.name}] failed: ${data.error}`, 'error');
    }
  },

  renderTasks() {
    const container = document.getElementById('taskListContainer');
    if (!container) return;

    if (!this.tasks || this.tasks.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding: 40px 20px; color:var(--text-muted);">
          <i class="bi bi-inbox" style="font-size:32px; opacity:0.4; display:block; margin-bottom:8px;"></i>
          <span style="font-size:13px;">No background tasks found</span>
        </div>
      `;
      return;
    }

    const getQueueIcon = (queueName) => {
      switch (queueName) {
        case 'backup': return 'bi-cloud-arrow-up text-info';
        case 'deploy': return 'bi-git text-warning';
        case 'mail': return 'bi-envelope-gear text-success';
        default: return 'bi-cpu text-primary';
      }
    };

    const getStatusBadge = (status) => {
      switch (status) {
        case 'active':
          return '<span class="badge bg-primary"><i class="spinner-border spinner-border-sm me-1" style="width:9px; height:9px;"></i>Running</span>';
        case 'waiting':
          return '<span class="badge bg-warning text-dark">Queued</span>';
        case 'completed':
          return '<span class="badge bg-success">Done</span>';
        case 'failed':
          return '<span class="badge bg-danger">Failed</span>';
        case 'cancelled':
          return '<span class="badge bg-secondary">Cancelled</span>';
        default:
          return `<span class="badge bg-dark">${status}</span>`;
      }
    };

    container.innerHTML = this.tasks.map((task) => {
      const isRunning = task.status === 'active' || task.status === 'waiting';
      const progress = Math.max(0, Math.min(100, task.progress || 0));
      const icon = getQueueIcon(task.queueName);
      const badge = getStatusBadge(task.status);
      const timeStr = task.timestamp ? new Date(task.timestamp).toLocaleTimeString() : '';

      return `
        <div class="lp-glass-card" style="padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02);">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom: 6px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <i class="bi ${icon}" style="font-size: 16px;"></i>
              <div>
                <div style="font-size: 13px; font-weight:600; color:var(--text-primary); line-height:1.2;">${LP.escapeHtml ? LP.escapeHtml(task.name) : task.name}</div>
                <div style="font-size: 10px; color:var(--text-muted); font-family:var(--font-mono, monospace);">${task.queueName} &bull; ${timeStr}</div>
              </div>
            </div>
            <div>${badge}</div>
          </div>

          ${isRunning ? `
            <div class="progress" style="height: 6px; background: rgba(255,255,255,0.08); margin: 8px 0 4px 0; border-radius: 3px;">
              <div class="progress-bar progress-bar-striped progress-bar-animated bg-primary" role="progressbar" style="width: ${progress}%;"></div>
            </div>
            ${task.progressMessage ? `<div style="font-size: 11px; color:var(--text-muted); margin-top: 3px;">${LP.escapeHtml ? LP.escapeHtml(task.progressMessage) : task.progressMessage}</div>` : ''}
          ` : ''}

          ${task.failedReason ? `
            <div style="font-size: 11px; color:var(--accent-danger); margin-top: 6px; background: rgba(239,68,68,0.08); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(239,68,68,0.2);">
              ${LP.escapeHtml ? LP.escapeHtml(task.failedReason) : task.failedReason}
            </div>
          ` : ''}

          ${isRunning ? `
            <div style="display:flex; justify-content:flex-end; margin-top: 6px;">
              <button class="btn btn-sm btn-outline-danger py-0 px-2" style="font-size: 10px;" onclick="LP.TaskDrawer.cancelTask('${task.queueName}', '${task.id}')">Cancel</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  },

  async cancelTask(queueName, jobId) {
    if (!confirm('Cancel or remove this task?')) return;
    try {
      const res = await LP.post(`/tasks/${queueName}/${jobId}/cancel`);
      if (res?.success) {
        if (typeof LP !== 'undefined' && LP.toast) LP.toast('Task cancelled', 'info');
        await this.loadTasks();
      }
    } catch (err) {
      if (typeof LP !== 'undefined' && LP.toast) LP.toast(`Failed to cancel: ${err.message}`, 'error');
    }
  },

  startPeriodicSync() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      this.loadTasks().catch(() => {});
    }, 5000);
  },
};

// Global assignment for window & LP object
window.TaskDrawer = TaskDrawer;
if (window.LP) {
  window.LP.TaskDrawer = TaskDrawer;
}
document.addEventListener('DOMContentLoaded', () => {
  TaskDrawer.init();
});
