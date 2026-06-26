/**
 * Linux Panel — terminal.js
 * xterm.js + Socket.IO multi-tab terminal
 */

const TerminalPage = (() => {
  let socket = null;
  let tabs = new Map(); // tabId -> { term, fitAddon, sessionId, shell }
  let activeTabId = null;
  let tabCounter = 0;

  // ── Socket ─────────────────────────────────────────
  function connectSocket() {
    const token = localStorage.getItem('lp_token');
    if (!token) return;

    socket = io('/terminal', {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
    });

    socket.on('connect', () => {
      console.log('Terminal socket connected');
    });

    socket.on('terminal:created', ({ sessionId }) => {
      // Find tab waiting for sessionId
      for (const [tabId, tab] of tabs) {
        if (tab.pendingSession) {
          tab.sessionId = sessionId;
          tab.pendingSession = false;
          break;
        }
      }
    });

    socket.on('terminal:data', ({ sessionId, data }) => {
      for (const [, tab] of tabs) {
        if (tab.sessionId === sessionId) {
          tab.term.write(data);
          break;
        }
      }
    });

    socket.on('terminal:exit', ({ sessionId, exitCode }) => {
      for (const [tabId, tab] of tabs) {
        if (tab.sessionId === sessionId) {
          tab.term.write(`\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
          tab.sessionId = null;
          // Update tab indicator
          const tabEl = document.querySelector(`[data-tab-id="${tabId}"] .tab-status`);
          if (tabEl) tabEl.style.color = 'var(--accent-danger)';
          break;
        }
      }
    });

    socket.on('disconnect', () => {
      console.log('Terminal socket disconnected');
    });
  }

  // ── Create Tab ────────────────────────────────────
  function createTab(shell = 'bash') {
    const tabId = ++tabCounter;
    const tabsContainer = document.getElementById('terminalTabs');
    const panesContainer = document.getElementById('terminalPanes');

    // Create tab element
    const tabEl = document.createElement('div');
    tabEl.className = 'terminal-tab';
    tabEl.setAttribute('data-tab-id', tabId);
    tabEl.innerHTML = `
      <i class="bi bi-terminal" style="font-size:12px"></i>
      <span class="tab-status" style="color:var(--accent-success)">⬤</span>
      <span>${shell} ${tabId}</span>
      <button class="tab-close" onclick="TerminalPage.closeTab(${tabId})" title="Close">✕</button>
    `;
    tabEl.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) activateTab(tabId);
    });
    tabsContainer.insertBefore(tabEl, tabsContainer.firstChild);

    // Create pane
    const pane = document.createElement('div');
    pane.className = 'terminal-pane';
    pane.id = `pane-${tabId}`;
    const xtermEl = document.createElement('div');
    xtermEl.className = 'xterm-container';
    xtermEl.id = `xterm-${tabId}`;
    pane.appendChild(xtermEl);
    panesContainer.appendChild(pane);

    // Init xterm.js
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 14,
      lineHeight: 1.4,
      theme: {
        background: '#0a0e1a',
        foreground: '#e2e8f0',
        cursor: '#6366f1',
        cursorAccent: '#0a0e1a',
        selection: 'rgba(99,102,241,0.25)',
        black: '#1e293b', red: '#ef4444', green: '#10b981',
        yellow: '#f59e0b', blue: '#3b82f6', magenta: '#8b5cf6',
        cyan: '#06b6d4', white: '#f1f5f9',
        brightBlack: '#334155', brightRed: '#f87171', brightGreen: '#34d399',
        brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#a78bfa',
        brightCyan: '#22d3ee', brightWhite: '#f8fafc',
      },
      scrollback: 5000,
      cursorBlink: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    term.open(xtermEl);
    fitAddon.fit();

    // Input handler
    term.onData((data) => {
      const tab = tabs.get(tabId);
      if (tab?.sessionId && socket?.connected) {
        socket.emit('terminal:input', { sessionId: tab.sessionId, data });
      }
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const tab = tabs.get(tabId);
      if (tab?.sessionId && socket?.connected) {
        socket.emit('terminal:resize', {
          sessionId: tab.sessionId,
          cols: term.cols,
          rows: term.rows,
        });
      }
    });
    resizeObserver.observe(xtermEl);

    // Store tab
    tabs.set(tabId, { term, fitAddon, sessionId: null, shell, pendingSession: true });

    activateTab(tabId);

    // Create server-side PTY session
    if (socket?.connected) {
      socket.emit('terminal:create', { shell, cols: term.cols, rows: term.rows });
    } else {
      term.write('\x1b[33m[Waiting for server connection...]\x1b[0m\r\n');
      socket?.once('connect', () => {
        socket.emit('terminal:create', { shell, cols: term.cols, rows: term.rows });
      });
    }

    return tabId;
  }

  function activateTab(tabId) {
    // Deactivate all
    document.querySelectorAll('.terminal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.terminal-pane').forEach(p => p.classList.remove('active'));

    // Activate target
    document.querySelector(`[data-tab-id="${tabId}"]`)?.classList.add('active');
    document.getElementById(`pane-${tabId}`)?.classList.add('active');
    activeTabId = tabId;

    // Fit and focus
    const tab = tabs.get(tabId);
    if (tab) {
      setTimeout(() => {
        tab.fitAddon?.fit();
        tab.term?.focus();
      }, 50);
    }
  }

  function closeTab(tabId) {
    const tab = tabs.get(tabId);
    if (!tab) return;

    // Kill server session
    if (tab.sessionId && socket?.connected) {
      socket.emit('terminal:kill', { sessionId: tab.sessionId });
    }

    // Destroy xterm
    tab.term.dispose();
    tabs.delete(tabId);

    // Remove DOM
    document.querySelector(`[data-tab-id="${tabId}"]`)?.remove();
    document.getElementById(`pane-${tabId}`)?.remove();

    // Activate next tab
    if (activeTabId === tabId) {
      const nextId = [...tabs.keys()][0];
      if (nextId) activateTab(nextId);
      else createTab(document.getElementById('shellSelect')?.value || 'bash');
    }
  }

  // ── Public API ─────────────────────────────────────
  return {
    async init() {
      await LP.init();
      if (!LP.state.accessToken) return;

      connectSocket();

      // Wait for socket then open first tab
      setTimeout(() => createTab(document.getElementById('shellSelect')?.value || 'bash'), 500);
    },

    newTab() {
      const shell = document.getElementById('shellSelect')?.value || 'bash';
      createTab(shell);
    },

    closeTab(tabId) {
      closeTab(tabId);
    },

    clearActive() {
      const tab = tabs.get(activeTabId);
      tab?.term.clear();
    },

    toggleFullscreen() {
      const main = document.querySelector('.lp-main');
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        main?.requestFullscreen();
      }
    },
  };
})();

document.addEventListener('DOMContentLoaded', () => TerminalPage.init());
window.TerminalPage = TerminalPage;
