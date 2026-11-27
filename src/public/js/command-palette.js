/**
 * PanelKu — Design System v2.0 Shell Controller
 * Handles collapsible desktop sidebar, active link highlighting, and Ctrl+K Command Palette.
 */
const LPCommandPalette = (() => {
  let modalEl = null;
  let inputEl = null;
  let listEl = null;
  let items = [];
  let filtered = [];
  let activeIndex = 0;

  function collectNavigationItems() {
    const collected = [];
    const seen = new Set();

    document.querySelectorAll('#lpDesktopSidebar a.lp-side-link, #mobileSidebar a.lp-nav-link').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || href === '#' || seen.has(href)) return;
      seen.add(href);
      const iconEl = a.querySelector('i');
      const iconClass = iconEl ? iconEl.className : 'bi bi-arrow-right-circle';
      const label = (a.textContent || '').trim();
      const group = a.closest('[data-nav-group]')?.getAttribute('data-nav-group') || 'Navigation';
      if (label) {
        collected.push({ type: 'route', label, href, iconClass, group });
      }
    });

    collected.push(
      { type: 'action', label: 'Toggle Dark / Light Theme', group: 'Quick Actions', iconClass: 'bi bi-moon-stars', run: () => window.LP?.toggleTheme?.() },
      { type: 'action', label: 'Toggle Sidebar Collapse', group: 'Quick Actions', iconClass: 'bi bi-layout-sidebar-inset', run: () => toggleSidebar() },
      { type: 'action', label: 'Open Background Tasks Drawer', group: 'Quick Actions', iconClass: 'bi bi-stack', run: () => window.LP?.TaskDrawer?.toggle?.() },
      { type: 'action', label: 'Open AI Copilot Assistant', group: 'Quick Actions', iconClass: 'bi bi-robot', run: () => window.toggleAIChat?.() }
    );

    return collected;
  }

  function highlightActiveSidebarLink() {
    const path = window.location.pathname;
    document.querySelectorAll('#lpDesktopSidebar a.lp-side-link').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      const isMatch = href === '/dashboard' ? (path === '/' || path === '/dashboard') : (path === href || path.startsWith(href + '/'));
      a.classList.toggle('active', isMatch);
    });
  }

  function initSidebarGroups() {
    const storageKey = 'lp_sidebar_collapsed_groups';
    let collapsedGroups = [];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) collapsedGroups = JSON.parse(raw);
      if (!Array.isArray(collapsedGroups)) collapsedGroups = [];
    } catch (_) {
      collapsedGroups = [];
    }

    const saveGroups = () => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(collapsedGroups));
      } catch (_) {}
    };

    document.querySelectorAll('#lpDesktopSidebar .lp-side-group[data-nav-group]').forEach((group) => {
      const groupName = group.getAttribute('data-nav-group');
      const title = group.querySelector('.lp-side-group-title');
      if (!groupName || !title) return;

      if (!title.querySelector('.lp-side-group-chevron')) {
        const chevron = document.createElement('i');
        chevron.className = 'bi bi-chevron-down lp-side-group-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        title.appendChild(chevron);
      }

      const hasActiveLink = Boolean(group.querySelector('.lp-side-link.active'));
      const shouldCollapse = !hasActiveLink && collapsedGroups.includes(groupName);
      group.classList.toggle('is-collapsed', shouldCollapse);
      title.setAttribute('role', 'button');
      title.setAttribute('tabindex', '0');
      title.setAttribute('aria-expanded', shouldCollapse ? 'false' : 'true');

      const toggleGroup = () => {
        const isCollapsed = group.classList.toggle('is-collapsed');
        title.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        if (isCollapsed) {
          if (!collapsedGroups.includes(groupName)) collapsedGroups.push(groupName);
        } else {
          collapsedGroups = collapsedGroups.filter((g) => g !== groupName);
        }
        saveGroups();
      };

      title.addEventListener('click', toggleGroup);
      title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleGroup();
        }
      });
    });
  }

  function applySidebarState(collapsed) {
    const shell = document.getElementById('lpAppShell');
    if (!shell) return;
    shell.classList.toggle('lp-sidebar-collapsed', collapsed);
    try {
      localStorage.setItem('lp_sidebar_collapsed', collapsed ? '1' : '0');
    } catch (_) {}
  }

  function toggleSidebar() {
    const shell = document.getElementById('lpAppShell');
    if (!shell) return;
    applySidebarState(!shell.classList.contains('lp-sidebar-collapsed'));
  }

  function renderResults() {
    if (!listEl) return;
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="lp-cp-empty"><i class="bi bi-search me-2"></i>No matching modules or actions found.</div>';
      return;
    }

    listEl.innerHTML = filtered.slice(0, 12).map((item, idx) => {
      const activeClass = idx === activeIndex ? 'active' : '';
      return `
        <button type="button" class="lp-cp-item ${activeClass}" data-cp-idx="${idx}">
          <span class="lp-cp-item-icon"><i class="${item.iconClass}"></i></span>
          <span class="lp-cp-item-label">${escapeHtml(item.label)}</span>
          <span class="lp-cp-item-group">${escapeHtml(item.group)}</span>
        </button>
      `;
    }).join('');

    listEl.querySelectorAll('.lp-cp-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-cp-idx'), 10);
        executeItem(filtered[idx]);
      });
    });
  }

  function executeItem(item) {
    if (!item) return;
    close();
    if (item.type === 'route' && item.href) {
      window.location.href = item.href;
    } else if (typeof item.run === 'function') {
      item.run();
    }
  }

  function open() {
    if (!modalEl) return;
    if (items.length === 0) items = collectNavigationItems();
    filtered = items;
    activeIndex = 0;
    modalEl.classList.add('open');
    if (inputEl) {
      inputEl.value = '';
      setTimeout(() => inputEl.focus(), 20);
    }
    renderResults();
  }

  function close() {
    if (!modalEl) return;
    modalEl.classList.remove('open');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function init() {
    highlightActiveSidebarLink();
    initSidebarGroups();

    try {
      if (localStorage.getItem('lp_sidebar_collapsed') === '1') {
        applySidebarState(true);
      }
    } catch (_) {}

    const sidebarToggleBtn = document.getElementById('lpSidebarToggleBtn');
    if (sidebarToggleBtn) {
      sidebarToggleBtn.addEventListener('click', toggleSidebar);
    }

    modalEl = document.getElementById('lpCommandPalette');
    inputEl = document.getElementById('lpCommandPaletteInput');
    listEl = document.getElementById('lpCommandPaletteList');

    const triggerBtn = document.getElementById('lpCommandPaletteTrigger');
    if (triggerBtn) {
      triggerBtn.addEventListener('click', open);
    }

    if (modalEl) {
      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) close();
      });
    }

    if (inputEl) {
      inputEl.addEventListener('input', () => {
        const q = inputEl.value.trim().toLowerCase();
        filtered = !q
          ? items
          : items.filter((it) => it.label.toLowerCase().includes(q) || it.group.toLowerCase().includes(q) || (it.href && it.href.toLowerCase().includes(q)));
        activeIndex = 0;
        renderResults();
      });

      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const max = Math.min(filtered.length, 12) - 1;
          activeIndex = activeIndex < max ? activeIndex + 1 : 0;
          renderResults();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const max = Math.min(filtered.length, 12) - 1;
          activeIndex = activeIndex > 0 ? activeIndex - 1 : Math.max(0, max);
          renderResults();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          executeItem(filtered[activeIndex]);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (modalEl?.classList.contains('open')) close();
        else open();
      } else if (e.key === 'Escape' && modalEl?.classList.contains('open')) {
        close();
      }
    });
  }

  return { init, open, close, toggleSidebar };
})();

window.LPCommandPalette = LPCommandPalette;

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    LPCommandPalette.init();
  });
}
