/**
 * Linux Panel — terminal.js
 * Single-tab xterm.js + Socket.IO Web Terminal
 */

const TerminalPage = (() => {
  let socket = null;
  let term = null;
  let fitAddon = null;
  let sessionId = null;
  let selectedOsUser = 'root';
  let loginModal = null;
  let nodeId = null;

  let lastOutputBuffer = [];

  async function init() {
    await LP.init();
    if (!LP.state.accessToken) return;

    const urlParams = new URLSearchParams(window.location.search);
    nodeId = urlParams.get('nodeId');
    if (nodeId) {
      const titleEl = document.querySelector('.lp-page-title');
      if (titleEl) titleEl.innerHTML = '<i class="bi bi-terminal me-2"></i>Web Terminal (Remote Node)';
    }

    const savedUser = sessionStorage.getItem('lp_terminal_user');
    if (savedUser) {
      // Set the input value just in case
      const inputEl = document.getElementById('osUser');
      if (inputEl) inputEl.value = savedUser;
    } else {
      // Show modal
      loginModal = new bootstrap.Modal(document.getElementById('terminalLoginModal'));
      loginModal.show();
      
      // Auto focus input
      document.getElementById('terminalLoginModal').addEventListener('shown.bs.modal', () => {
        document.getElementById('osUser').focus();
      });
    }

    // Init Socket
    socket = io('/terminal', {
      auth: { token: LP.state.accessToken },
      transports: ['websocket'],
      reconnection: true,
    });

    socket.on('connect', () => {
      console.log('Terminal socket connected');
      if (term) {
        socket.emit('terminal:create', {
          cols: term.cols,
          rows: term.rows,
          shell: 'bash',
          osUser: selectedOsUser,
          nodeId: nodeId
        });
      }
    });

    socket.on('terminal:created', (data) => {
      sessionId = data.sessionId;
    });

    socket.on('terminal:data', (data) => {
      if (data.sessionId === sessionId && term) {
        term.write(data.data);
        lastOutputBuffer.push(data.data);
        if (lastOutputBuffer.length > 50) lastOutputBuffer.shift();

        const lowerData = data.data.toLowerCase();
        if (lowerData.includes('command not found') || 
            lowerData.includes('permission denied') || 
            lowerData.includes('no such file or directory') || 
            lowerData.includes('error:') || 
            lowerData.includes('failed:')) {
          const btn = document.getElementById('aiTerminalFixBtn');
          if (btn) btn.classList.remove('d-none');
        }
      }
    });

    socket.on('terminal:exit', (data) => {
      if (data.sessionId === sessionId && term) {
        term.write(`\r\n\x1b[33m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`);
        sessionId = null;
        sessionStorage.removeItem('lp_terminal_user');
      }
    });

    socket.on('terminal:error', (data) => {
      console.error('Terminal Error:', data);
      if (term) term.write(`\r\n\x1b[31mTerminal Error: ${data.message || 'Unknown error'}\x1b[0m\r\n`);
    });

    socket.on('disconnect', () => {
      console.log('Terminal socket disconnected');
    });

    if (savedUser) {
      connect(savedUser);
    }
  }

  function connect(osUser) {
    if (!osUser) return;
    selectedOsUser = osUser;
    sessionStorage.setItem('lp_terminal_user', osUser);
    if (loginModal) loginModal.hide();
    
    initTerminal();
  }

  function initTerminal() {
    const container = document.getElementById('terminal');
    if (!container) return;

    term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 14,
      lineHeight: 1.4,
      theme: {
        background: 'transparent',
        foreground: '#e6edf3',
        cursor: '#6366f1',
        selectionBackground: 'rgba(99, 102, 241, 0.3)',
      },
      cursorBlink: true,
      allowTransparency: true
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    term.open(container);
    fitAddon.fit();

    term.onData((data) => {
      if (socket && sessionId) {
        socket.emit('terminal:input', { sessionId, data });
      }
    });

    term.onResize((size) => {
      if (socket && sessionId) {
        socket.emit('terminal:resize', { sessionId, cols: size.cols, rows: size.rows });
      }
    });

    window.addEventListener('resize', () => {
      try {
        fitAddon.fit();
      } catch (e) {}
    });

    if (socket && socket.connected) {
      socket.emit('terminal:create', {
        cols: term.cols,
        rows: term.rows,
        shell: 'bash',
        osUser: selectedOsUser
      });
    }
  }

  function askAIFix() {
    const textBuffer = lastOutputBuffer.join('');
    const btn = document.getElementById('aiTerminalFixBtn');
    if (btn) btn.classList.add('d-none');
    window.askAI("Tolong berikan petunjuk perbaikan dan perintah solutif dari error terminal berikut ini.", {
      logType: 'terminal_error',
      logText: textBuffer
    });
  }

  return { init, connect, askAIFix };
})();

document.addEventListener('DOMContentLoaded', () => {
  TerminalPage.init();
});
