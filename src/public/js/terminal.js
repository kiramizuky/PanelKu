/**
 * Linux Panel — terminal.js
 * Single-tab xterm.js + Socket.IO Web Terminal
 */

const TerminalPage = (() => {
  let socket = null;
  let tabs = {};
  let activeTabId = null;
  let tabCounter = 0;
  let selectedOsUser = 'root';
  let loginModal = null;
  let nodeId = null;

  let initialCwd = null;
  let lastOutputBuffer = []; // Shared buffer for AI analysis (uses active tab)

  let heartbeatTimer = null;
  let pendingTabsQueue = [];

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (socket && socket.connected) {
        socket.emit('terminal:ping');
      }
    }, 20000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function updateStatusUI(status, customMsg = null) {
    const badge = document.getElementById('terminalStatusBadge');
    const textEl = document.getElementById('terminalStatusText');
    const reconnectBtn = document.getElementById('terminalReconnectBtn');
    if (!badge || !textEl) return;

    badge.className = 'badge d-inline-flex align-items-center gap-1 ' +
      (status === 'connected' ? 'bg-success-subtle text-success border border-success-subtle' :
       status === 'reconnecting' ? 'bg-warning-subtle text-warning border border-warning-subtle' :
       'bg-danger-subtle text-danger border border-danger-subtle');

    textEl.textContent = customMsg || (
      status === 'connected' ? 'Connected' :
      status === 'reconnecting' ? 'Reconnecting...' :
      'Disconnected'
    );

    if (reconnectBtn) {
      if (status === 'connected') {
        reconnectBtn.classList.add('d-none');
      } else {
        reconnectBtn.classList.remove('d-none');
      }
    }
  }

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

    // Init Socket with dynamic auth token and polling fallback
    socket = io('/terminal', {
      auth: (cb) => {
        const token = LP.state.accessToken || localStorage.getItem('lp_token');
        cb({ token });
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socket.on('connect', () => {
      updateStatusUI('connected');
      startHeartbeat();

      // Check all tabs and recreate any disconnected or missing sessions
      Object.keys(tabs).forEach(id => {
        const tab = tabs[id];
        if (tab && tab.term) {
          if (!tab.sessionId || tab.needsRecreate) {
            tab.needsRecreate = false;
            tab.sessionId = null;
            pendingTabsQueue.push(id);
            tab.term.write('\r\n\x1b[32m[Koneksi tersambung. Menginisialisasi sesi shell...]\x1b[0m\r\n');
            socket.emit('terminal:create', {
              cols: tab.term.cols || 80,
              rows: tab.term.rows || 24,
              shell: 'bash',
              osUser: tab.osUser || selectedOsUser,
              nodeId: nodeId,
              cwd: initialCwd
            });
          }
        }
      });

      if (activeTabId && tabs[activeTabId]) {
        setTimeout(() => {
          try {
            tabs[activeTabId].fitAddon.fit();
            tabs[activeTabId].term.focus();
          } catch (_) {}
        }, 50);
      }
    });

    socket.on('terminal:created', (data) => {
      // Find a tab that is waiting for a session id
      const pendingTabId = pendingTabsQueue.shift() || Object.keys(tabs).find(id => !tabs[id].sessionId);
      if (pendingTabId && tabs[pendingTabId]) {
        tabs[pendingTabId].sessionId = data.sessionId;
        tabs[pendingTabId].needsRecreate = false;
      }
    });

    socket.on('terminal:pong', () => {
      // Heartbeat acknowledged
    });

    socket.on('terminal:data', (data) => {
      const tabId = Object.keys(tabs).find(id => tabs[id].sessionId === data.sessionId);
      if (tabId) {
        const tab = tabs[tabId];
        tab.term.write(data.data);
        if (tabId === activeTabId) {
          lastOutputBuffer.push(data.data);
          if (lastOutputBuffer.length > 500) lastOutputBuffer.shift();

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
      }
    });

    socket.on('terminal:exit', (data) => {
      const tabId = Object.keys(tabs).find(id => tabs[id].sessionId === data.sessionId);
      if (tabId) {
        const tab = tabs[tabId];
        tab.term.write(`\r\n\x1b[33m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`);
        tab.sessionId = null;
        tab.needsRecreate = true;
      }
    });

    socket.on('terminal:error', (data) => {
      console.error('Terminal Error:', data);
      if (data && data.code === 'SESSION_NOT_FOUND') {
        const targetTabId = Object.keys(tabs).find(id => tabs[id].sessionId === data.sessionId) || activeTabId;
        if (targetTabId && tabs[targetTabId]) {
          const tab = tabs[targetTabId];
          tab.sessionId = null;
          tab.needsRecreate = false;
          pendingTabsQueue.push(targetTabId);
          tab.term.write('\r\n\x1b[33m[Sesi lama kedaluwarsa. Memulai sesi baru...]\x1b[0m\r\n');
          if (socket && socket.connected) {
            socket.emit('terminal:create', {
              cols: tab.term.cols || 80,
              rows: tab.term.rows || 24,
              shell: 'bash',
              osUser: tab.osUser || selectedOsUser,
              nodeId: nodeId,
              cwd: initialCwd
            });
          }
        }
        return;
      }
      const tabId = Object.keys(tabs).find(id => tabs[id].sessionId === data.sessionId) || activeTabId;
      if (tabId && tabs[tabId]) {
        tabs[tabId].term.write(`\r\n\x1b[31mTerminal Error: ${data.message || 'Unknown error'}\x1b[0m\r\n`);
      }
    });

    socket.on('disconnect', (reason) => {
      stopHeartbeat();
      updateStatusUI('reconnecting', `Terputus (${reason})`);
      Object.keys(tabs).forEach(id => {
        const tab = tabs[id];
        if (tab) {
          tab.needsRecreate = true;
          tab.sessionId = null;
          tab.term.write('\r\n\x1b[33m[Koneksi terputus. Menunggu koneksi kembali...]\x1b[0m\r\n');
        }
      });
    });

    socket.on('connect_error', async (err) => {
      console.warn('Terminal WS Connect Error:', err.message);
      updateStatusUI('reconnecting', 'Otentikasi / Reconnecting...');
      if (err.message && (err.message.includes('Authentication') || err.message.includes('token') || err.message.includes('Unauthorized'))) {
        try {
          const refreshed = await LP.refreshToken();
          if (refreshed && socket) {
            socket.auth = { token: LP.state.accessToken || localStorage.getItem('lp_token') };
            socket.connect();
          }
        } catch (_) {}
      }
    });

    // Handle tab wake / visibility change
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (socket && !socket.connected) {
          updateStatusUI('reconnecting', 'Membangunkan koneksi...');
          socket.auth = { token: LP.state.accessToken || localStorage.getItem('lp_token') };
          socket.connect();
        } else if (activeTabId && tabs[activeTabId]) {
          try {
            tabs[activeTabId].fitAddon.fit();
            tabs[activeTabId].term.focus();
          } catch (_) {}
        }
      }
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
    addTab();
  }

  function addTab() {
    tabCounter++;
    const tabId = `tab-${tabCounter}`;
    
    // Create UI elements
    const tabList = document.getElementById('tabList');
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-outline-secondary';
    btn.id = `btn-${tabId}`;
    btn.innerHTML = `Tab ${tabCounter} <i class="bi bi-x" onclick="event.stopPropagation(); TerminalPage.closeTab('${tabId}')"></i>`;
    btn.onclick = () => switchTab(tabId);
    btn.style.fontSize = '12px';
    tabList.appendChild(btn);

    const container = document.getElementById('terminalsContainer');
    const termDiv = document.createElement('div');
    termDiv.id = `term-${tabId}`;
    termDiv.style.width = '100%';
    termDiv.style.height = '100%';
    termDiv.style.display = 'none';
    container.appendChild(termDiv);

    // Initialize xterm with 10,000 lines scrollback
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 14,
      lineHeight: 1.4,
      theme: { background: 'transparent', foreground: '#e6edf3', cursor: '#6366f1', selectionBackground: 'rgba(99, 102, 241, 0.3)' },
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 10000,
    });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    
    // Store in tabs
    tabs[tabId] = { term, fitAddon, sessionId: null, osUser: selectedOsUser, div: termDiv, btn: btn };

    term.open(termDiv);
    
    // Important: fit needs the div to be visible
    switchTab(tabId);

    term.onData((data) => {
      const tab = tabs[tabId];
      if (socket && tab.sessionId) {
        socket.emit('terminal:input', { sessionId: tab.sessionId, data });
      }
    });

    term.onResize((size) => {
      const tab = tabs[tabId];
      if (socket && tab.sessionId) {
        socket.emit('terminal:resize', { sessionId: tab.sessionId, cols: size.cols, rows: size.rows });
      }
    });

    pendingTabsQueue.push(tabId);
    if (socket && socket.connected) {
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

  function switchTab(tabId) {
    if (!tabs[tabId]) return;
    
    // Hide all
    Object.keys(tabs).forEach(id => {
      tabs[id].div.style.display = 'none';
      tabs[id].btn.classList.remove('active');
    });

    activeTabId = tabId;
    tabs[tabId].div.style.display = 'block';
    tabs[tabId].btn.classList.add('active');
    
    // Fit and focus
    setTimeout(() => {
      tabs[tabId].fitAddon.fit();
      tabs[tabId].term.focus();
    }, 10);
  }

  function closeTab(tabId) {
    if (!tabs[tabId]) return;
    if (Object.keys(tabs).length <= 1) {
      LP.toast('Cannot close the last tab', 'warning');
      return;
    }

    const tab = tabs[tabId];
    if (tab.sessionId && socket) {
      socket.emit('terminal:input', { sessionId: tab.sessionId, data: 'exit\n' });
    }
    
    tab.term.dispose();
    tab.div.remove();
    tab.btn.remove();
    delete tabs[tabId];

    if (activeTabId === tabId) {
      const remainingIds = Object.keys(tabs);
      switchTab(remainingIds[remainingIds.length - 1]);
    }
  }

  window.addEventListener('resize', () => {
    if (activeTabId && tabs[activeTabId]) {
      try { tabs[activeTabId].fitAddon.fit(); } catch (e) {}
    }
  });

  function insertSnippet(cmd) {
    if (activeTabId && tabs[activeTabId]) {
      const tab = tabs[activeTabId];
      if (socket && tab.sessionId) {
        socket.emit('terminal:input', { sessionId: tab.sessionId, data: cmd + '\n' });
        tab.term.focus();
      }
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

  function isSystemModifyingCommand(cmd) {
    if (!cmd) return false;
    return /\b(?:systemctl|service|apt|apt-get|yum|dnf|pacman|rm|kill|pkill|killall|chown|chmod|sed|docker\s+(?:rm|stop|restart|kill)|ufw|iptables|reboot|shutdown|mkfs|dd|truncate)\b/i.test(cmd);
  }

  async function confirmAndExecuteInTerminal(cmd, title = 'Konfirmasi Eksekusi Perintah') {
    if (!cmd) return;
    const cleanCmd = cmd.trim();
    const isModifying = isSystemModifyingCommand(cleanCmd);

    const safeCmdHtml = LP.escHtml ? LP.escHtml(cleanCmd) : cleanCmd.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const msg = isModifying
      ? `<div class="text-warning mb-2"><i class="bi bi-exclamation-triangle-fill me-1"></i><strong>Perhatian:</strong> Perintah ini berhubungan dengan perubahan sistem atau layanan server.</div><code>${safeCmdHtml}</code><br><br>Apakah Anda menyetujui eksekusi perintah ini di terminal?`
      : `Jalankan perintah berikut di sesi terminal aktif?<br><br><code>${safeCmdHtml}</code>`;

    const confirmed = await LP.confirm(msg, title);
    if (!confirmed) return;

    if (socket && activeTabId && tabs[activeTabId] && tabs[activeTabId].sessionId) {
      socket.emit('terminal:input', { sessionId: tabs[activeTabId].sessionId, data: cleanCmd + '\n' });
      if (copilotModal) copilotModal.hide();
      LP.toast('Perintah dikirim ke sesi terminal', 'info');
    } else {
      LP.toast('Sesi terminal tidak terhubung', 'warning');
    }
  }

  function copyCopilotCommand() {
    if (!currentGeneratedCommand) return;
    LP.copy(currentGeneratedCommand, 'Command copied to clipboard');
  }

  async function runCopilotCommand() {
    if (!currentGeneratedCommand) return;
    await confirmAndExecuteInTerminal(currentGeneratedCommand, 'Konfirmasi Perintah AI Copilot');
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

          const fixRiskBadge = document.getElementById('fixRiskBadge');
          if (fixRiskBadge) {
            const isMod = isSystemModifyingCommand(currentFixCommand);
            fixRiskBadge.className = `lp-badge lp-badge-${isMod ? 'warning' : 'success'}`;
            fixRiskBadge.textContent = isMod ? 'MODIFIES SYSTEM' : 'SAFE / READ-ONLY';
          }
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
    LP.copy(currentFixCommand, 'Perintah solusi berhasil disalin');
  }

  async function runFixCommand() {
    if (!currentFixCommand) return;
    await confirmAndExecuteInTerminal(currentFixCommand, 'Konfirmasi Perintah Solusi AI');
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
          const cleanCode = code.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
          let b64 = '';
          try {
            b64 = btoa(unescape(encodeURIComponent(cleanCode.trim())));
          } catch (_) {
            b64 = '';
          }
          return `<div class="position-relative my-2">
            <div class="d-flex justify-content-between align-items-center mb-1 px-1">
              <span class="text-muted" style="font-size:11px; font-family:monospace;">bash</span>
              <button class="btn btn-sm btn-primary py-0 px-2" style="font-size:11px;" onclick="TerminalPage.insertCodeFromB64('${b64}')"><i class="bi bi-play-fill"></i> Run in Terminal</button>
            </div>
            <pre style="background:#05070d; padding:10px; border-radius:6px; font-family:'JetBrains Mono', monospace; font-size:12.5px; border:1px solid rgba(255,255,255,0.08); white-space:pre-wrap; margin:0;">${code}</pre>
          </div>`;
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

  async function insertCodeToTerminal(cmd) {
    if (!cmd) return;
    await confirmAndExecuteInTerminal(cmd, 'Konfirmasi Jalankan di Terminal');
  }

  async function insertCodeFromB64(b64) {
    try {
      const code = decodeURIComponent(escape(atob(b64)));
      await confirmAndExecuteInTerminal(code, 'Konfirmasi Jalankan di Terminal');
    } catch (e) {
      LP.toast('Format perintah tidak valid', 'error');
    }
  }

  async function reconnect() {
    updateStatusUI('reconnecting', 'Menghubungkan ulang...');
    LP.toast('Menghubungkan ulang sesi terminal...', 'info');
    try {
      await LP.refreshToken();
    } catch (_) {}

    if (socket) {
      socket.auth = { token: LP.state.accessToken || localStorage.getItem('lp_token') };
      if (socket.connected) {
        socket.disconnect();
      }
      socket.connect();
    }
  }

  return {
    init,
    connect,
    reconnect,
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
    addTab,
    switchTab,
    closeTab,
    insertSnippet,
    insertCodeToTerminal,
    insertCodeFromB64,
  };
})();

// [FIX] Expose to window for LP.call() resolution
window.TerminalPage = TerminalPage;

document.addEventListener('DOMContentLoaded', () => {
  TerminalPage.init();
});
