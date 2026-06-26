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

  async function init() {
    await LP.init();
    if (!LP.state.accessToken) return;

    // Show modal
    loginModal = new bootstrap.Modal(document.getElementById('terminalLoginModal'));
    loginModal.show();
    
    // Auto focus input
    document.getElementById('terminalLoginModal').addEventListener('shown.bs.modal', () => {
      document.getElementById('osUser').focus();
    });

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
          osUser: selectedOsUser
        });
      }
    });

    socket.on('terminal:created', (data) => {
      sessionId = data.sessionId;
    });

    socket.on('terminal:data', (data) => {
      if (data.sessionId === sessionId && term) {
        term.write(data.data);
      }
    });

    socket.on('terminal:exit', (data) => {
      if (data.sessionId === sessionId && term) {
        term.write(`\r\n\x1b[33m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`);
        sessionId = null;
      }
    });

    socket.on('terminal:error', (data) => {
      console.error('Terminal Error:', data);
      if (term) term.write(`\r\n\x1b[31mTerminal Error: ${data.message || 'Unknown error'}\x1b[0m\r\n`);
    });

    socket.on('disconnect', () => {
      console.log('Terminal socket disconnected');
    });
  }

  function connect(osUser) {
    if (!osUser) return;
    selectedOsUser = osUser;
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

  return { init, connect };
})();

document.addEventListener('DOMContentLoaded', () => {
  TerminalPage.init();
});
