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

  let initialCwd = null;
  let lastOutputBuffer = [];

  async function init() {
    await LP.init();
    if (!LP.state.accessToken) return;

    const urlParams = new URLSearchParams(window.location.search);
    nodeId = urlParams.get('nodeId');
    initialCwd = urlParams.get('path') || urlParams.get('cwd');

    if (nodeId) {
      const titleEl = document.querySelector('.lp-page-title');
      if (titleEl) titleEl.innerHTML = '<i class="bi bi-terminal me-2"></i>Web Terminal (Remote Node)';
    }

    if (initialCwd) {
      const subTitleEl = document.querySelector('.lp-page-subtitle');
      if (subTitleEl) subTitleEl.innerHTML = `Direct shell access to <code class="text-info" style="font-size:12px;">${LP.escHtml(initialCwd)}</code>`;
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
      if (term && !sessionId) {
        socket.emit('terminal:create', {
          cols: term.cols,
          rows: term.rows,
          shell: 'bash',
          osUser: selectedOsUser,
          nodeId: nodeId,
          cwd: initialCwd
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
      // Terminal socket disconnected — will auto-reconnect
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

    if (socket && socket.connected && !sessionId) {
      socket.emit('terminal:create', {
        cols: term.cols,
        rows: term.rows,
        shell: 'bash',
        osUser: selectedOsUser,
        nodeId: nodeId,
        cwd: initialCwd
      });
    }
  }

  function cleanAnsi(str) {
    if (!str) return '';
    return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
  }

  function getLatestOutputText() {
    const raw = lastOutputBuffer.join('');
    return cleanAnsi(raw).trim();
  }

  function askAIFix() {
    openCopilotModal('fix');
  }

  let copilotModal = null;
  let currentGeneratedCommand = '';
  let currentFixCommand = '';

  function openCopilotModal(activeTab = 'generate') {
    if (!copilotModal) {
      copilotModal = new bootstrap.Modal(document.getElementById('terminalCopilotModal'));
    }

    const btn = document.getElementById('aiTerminalFixBtn');
    if (btn) btn.classList.add('d-none');

    copilotModal.show();

    setTimeout(() => {
      if (activeTab === 'fix') {
        const fixTabTrigger = document.getElementById('tab-fix-btn');
        if (fixTabTrigger) {
          const tab = new bootstrap.Tab(fixTabTrigger);
          tab.show();
        }
        const logInput = document.getElementById('fixLogInput');
        if (logInput) {
          logInput.value = getLatestOutputText();
          analyzeTerminalError();
        }
      } else if (activeTab === 'chat') {
        const chatTabTrigger = document.getElementById('tab-chat-btn');
        if (chatTabTrigger) {
          const tab = new bootstrap.Tab(chatTabTrigger);
          tab.show();
        }
        const chatInput = document.getElementById('modalChatInput');
        if (chatInput) chatInput.focus();
      } else {
        const genTabTrigger = document.getElementById('tab-generate-btn');
        if (genTabTrigger) {
          const tab = new bootstrap.Tab(genTabTrigger);
          tab.show();
        }
        const input = document.getElementById('copilotPromptInput');
        if (input) input.focus();
      }
    }, 250);
  }

  function setQuickPrompt(promptText) {
    const input = document.getElementById('copilotPromptInput');
    if (input) {
      input.value = promptText;
      generateCopilotCommand();
    }
  }

  async function generateCopilotCommand() {
    const input = document.getElementById('copilotPromptInput');
    const prompt = input?.value?.trim();
    if (!prompt) return;

    try {
      LP.loading(true);
      const res = await LP.api('/terminal/copilot/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt, context: { cwd: initialCwd } }),
      });
      LP.loading(false);

      if (res && res.data) {
        currentGeneratedCommand = res.data.command;
        const resultBox = document.getElementById('copilotResultBox');
        const cmdOutput = document.getElementById('copilotCommandOutput');
        const explOutput = document.getElementById('copilotExplanation');
        const riskBadge = document.getElementById('copilotRiskBadge');

        if (resultBox) resultBox.classList.remove('d-none');
        if (cmdOutput) cmdOutput.textContent = res.data.command;
        if (explOutput) explOutput.textContent = res.data.explanation;
        if (riskBadge) {
          const r = res.data.safety?.riskLevel || 'low';
          riskBadge.className = `lp-badge lp-badge-${r === 'critical' ? 'danger' : r === 'medium' ? 'warning' : 'success'}`;
          riskBadge.textContent = r.toUpperCase();
        }
      }
    } catch (err) {
      LP.loading(false);
      LP.toast(err.message || 'Failed to generate command', 'error');
    }
  }

  function copyCopilotCommand() {
    if (!currentGeneratedCommand) return;
    navigator.clipboard.writeText(currentGeneratedCommand);
    LP.toast('Command copied to clipboard', 'success');
  }

  function runCopilotCommand() {
    if (!currentGeneratedCommand) return;
    if (socket && sessionId) {
      socket.emit('terminal:input', { sessionId, data: currentGeneratedCommand + '\n' });
      if (copilotModal) copilotModal.hide();
      LP.toast('Command sent to terminal', 'info');
    } else {
      LP.toast('Terminal session is not connected', 'warning');
    }
  }

  async function analyzeTerminalError() {
    const logInput = document.getElementById('fixLogInput');
    const logText = logInput?.value?.trim() || getLatestOutputText();
    if (!logText) {
      LP.toast('Tidak ada log error yang terdeteksi', 'warning');
      return;
    }

    try {
      LP.loading(true);
      const res = await LP.post('/ai/chat', {
        message: 'Tolong berikan analisis singkat error terminal ini dan sertakan 1 perintah perbaikan solutif.',
        context: { logType: 'terminal_error', logText, cwd: initialCwd },
      });
      LP.loading(false);

      if (res?.success && res.data) {
        const text = res.data.answer || '';
        const fixResultBox = document.getElementById('fixResultBox');
        const fixExplanationOutput = document.getElementById('fixExplanationOutput');
        const fixCmdContainer = document.getElementById('fixCmdContainer');
        const fixCommandOutput = document.getElementById('fixCommandOutput');

        if (fixResultBox) fixResultBox.classList.remove('d-none');

        // Extract code block if any
        const codeMatch = text.match(/`{3}(?:bash|sh)?\n?([\s\S]+?)`{3}/) || text.match(/`([^`\n]+)`/);
        if (codeMatch && codeMatch[1]) {
          currentFixCommand = codeMatch[1].trim();
          if (fixCmdContainer) fixCmdContainer.classList.remove('d-none');
          if (fixCommandOutput) fixCommandOutput.textContent = currentFixCommand;
        } else {
          currentFixCommand = '';
          if (fixCmdContainer) fixCmdContainer.classList.add('d-none');
        }

        // Format explanation
        let formatted = text
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/`{3}([\s\S]+?)`{3}/g, '<pre style="background:#05070d; padding:8px; border-radius:6px; font-family:monospace; margin-top:5px; white-space:pre-wrap;">$1</pre>')
          .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1); padding:2px 4px; border-radius:4px; font-family:monospace;">$1</code>')
          .replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');

        if (fixExplanationOutput) fixExplanationOutput.innerHTML = formatted;
      }
    } catch (err) {
      LP.loading(false);
      LP.toast('Gagal menganalisis error: ' + err.message, 'error');
    }
  }

  function copyFixCommand() {
    if (!currentFixCommand) return;
    navigator.clipboard.writeText(currentFixCommand);
    LP.toast('Perintah solusi berhasil disalin', 'success');
  }

  function runFixCommand() {
    if (!currentFixCommand) return;
    if (socket && sessionId) {
      socket.emit('terminal:input', { sessionId, data: currentFixCommand + '\n' });
      if (copilotModal) copilotModal.hide();
      LP.toast('Perintah solusi dikirim ke terminal', 'info');
    } else {
      LP.toast('Terminal session is not connected', 'warning');
    }
  }

  async function sendModalChatMessage() {
    const input = document.getElementById('modalChatInput');
    const message = input?.value?.trim();
    if (!message) return;
    input.value = '';

    const container = document.getElementById('modalChatMessages');
    if (!container) return;

    // Append user message
    const userDiv = document.createElement('div');
    userDiv.style.cssText = 'background:rgba(99,102,241,0.25); padding:10px 14px; border-radius:12px; max-width:85%; align-self:flex-end; color:#fff; word-break:break-word; line-height:1.4;';
    userDiv.textContent = message;
    container.appendChild(userDiv);
    container.scrollTop = container.scrollHeight;

    // Typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.style.cssText = 'background:rgba(255,255,255,0.05); padding:10px 14px; border-radius:12px; max-width:85%; align-self:flex-start; color:var(--text-muted); font-style:italic;';
    typingDiv.innerHTML = '<span class="spinner-border spinner-border-sm text-primary me-2"></span>AI sedang menganalisis...';
    container.appendChild(typingDiv);
    container.scrollTop = container.scrollHeight;

    try {
      const res = await LP.post('/ai/chat', {
        message,
        context: { logType: 'terminal_chat', logText: getLatestOutputText(), cwd: initialCwd },
      });
      typingDiv.remove();

      if (res?.success && res.data) {
        const aiDiv = document.createElement('div');
        aiDiv.style.cssText = 'background:rgba(255,255,255,0.05); padding:12px 14px; border-radius:12px; max-width:90%; align-self:flex-start; color:var(--text-secondary); line-height:1.5;';

        let text = res.data.answer || '';
        text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        text = text.replace(/`{3}(?:bash|sh)?\n?([\s\S]+?)`{3}/g, (match, code) => {
          const escCode = code.replace(/"/g, '&quot;');
          return `<div class="position-relative my-2"><pre style="background:#05070d; padding:10px; border-radius:6px; font-family:'JetBrains Mono', monospace; font-size:12.5px; border:1px solid rgba(255,255,255,0.08); white-space:pre-wrap; margin:0;">${code}</pre><button class="btn btn-sm btn-dark position-absolute top-0 end-0 m-1 py-0 px-2" style="font-size:11px;" onclick="TerminalPage.insertCodeToTerminal('${escCode}')"><i class="bi bi-play-fill"></i> Run in Terminal</button></div>`;
        });
        text = text.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1); padding:2px 4px; border-radius:4px; font-family:monospace;">$1</code>');
        text = text.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\n/g, '<br>');

        aiDiv.innerHTML = text;
        container.appendChild(aiDiv);
      } else {
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'background:rgba(239,68,68,0.1); padding:10px 14px; border-radius:12px; max-width:85%; align-self:flex-start; color:var(--accent-danger);';
        errDiv.textContent = 'Gagal menghubungi asisten AI.';
        container.appendChild(errDiv);
      }
    } catch (err) {
      typingDiv.remove();
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'background:rgba(239,68,68,0.1); padding:10px 14px; border-radius:12px; max-width:85%; align-self:flex-start; color:var(--accent-danger);';
      errDiv.textContent = 'Error koneksi AI: ' + err.message;
      container.appendChild(errDiv);
    }
    container.scrollTop = container.scrollHeight;
  }

  function insertCodeToTerminal(cmd) {
    if (!cmd) return;
    if (socket && sessionId) {
      socket.emit('terminal:input', { sessionId, data: cmd.trim() + '\n' });
      if (copilotModal) copilotModal.hide();
      LP.toast('Perintah dikirim ke terminal', 'info');
    } else {
      LP.toast('Terminal session is not connected', 'warning');
    }
  }

  return {
    init,
    connect,
    askAIFix,
    openCopilotModal,
    setQuickPrompt,
    generateCopilotCommand,
    copyCopilotCommand,
    runCopilotCommand,
    analyzeTerminalError,
    copyFixCommand,
    runFixCommand,
    sendModalChatMessage,
    insertCodeToTerminal,
  };
})();

// [FIX] Expose to window for LP.call() resolution
window.TerminalPage = TerminalPage;

document.addEventListener('DOMContentLoaded', () => {
  TerminalPage.init();
});
