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
    refreshPromise: null,
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
        this.checkPanelUpdateDaily().catch(() => {});
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
        return { success: true, requiresTwoFactor: true, tempToken: res.data.tempToken };
      }
      this.state.accessToken = res.data.accessToken;
      this.state.user = res.data.user;
      localStorage.setItem('lp_token', res.data.accessToken);
      return { success: true };
    }
    return { success: false, message: res?.message || 'Login failed' };
  },

  async login2FA(tempToken, otp) {
    const res = await this.post('/auth/2fa/verify', { tempToken, otp });
    if (res?.success) {
      this.state.accessToken = res.data.accessToken;
      this.state.user = res.data.user;
      localStorage.setItem('lp_token', res.data.accessToken);
      return { success: true };
    }
    return { success: false, message: res?.message || 'Verification failed' };
  },

  async refreshToken() {
    if (this.state.refreshPromise) {
      return this.state.refreshPromise;
    }

    this.state.refreshPromise = (async () => {
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
    })();

    const result = await this.state.refreshPromise;
    this.state.refreshPromise = null;
    return result;
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
    const initials = (user.username?.[0] || user.firstName?.[0] || 'U').toUpperCase();
    document.querySelectorAll('.lp-user-initials').forEach(el => el.textContent = initials);
    document.querySelectorAll('.lp-user-name').forEach(el => el.textContent = user.username);
    document.querySelectorAll('.lp-user-role').forEach(el => el.textContent = user.role?.name || '');

    // Automatically fill profile card headers if they exist in Settings views
    const cardName = document.getElementById('profileCardName');
    const cardEmail = document.getElementById('profileCardEmail');
    const cardBadge = document.getElementById('profileCardBadge');
    if (cardName) cardName.textContent = user.username || 'User';
    if (cardEmail) cardEmail.textContent = user.email || 'No email set';
    if (cardBadge) cardBadge.textContent = (user.role?.name || 'User').toUpperCase();
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

    const safeMessage = this.escHtml(message);
    const safeTitle = this.escHtml(title || defaults[type]);

    const container = document.querySelector('.lp-toasts');
    const el = document.createElement('div');
    el.className = `lp-toast ${type} fade-in`;
    el.innerHTML = `
      <span class="lp-toast-icon">${icons[type] || 'ℹ️'}</span>
      <div class="lp-toast-body">
        <div class="lp-toast-title">${safeTitle}</div>
        <div class="lp-toast-msg">${safeMessage}</div>
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
    this.applyTheme(saved);
  },

  applyTheme(theme) {
    document.documentElement.classList.remove('light-mode');

    if (theme === 'light') {
      document.documentElement.classList.add('light-mode');
      document.documentElement.style.colorScheme = 'light';
      document.documentElement.setAttribute('data-bs-theme', 'light');
    } else {
      document.documentElement.style.colorScheme = 'dark';
      document.documentElement.setAttribute('data-bs-theme', 'dark');
    }

    document.documentElement.setAttribute('data-theme', theme);

    // Update icon
    const icon = document.getElementById('themeIcon');
    if (icon) {
      if (theme === 'light') {
        icon.classList.remove('bi-moon-fill');
        icon.classList.add('bi-sun-fill');
      } else {
        icon.classList.remove('bi-sun-fill');
        icon.classList.add('bi-moon-fill');
      }
    }
  },

  toggleTheme() {
    const current = localStorage.getItem('lp_theme') || 'dark';
    const newTheme = current === 'light' ? 'dark' : 'light';
    localStorage.setItem('lp_theme', newTheme);
    this.applyTheme(newTheme);
  },

  // ── HTML/Js String Escape ────────────────────────────────
  escHtml(str) {
    // Safe for text content (&, <, >) and double-quoted attributes (&quot;).
    // NOTE: Do NOT escape ' here — &#39; would be decoded by innerHTML back to ',
    // which breaks inline onclick handlers that use single-quoted JS strings.
    // For onclick with user data, use data-* attributes + event delegation instead.
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  /**
   * Safe string for inclusion in single-quoted JS strings inside onclick attributes.
   * Uses URI encoding which escapes ' " \ and all other special chars as %XX.
   * The handler must decode via decodeURIComponent().
   * Example: onclick="handler(decodeURIComponent('${LP.escJsStr(val)}'))"
   */
  /**
   * Encode a value for safe injection into a JS single-quoted string inside onclick.
   * Uses JSON.stringify + encodeURIComponent so output contains NO raw single-quotes,
   * double-quotes, backslashes, or other JS/HTML-special characters.
   * Decode with decodeURIComponent(JSON.parse(...)) — handled automatically by LP.call().
   */
  encJsArg(val) {
    return encodeURIComponent(JSON.stringify(val));
  },

  /**
   * Call a namespaced function with URI-encoded JSON arguments.
   * Automatically decodes and parses all arguments.
   * Usage in template literal:
   *   onclick="LP.call('Module.method', '${LP.encJsArg(val1)}', '${LP.encJsArg(val2)}')"
   * The module method receives the decoded values directly — no changes needed to handlers.
   */
  call(fnPath, ...args) {
    // Use indirect eval to access global lexical scope (works for both const and var globals)
    // fnPath is always a developer-hardcoded string in template literals — no injection risk
    let fn;
    try { fn = (0, eval)(fnPath); } catch { fn = null; }
    if (typeof fn !== 'function') {
      console.warn(`LP.call: ${fnPath} is not a function`);
      return;
    }
    // Decode string args (which were encJsArg'd), pass non-strings through unchanged (e.g. 'this' DOM refs)
    const decoded = args.map(a => {
      if (typeof a !== 'string') return a;
      try { return JSON.parse(decodeURIComponent(a)); }
      catch { return a; }
    });
    return fn(...decoded);
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
      const id = 'lp_confirm_' + Date.now();
      const safeTitle = this.escHtml(title);
      const safeMessage = this.escHtml(message);
      const modal = document.createElement('div');
      modal.innerHTML = `
        <div class="modal fade" id="${id}" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content" style="background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary);">
              <div class="modal-header border-0">
                <h5 class="modal-title">${safeTitle}</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">${safeMessage}</div>
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

  prompt(message, type = 'text', title = 'Input Required') {
    return new Promise(resolve => {
      const id = 'lp_prompt_' + Date.now();
      const safeTitle = this.escHtml(title);
      const safeMessage = this.escHtml(message);
      // type is restricted to 'text', 'password', 'email', 'number' — safe
      const modal = document.createElement('div');
      modal.innerHTML = `
        <div class="modal fade" id="${id}" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content" style="background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius:12px;">
              <div class="modal-header border-0 pb-0">
                <h5 class="modal-title font-sans" style="font-size:15px; font-weight:600;">${safeTitle}</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body pb-0">
                <p style="font-size:13px; color:var(--text-muted); margin-bottom:12px;">${safeMessage}</p>
                <input type="${type}" id="${id}_input" class="lp-input w-100" style="height:38px;">
              </div>
              <div class="modal-footer border-0">
                <button class="btn-lp btn-lp-ghost" data-bs-dismiss="modal">Cancel</button>
                <button class="btn-lp btn-lp-primary" id="${id}_ok">Submit</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);
      const bsModal = new bootstrap.Modal(document.getElementById(id));
      bsModal.show();
      document.getElementById(`${id}_ok`).addEventListener('click', () => {
        const val = document.getElementById(`${id}_input`).value;
        bsModal.hide();
        resolve(val);
      });
      document.getElementById(id).addEventListener('hidden.bs.modal', () => {
        modal.remove();
        resolve(null);
      });
    });
  },

  alert(message, title = 'Info') {
    return new Promise(resolve => {
      const id = 'lp_alert_' + Date.now();
      const safeTitle = this.escHtml(title);
      const safeMessage = this.escHtml(message);
      const modal = document.createElement('div');
      modal.innerHTML = `
        <div class="modal fade" id="${id}" tabindex="-1">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content" style="background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary);">
              <div class="modal-header border-0">
                <h5 class="modal-title">${safeTitle}</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">${safeMessage}</div>
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
    const safeColspan = this.escHtml(String(colspan || 1));
    const safeEmpty = this.escHtml(emptyMessage || '');
    
    if (!data || data.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="${safeColspan}" class="text-center text-muted">${safeEmpty}</td></tr>`;
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

  async checkPanelUpdateDaily() {
    try {
      const now = Date.now();
      const lastCheck = parseInt(localStorage.getItem('lp_panel_update_last_check')) || 0;
      const cachedHasUpdate = localStorage.getItem('lp_panel_has_update') === 'true';

      // 24 hours = 86400000 milliseconds
      if (now - lastCheck < 86400000 && lastCheck > 0) {
        const navBtn = document.getElementById('panelUpdateNavbarBtn');
        const mobBtn = document.getElementById('panelUpdateMobileBtn');
        if (navBtn) navBtn.style.setProperty('display', cachedHasUpdate ? 'flex' : 'none', cachedHasUpdate ? '' : 'important');
        if (mobBtn) mobBtn.style.setProperty('display', cachedHasUpdate ? 'block' : 'none', cachedHasUpdate ? '' : 'important');
        return;
      }

      // Perform a fresh check
      const res = await this.get('/system/panel/check-update');
      if (res?.success && res.data) {
        const hasUpdate = res.data.hasUpdate;
        localStorage.setItem('lp_panel_update_last_check', now.toString());
        localStorage.setItem('lp_panel_has_update', hasUpdate.toString());

        const navBtn = document.getElementById('panelUpdateNavbarBtn');
        const mobBtn = document.getElementById('panelUpdateMobileBtn');
        if (navBtn) navBtn.style.setProperty('display', hasUpdate ? 'flex' : 'none', hasUpdate ? '' : 'important');
        if (mobBtn) mobBtn.style.setProperty('display', hasUpdate ? 'block' : 'none', hasUpdate ? '' : 'important');
      }
    } catch (e) {
      console.warn('Failed to perform automated panel update check:', e);
    }
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
