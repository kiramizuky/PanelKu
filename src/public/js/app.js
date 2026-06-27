/**
 * Linux Panel — app.js
 * Core JavaScript: Auth, API, Socket, UI utilities
 */

const LP = {
  // ── Config ────────────────────────────────────────────
  config: {
    apiBase: '/api',
    socketUrl: window.location.origin,
  },

  // ── State ─────────────────────────────────────────────
  state: {
    user: null,
    accessToken: null,
    sidebarCollapsed: localStorage.getItem('lp_sidebar_collapsed') === 'true',
  },

  // ── Init ──────────────────────────────────────────────
  async init() {
    this.initSidebar();
    this.initToasts();
    this.highlightActiveNav();
    this.initTheme();

    // Try to restore session
    const token = localStorage.getItem('lp_token');
    if (token) {
      this.state.accessToken = token;
      try {
        await this.fetchProfile();
        this.updateUserUI();
      } catch {
        this.logout();
      }
    } else if (!window.location.pathname.startsWith('/login') && window.location.pathname !== '/') {
      this.logout();
    }
  },

  // ── API ───────────────────────────────────────────────
  async api(method, endpoint, data = null, opts = {}) {
    const url = `${this.config.apiBase}${endpoint}`;
    const headers = { 'Content-Type': 'application/json' };

    if (this.state.accessToken) {
      headers['Authorization'] = `Bearer ${this.state.accessToken}`;
    }

    const res = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      credentials: 'include',
      body: data ? JSON.stringify(data) : undefined,
      ...opts,
    });

    // Token expired — try refresh
    if (res.status === 401 && !opts._retry) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        return this.api(method, endpoint, data, { ...opts, _retry: true });
      } else {
        this.logout();
        return null;
      }
    }

    return res.json().catch(() => null);
  },

  get: (url, opts) => LP.api('GET', url, null, opts),
  post: (url, data, opts) => LP.api('POST', url, data, opts),
  put: (url, data, opts) => LP.api('PUT', url, data, opts),
  patch: (url, data, opts) => LP.api('PATCH', url, data, opts),
  del: (url, opts) => LP.api('DELETE', url, null, opts),
  delete: (url, opts) => LP.api('DELETE', url, null, opts),

  // ── Auth ──────────────────────────────────────────────
  async login(username, password) {
    const res = await this.post('/auth/login', { username, password });
    if (res?.success) {
      if (res.data.requiresTwoFactor) {
        return { requiresTwoFactor: true, tempToken: res.data.tempToken };
      }
      this.state.accessToken = res.data.accessToken;
      this.state.user = res.data.user;
      localStorage.setItem('lp_token', res.data.accessToken);
      return { success: true };
    }
    return { success: false, message: res?.message || 'Login failed' };
  },

  async refreshToken() {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data?.success) {
        this.state.accessToken = data.data.accessToken;
        localStorage.setItem('lp_token', data.data.accessToken);
        return true;
      }
    } catch { }
    return false;
  },

  async fetchProfile() {
    const res = await this.get('/auth/profile');
    if (res?.success) {
      this.state.user = res.data.user;
      return res.data.user;
    }
    throw new Error('Failed to fetch profile');
  },

  logout() {
    this.post('/auth/logout').catch(() => {});
    localStorage.removeItem('lp_token');
    this.state.accessToken = null;
    this.state.user = null;
    window.location.href = '/';
  },

  // ── User UI ───────────────────────────────────────────
  updateUserUI() {
    const user = this.state.user;
    if (!user) return;
    const initials = (user.firstName?.[0] || user.username[0]).toUpperCase();
    document.querySelectorAll('.lp-user-initials').forEach(el => el.textContent = initials);
    document.querySelectorAll('.lp-user-name').forEach(el => el.textContent = user.username);
    document.querySelectorAll('.lp-user-role').forEach(el => el.textContent = user.role?.name || '');
  },

  // ── Sidebar ───────────────────────────────────────────
  initSidebar() {
    const sidebar = document.querySelector('.lp-sidebar');
    const main = document.querySelector('.lp-main');
    const floatTerminal = document.querySelector('.lp-float-terminal');
    const toggleBtn = document.querySelector('#sidebarToggle');

    if (!sidebar) return;

    if (this.state.sidebarCollapsed) {
      sidebar.classList.add('collapsed');
      main?.classList.add('sidebar-collapsed');
    }

    toggleBtn?.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('collapsed');
      main?.classList.toggle('sidebar-collapsed', collapsed);
      this.state.sidebarCollapsed = collapsed;
      localStorage.setItem('lp_sidebar_collapsed', collapsed);
    });

    // Mobile overlay toggle
    document.querySelector('#mobileMenuBtn')?.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });
  },

  highlightActiveNav() {
    const path = window.location.pathname;
    document.querySelectorAll('.lp-nav-link').forEach(link => {
      const href = link.getAttribute('href');
      if (href && (path === href || (href !== '/' && path.startsWith(href)))) {
        link.classList.add('active');
      }
    });
  },

  // ── Toast ─────────────────────────────────────────────
  initToasts() {
    if (!document.querySelector('.lp-toasts')) {
      const el = document.createElement('div');
      el.className = 'lp-toasts';
      document.body.appendChild(el);
    }
  },

  toast(message, type = 'info', title = null, duration = 4000) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️', alert: '🚨' };
    const defaults = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Info', alert: 'Alert' };

    const container = document.querySelector('.lp-toasts');
    const el = document.createElement('div');
    el.className = `lp-toast ${type} fade-in`;
    el.innerHTML = `
      <span class="lp-toast-icon">${icons[type] || 'ℹ️'}</span>
      <div class="lp-toast-body">
        <div class="lp-toast-title">${title || defaults[type]}</div>
        <div class="lp-toast-msg">${message}</div>
      </div>
      <button class="lp-toast-close" onclick="this.closest('.lp-toast').remove()">✕</button>
    `;

    container.appendChild(el);

    if (duration > 0) {
      setTimeout(() => {
        el.classList.add('removing');
        setTimeout(() => el.remove(), 300);
      }, duration);
    }
    return el;
  },

  // ── Theme ─────────────────────────────────────────────
  initTheme() {
    const saved = localStorage.getItem('lp_theme') || 'dark';
    if (saved === 'light') {
      document.documentElement.classList.add('light-mode');
      const icon = document.getElementById('themeIcon');
      if (icon) {
        icon.classList.remove('bi-moon-fill');
        icon.classList.add('bi-sun-fill');
      }
    }
  },

  toggleTheme() {
    const isLight = document.documentElement.classList.toggle('light-mode');
    localStorage.setItem('lp_theme', isLight ? 'light' : 'dark');
    
    const icon = document.getElementById('themeIcon');
    if (icon) {
      if (isLight) {
        icon.classList.remove('bi-moon-fill');
        icon.classList.add('bi-sun-fill');
      } else {
        icon.classList.remove('bi-sun-fill');
        icon.classList.add('bi-moon-fill');
      }
    }
  },

  // ── Util ──────────────────────────────────────────────
  formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
  },

  formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m || !d) parts.push(`${m}m`);
    return parts.join(' ') || '0m';
  },

  progressColor(pct) {
    if (pct >= 90) return 'danger';
    if (pct >= 70) return 'warning';
    return 'success';
  },

  confirm(message, title = 'Confirm') {
    return new Promise(resolve => {
      // Simple modal confirm (Bootstrap 5)
      const id = 'lp_confirm_' + Date.now();
      const modal = document.createElement('div');
      modal.innerHTML = `
        <div class="modal fade" id="${id}" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content" style="background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary);">
              <div class="modal-header border-0">
                <h5 class="modal-title">${title}</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">${message}</div>
              <div class="modal-footer border-0">
                <button class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
                <button class="btn-lp btn-lp-danger" id="${id}_ok">Confirm</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);
      const bsModal = new bootstrap.Modal(document.getElementById(id));
      bsModal.show();
      document.getElementById(`${id}_ok`).addEventListener('click', () => {
        bsModal.hide();
        resolve(true);
      });
      document.getElementById(id).addEventListener('hidden.bs.modal', () => {
        modal.remove();
        resolve(false);
      });
    });
  },

  alert(message, title = 'Info') {
    return new Promise(resolve => {
      const id = 'lp_alert_' + Date.now();
      const modal = document.createElement('div');
      modal.innerHTML = `
        <div class="modal fade" id="${id}" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content" style="background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary);">
              <div class="modal-header border-0">
                <h5 class="modal-title">${title}</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">${message}</div>
              <div class="modal-footer border-0">
                <button class="btn-lp btn-lp-primary" id="${id}_ok">OK</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);
      const bsModal = new bootstrap.Modal(document.getElementById(id));
      bsModal.show();
      document.getElementById(`${id}_ok`).addEventListener('click', () => {
        bsModal.hide();
        resolve(true);
      });
      document.getElementById(id).addEventListener('hidden.bs.modal', () => {
        modal.remove();
        resolve(true);
      });
    });
  },

  // Format numbers
  num(n) {
    return typeof n === 'number' ? n.toLocaleString() : n;
  },

  // Pagination Helper
  _paginationState: {},
  paginate(data, itemsPerPage, tbodyId, paginationContainerId, renderRowFn, emptyMessage, colspan) {
    const tbody = document.getElementById(tbodyId);
    const pagContainer = document.getElementById(paginationContainerId);
    
    if (!data || data.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center text-muted">${emptyMessage}</td></tr>`;
      if (pagContainer) pagContainer.innerHTML = '';
      return;
    }
    
    const totalPages = Math.ceil(data.length / itemsPerPage);

    LP._paginationState[paginationContainerId] = { 
      currentPage: 1, 
      totalPages, 
      render: function() {
        const state = LP._paginationState[paginationContainerId];
        const start = (state.currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const pageData = data.slice(start, end);
        
        if (tbody) tbody.innerHTML = pageData.map(renderRowFn).join('');
        
        if (pagContainer) {
          if (state.totalPages > 1) {
            pagContainer.innerHTML = `
              <div class="lp-pagination mt-3 d-flex justify-content-between align-items-center">
                <span class="text-muted" style="font-size:12px">Showing ${start + 1} to ${Math.min(end, data.length)} of ${data.length}</span>
                <div class="btn-group">
                  <button class="btn-lp btn-lp-sm btn-lp-ghost" ${state.currentPage === 1 ? 'disabled' : ''} onclick="LP._pageChange('${paginationContainerId}', -1)"><i class="bi bi-chevron-left"></i></button>
                  <button class="btn-lp btn-lp-sm btn-lp-ghost" ${state.currentPage === state.totalPages ? 'disabled' : ''} onclick="LP._pageChange('${paginationContainerId}', 1)"><i class="bi bi-chevron-right"></i></button>
                </div>
              </div>
            `;
          } else {
            pagContainer.innerHTML = '';
          }
        }
      }
    };
    
    LP._paginationState[paginationContainerId].render();
  },

  _pageChange(containerId, dir) {
    const state = LP._paginationState[containerId];
    if (!state) return;
    state.currentPage += dir;
    if (state.currentPage < 1) state.currentPage = 1;
    if (state.currentPage > state.totalPages) state.currentPage = state.totalPages;
    state.render();
  }
};

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => LP.init());

window.LP = LP;
