/**
 * Linux Panel — filemanager.js
 * Full-featured file manager with grid/list view, context menu, upload, etc.
 */

const FMPage = (() => {
  let currentPath = '/';
  let selectedItem = null;
  let viewMode = localStorage.getItem('lp_fm_view') || 'grid';
  let _clipboard = null;
  let _editingPath = null;
  let _treeBasePath = null;
  let _openTabs = [];
  let _activeTab = null;
  let _tabContents = {};
  let _previewTabs = {}; // { path: 'image' | 'pdf' }

  const FILE_ICONS = {
    dir: '📁',
    // Images
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    // Video
    mp4: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬',
    // Audio
    mp3: '🎵', wav: '🎵', ogg: '🎵',
    // Code
    js: '📜', ts: '📜', py: '🐍', php: '🐘', html: '🌐', css: '🎨',
    json: '📋', yaml: '📋', yml: '📋', xml: '📋',
    sh: '⚙️', bash: '⚙️', zsh: '⚙️',
    // Archives
    zip: '📦', tar: '📦', gz: '📦', bz2: '📦',
    // Docs
    pdf: '📄', doc: '📄', docx: '📄', txt: '📄', md: '📄',
    // DB
    sql: '🗄️', db: '🗄️', sqlite: '🗄️',
    // Default
    default: '📄',
  };

  function getIcon(item) {
    if (item.type === 'dir') return FILE_ICONS.dir;
    const ext = item.name.split('.').pop()?.toLowerCase();
    return FILE_ICONS[ext] || FILE_ICONS.default;
  }

  // ── Navigation ────────────────────────────────────
  async function navigate(path) {
    try {
      const res = await LP.get(`/filemanager/list?path=${encodeURIComponent(path)}`);
      if (!res?.success) {
        LP.toast(res?.message || 'Failed to list directory', 'error');
        return;
      }

      currentPath = path;
      document.getElementById('currentPath').value = path;
      document.getElementById('upBtn').disabled = path === '/';
      selectedItem = null;

      renderItems(res.data.items || []);
    } catch (err) {
      LP.toast('Navigation failed: ' + err.message, 'error');
    }
  }

  function renderItems(items) {
    const grid = document.getElementById('fmGrid');

    // Set view class
    if (viewMode === 'list') {
      document.getElementById('fmWrapper').classList.add('fm-list-view');
    } else {
      document.getElementById('fmWrapper').classList.remove('fm-list-view');
    }

    if (!items.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-muted)"><i class="bi bi-folder-x" style="font-size:40px;display:block;margin-bottom:8px"></i>Empty directory</div>';
      return;
    }

    let html = '';
    if (viewMode === 'list') {
      html += `
        <div class="fm-header-row" style="display:flex; align-items:center; gap:12px; padding:6px 12px; border-bottom:1px solid var(--glass-border); font-size:11px; font-weight:600; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">
          <div style="width:18px; display:flex; align-items:center; justify-content:center;">
            <input type="checkbox" id="selectAllCheckbox" onclick="FMPage.toggleSelectAll(this)" style="width:14px; height:14px; cursor:pointer;">
          </div>
          <div style="width:18px;"></div>
          <div style="flex:1;">Name</div>
          <div style="width:80px;">Permissions</div>
          <div style="width:120px;">Owner</div>
          <div style="width:90px; text-align:right;">Size</div>
        </div>
      `;
    }

    html += items.map(item => `
      <div class="fm-item fade-in"
        data-path="${escHtml(item.path)}"
        data-type="${item.type}"
        data-name="${escHtml(item.name)}"
        onclick="FMPage.selectItem(this, event)"
        ondblclick="FMPage.openItem(this)"
        oncontextmenu="FMPage.showContextMenu(event, this)"
        title="${escHtml(item.path)}">
        <div class="fm-checkbox-wrapper" onclick="event.stopPropagation()">
          <input type="checkbox" class="fm-checkbox" data-path="${escHtml(item.path)}" onchange="FMPage.updateBulkBar()" style="margin:0;">
        </div>
        <div class="fm-item-icon">${getIcon(item)}</div>
        <div class="fm-item-name">${escHtml(item.name)}</div>
        <div class="fm-item-permissions font-mono">${item.permissions || '-'}</div>
        <div class="fm-item-owner">${item.owner || '-'}</div>
        <div class="fm-item-size">${item.type === 'dir' ? 'Folder' : LP.formatBytes(item.size)}</div>
      </div>
    `).join('');

    grid.innerHTML = html;
    
    // Hide bulk bar on every navigate/refresh
    const bulkBar = document.getElementById('fmBulkBar');
    if (bulkBar) bulkBar.style.display = 'none';
  }

  // ── Context Menu ──────────────────────────────────
  function showContextMenu(e, el) {
    e.preventDefault();
    selectItem(el);

    const menu = document.getElementById('fmContextMenu');
    menu.style.display = 'block';
    menu.style.left = Math.min(e.pageX, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(e.pageY, window.innerHeight - 200) + 'px';

    document.addEventListener('click', () => { menu.style.display = 'none'; }, { once: true });
  }

  function selectItem(el, e = null) {
    // If user clicks directly on input or checkbox wrapper, don't trigger normal single select
    if (e && (e.target.classList.contains('fm-checkbox') || e.target.closest('.fm-checkbox-wrapper'))) {
      return;
    }

    document.querySelectorAll('.fm-item.selected').forEach(i => i.classList.remove('selected'));
    if (el) {
      el.classList.add('selected');
      selectedItem = {
        path: el.dataset.path,
        type: el.dataset.type,
        name: el.dataset.name,
        el,
      };
    }
  }

  function updateBulkBar() {
    const checkboxes = document.querySelectorAll('.fm-checkbox:checked');
    const bulkBar = document.getElementById('fmBulkBar');
    const countSpan = document.getElementById('bulkSelectedCount');
    
    if (checkboxes.length > 0) {
      if (bulkBar) bulkBar.style.display = 'flex';
      if (countSpan) countSpan.textContent = checkboxes.length;
    } else {
      if (bulkBar) bulkBar.style.display = 'none';
    }

    // Toggle active background visual class for checked parent items
    document.querySelectorAll('.fm-item').forEach(item => {
      const chk = item.querySelector('.fm-checkbox');
      if (chk && chk.checked) {
        item.classList.add('selected');
      } else if (selectedItem?.path !== item.dataset.path) {
        item.classList.remove('selected');
      }
    });
  }

  function toggleSelectAll(masterChk) {
    const isChecked = masterChk.checked;
    document.querySelectorAll('.fm-checkbox').forEach(chk => {
      chk.checked = isChecked;
    });
    updateBulkBar();
  }

  // ── Bulk Actions Implementations ───────────────────
  function getSelectedPaths() {
    return Array.from(document.querySelectorAll('.fm-checkbox:checked')).map(chk => chk.dataset.path);
  }

  async function bulkCompress() {
    const paths = getSelectedPaths();
    if (paths.length === 0) return;
    const _output = currentPath + '/archive-' + Date.now() + '.zip';
    
    LP.toast('Compressing files...', 'info');
    
    // Process compression sequentially or via bulk API
    let successCount = 0;
    for (const p of paths) {
      try {
        const itemOutput = p + '.zip';
        const res = await LP.post('/filemanager/zip', { path: p, output: itemOutput });
        if (res?.success) successCount++;
      } catch {}
    }

    LP.toast(`Compressed ${successCount}/${paths.length} items.`, 'success');
    refresh();
  }

  async function bulkDownload() {
    const paths = getSelectedPaths();
    if (paths.length === 0) return;
    
    LP.toast('Downloading selected files...', 'info');
    
    // Download files concurrently using short-lived download tokens
    paths.forEach(async p => {
      const url = await _getDownloadUrl(p);
      const frame = document.createElement('iframe');
      frame.src = url;
      frame.style.display = 'none';
      document.body.appendChild(frame);
      setTimeout(() => frame.remove(), 5000);
    });
  }

  async function bulkChmod() {
    const paths = getSelectedPaths();
    if (paths.length === 0) return;
    const perm = prompt('Enter permissions octal (e.g. 755 or 644):', '644');
    if (!perm || !/^[0-7]{3,4}$/.test(perm)) {
      LP.toast('Invalid permission octal code', 'error');
      return;
    }

    LP.toast('Chmod permissions...', 'info');

    // Make chmod API call if supported, else loop
    let successCount = 0;
    for (const p of paths) {
      try {
        const res = await LP.post('/filemanager/chmod', { path: p, mode: perm });
        if (res?.success) successCount++;
      } catch {}
    }

    LP.toast(`Updated permissions for ${successCount}/${paths.length} items`, 'success');
    refresh();
  }

  async function bulkDelete() {
    const paths = getSelectedPaths();
    if (paths.length === 0) return;
    const confirmed = await LP.confirm(`Delete <strong>${paths.length}</strong> selected items?<br><small class="text-danger">This action cannot be undone.</small>`, 'Bulk Delete');
    if (!confirmed) return;

    LP.toast('Deleting selected items...', 'info');
    
    let successCount = 0;
    for (const p of paths) {
      try {
        const delRes = await fetch('/api/filemanager/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LP.state.accessToken}` },
          credentials: 'include',
          body: JSON.stringify({ path: p }),
        }).then(r => r.json());
        if (delRes?.success) successCount++;
      } catch {}
    }

    LP.toast(`Deleted ${successCount}/${paths.length} items`, 'success');
    refresh();
  }

  // ── Actions ───────────────────────────────────────
  async function openItem(el = null) {
    const item = el ? {
      path: el.dataset.path,
      type: el.dataset.type,
      name: el.dataset.name,
    } : selectedItem;

    if (!item) return;

    if (item.type === 'dir') {
      navigate(item.path);
    } else {
      const ext = item.name.split('.').pop()?.toLowerCase();
      
      // 1. Image preview — open in split view
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) {
        await openSplitView(item.path, 'image');
        return;
      }

      // 2. PDF preview — open in split view
      if (ext === 'pdf') {
        await openSplitView(item.path, 'pdf');
        return;
      }

      // 3. Binary file blocker (zip, tar, exe, db, mp4, etc.)
      const isText = ['txt', 'md', 'js', 'ts', 'json', 'html', 'css', 'py', 'php', 'sh', 'bash', 'zsh', 'env', 'yml', 'yaml', 'xml', 'log', 'htaccess', 'conf', 'ini'].includes(ext);
      if (!isText && ext) {
        await LP.alert(`File <strong>${escHtml(item.name)}</strong> merupakan file biner (.${ext}) dan tidak dapat dibuka langsung menggunakan Text Editor. Silakan download file untuk membukanya.`, 'Buka File Gagal');
        return;
      }

      // Default fallback: text editor
      await openFileEditor(item.path);
    }
  }

  // ── Split View: File Tree + Editor ──────────────────────
  async function openSplitView(path, previewType = null) {
    if (previewType) {
      // Preview mode (image/pdf) — no need to read file content
      document.getElementById('fmFileArea').style.display = 'none';
      document.getElementById('fmSplitView').style.display = 'flex';

      // Hide editor elements, show preview container
      const editorBody = document.querySelector('.fm-editor-body');
      if (editorBody) editorBody.classList.add('fm-showing-preview');
      const footer = document.getElementById('fmEditorFooter');
      const toggle = document.getElementById('fmThemeToggle');
      if (footer) footer.style.display = 'none';
      if (toggle) toggle.style.display = 'none';

      // Add tab
      addTab(path);
      _previewTabs[path] = previewType;

      // Load tree positioned at file's parent directory
      await loadFileTree(path);

      // Render preview
      renderPreview(path, previewType);
      return;
    }
    const res = await LP.get(`/filemanager/read?path=${encodeURIComponent(path)}`);
    if (!res?.success) { LP.toast('Cannot read file: ' + res?.message, 'error'); return; }

    // Show split view, hide grid
    document.getElementById('fmFileArea').style.display = 'none';
    document.getElementById('fmSplitView').style.display = 'flex';

    // Add tab
    addTab(path);
    _tabContents[path] = res.data.content;

    // Load tree positioned at file's parent directory
    await loadFileTree(path);

    // Render editor
    renderSplitEditor(path, res.data.content);
  }

  // ── Tab Management ─────────────────────────────────
  function addTab(path) {
    const name = path.split('/').pop();
    _openTabs = _openTabs.filter(t => t.path !== path);
    _openTabs.push({ path, name });
    _activeTab = path;
    renderTabs();
  }

  function renderTabs() {
    const container = document.getElementById('fmSplitTabs');
    if (!container) return;
    container.innerHTML = _openTabs.map(t => `
      <div class="fm-split-tab${t.path === _activeTab ? ' active' : ''}"
           onclick="FM.switchTab('${LP.encJsArg(t.path)}')">
        <i class="bi bi-file-code-fill" style="font-size:11px;"></i>
        ${escHtml(t.name)}
        <span class="fm-split-tab-close" onclick="event.stopPropagation(); FM.closeTab('${LP.encJsArg(t.path)}')">
          <i class="bi bi-x"></i>
        </span>
      </div>
    `).join('');
  }

  async function switchTab(path) {
    // Save current editor content before switching
    if (_cm && _editingPath && !_previewTabs[_editingPath]) {
      _tabContents[_editingPath] = _cm.getValue();
    }

    _activeTab = path;
    renderTabs();

    // Show/hide editor vs preview based on tab type
    const editorBody = document.querySelector('.fm-editor-body');
    const editorFooter = document.getElementById('fmEditorFooter');
    const themeToggle = document.getElementById('fmThemeToggle');

    if (_previewTabs[path]) {
      // Preview tab — hide editor (CodeMirror), show preview container
      if (editorBody) editorBody.classList.add('fm-showing-preview');
      if (editorFooter) editorFooter.style.display = 'none';
      if (themeToggle) themeToggle.style.display = 'none';
      // Load preview if not yet rendered
      renderPreview(path, _previewTabs[path]);
    } else {
      // Editor tab — show editor, hide preview
      if (editorBody) editorBody.classList.remove('fm-showing-preview');
      if (editorFooter) editorFooter.style.display = 'flex';
      if (themeToggle) themeToggle.style.display = '';

      // Fetch content if not cached
      if (!_tabContents[path]) {
        try {
          const res = await LP.get(`/filemanager/read?path=${encodeURIComponent(path)}`);
          if (res?.success) _tabContents[path] = res.data.content;
        } catch (err) {
          LP.toast('Failed to load file: ' + err.message, 'error');
          return;
        }
      }

      renderSplitEditor(path, _tabContents[path] || '');
    }

    highlightTreeItem(path);
  }

  function renderPreview(path, type) {
    const container = document.getElementById('fmPreviewContent');
    const loading = document.getElementById('fmPreviewLoading');
    const headerPath = document.getElementById('fmEditorPath');
    const unsavedBadge = document.getElementById('fmEditorUnsaved');

    if (!container) return;

    // Update header
    if (headerPath) headerPath.textContent = path;
    if (unsavedBadge) unsavedBadge.style.display = 'none';

    // Show loading
    if (loading) loading.style.display = '';
    container.innerHTML = '';

    _getDownloadUrl(path).then(url => {
      if (loading) loading.style.display = 'none';

      if (type === 'image') {
        container.innerHTML = `<img src="${url}" alt="${escHtml(path)}" onerror="this.parentElement.innerHTML='<div class=\"fm-preview-error\"><i class=\"bi bi-exclamation-triangle-fill\"></i>Failed to load image: ${escHtml(path)}</div>'">`;
      } else if (type === 'pdf') {
        container.innerHTML = `<iframe src="${url}#toolbar=1" sandbox="allow-scripts allow-same-origin"></iframe>`;
      }
    }).catch(err => {
      if (loading) loading.style.display = 'none';
      container.innerHTML = `<div class="fm-preview-error"><i class="bi bi-exclamation-triangle-fill"></i>Failed to load preview: ${err.message}</div>`;
    });
  }

  function closeTab(path) {
    _openTabs = _openTabs.filter(t => t.path !== path);
    delete _tabContents[path];
    delete _previewTabs[path];

    if (_activeTab === path) {
      if (_openTabs.length > 0) {
        switchTab(_openTabs[_openTabs.length - 1].path);
      } else {
        closeSplitView();
        return;
      }
    } else {
      renderTabs();
    }
  }

  // ── File Tree ──────────────────────────────────────
  async function loadFileTree(activeFilePath) {
    const dir = activeFilePath.substring(0, activeFilePath.lastIndexOf('/')) || '/';
    _treeBasePath = dir;

    const titleEl = document.getElementById('fmTreeTitle');
    if (titleEl) titleEl.textContent = dir === '/' ? '/' : dir.split('/').pop();

    const res = await LP.get(`/filemanager/list?path=${encodeURIComponent(dir)}`);
    if (!res?.success) {
      const container = document.getElementById('fmTreeContainer');
      if (container) container.innerHTML = '<div class="fm-tree-empty">Failed to load directory</div>';
      return;
    }

    renderTree(res.data.items, dir, activeFilePath);
  }

  function renderTree(items, basePath, activeFilePath) {
    const container = document.getElementById('fmTreeContainer');
    if (!container) return;

    let html = '';

    // Parent directory entry (..)
    if (basePath !== '/') {
      html += `<div class="fm-tree-item fm-tree-dir" data-path="${escHtml(basePath)}" data-type="parent">
        <span class="fm-tree-toggle"><i class="bi bi-arrow-up-short" style="font-size:12px;"></i></span>
        <span class="fm-tree-icon">📂</span>
        <span class="fm-tree-name" style="color:var(--text-muted);font-style:italic;">..</span>
      </div>`;
    }

    // Sort: dirs first, then alphabetical
    const sorted = [...items].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    html += sorted.map(item => {
      const isActive = item.path === activeFilePath;
      const icon = item.type === 'dir' ? '📁' : getIcon(item);
      const typeClass = item.type === 'dir' ? 'fm-tree-dir' : '';
      const activeClass = isActive ? 'fm-tree-active' : '';

      if (item.type === 'dir') {
        return `<div class="fm-tree-item ${typeClass} ${activeClass}" data-path="${escHtml(item.path)}" data-type="dir">
          <span class="fm-tree-toggle">▶</span>
          <span class="fm-tree-icon">📁</span>
          <span class="fm-tree-name">${escHtml(item.name)}</span>
        </div>
        <div class="fm-tree-children" data-parent="${escHtml(item.path)}"></div>`;
      } else {
        return `<div class="fm-tree-item ${activeClass}" data-path="${escHtml(item.path)}" data-type="file">
          <span class="fm-tree-toggle" style="visibility:hidden;">▶</span>
          <span class="fm-tree-icon">${icon}</span>
          <span class="fm-tree-name">${escHtml(item.name)}</span>
        </div>`;
      }
    }).join('');

    container.innerHTML = html;

    // Event delegation for tree clicks
    container.onclick = (e) => {
      const item = e.target.closest('.fm-tree-item');
      if (!item) return;
      const path = item.dataset.path;
      const type = item.dataset.type;
      if (type === 'dir') {
        toggleTreeDir(item, path);
      } else if (type === 'parent') {
        goTreeUp();
      } else {
        openTreeFile(path);
      }
    };
  }

  async function toggleTreeDir(el, path) {
    const childrenContainer = el.nextElementSibling;
    if (!childrenContainer || !childrenContainer.classList.contains('fm-tree-children')) return;

    const toggle = el.querySelector('.fm-tree-toggle');

    if (childrenContainer.classList.contains('open')) {
      childrenContainer.classList.remove('open');
      if (toggle) toggle.classList.remove('expanded');
      if (toggle) toggle.textContent = '▶';
      return;
    }

    // Loading state
    if (toggle) toggle.innerHTML = '<div class="spinner-border spinner-border-sm" style="width:10px;height:10px;border-width:1.5px;"></div>';

    try {
      const res = await LP.get(`/filemanager/list?path=${encodeURIComponent(path)}`);
      if (!res?.success) {
        if (toggle) toggle.textContent = '▶';
        return;
      }

      const items = res.data.items;
      const sorted = [...items].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      let html = '';
      sorted.forEach(item => {
        const icon = item.type === 'dir' ? '📁' : getIcon(item);
        const isActive = item.path === _activeTab;
        const activeClass = isActive ? 'fm-tree-active' : '';

        if (item.type === 'dir') {
          html += `<div class="fm-tree-item fm-tree-dir ${activeClass}" data-path="${escHtml(item.path)}" data-type="dir">
            <span class="fm-tree-toggle">▶</span>
            <span class="fm-tree-icon">📁</span>
            <span class="fm-tree-name">${escHtml(item.name)}</span>
          </div>
          <div class="fm-tree-children" data-parent="${escHtml(item.path)}"></div>`;
        } else {
          html += `<div class="fm-tree-item ${activeClass}" data-path="${escHtml(item.path)}" data-type="file">
            <span class="fm-tree-toggle" style="visibility:hidden;">▶</span>
            <span class="fm-tree-icon">${icon}</span>
            <span class="fm-tree-name">${escHtml(item.name)}</span>
          </div>`;
        }
      });

      childrenContainer.innerHTML = html;
      childrenContainer.classList.add('open');
      if (toggle) {
        toggle.classList.add('expanded');
        toggle.textContent = '▼';
      }
    } catch (err) {
      if (toggle) toggle.textContent = '▶';
    }
  }

  async function openTreeFile(path) {
    if (path === _editingPath) return;

    // Save current content to cache
    if (_cm && _editingPath) {
      _tabContents[_editingPath] = _cm.getValue();
    }

    // Add tab
    addTab(path);

    // Fetch if not cached
    if (!_tabContents[path]) {
      try {
        const res = await LP.get(`/filemanager/read?path=${encodeURIComponent(path)}`);
        if (!res?.success) { LP.toast('Cannot read file: ' + res?.message, 'error'); return; }
        _tabContents[path] = res.data.content;
      } catch (err) {
        LP.toast('Failed to load file: ' + err.message, 'error');
        return;
      }
    }

    renderSplitEditor(path, _tabContents[path]);
    highlightTreeItem(path);
  }

  async function goTreeUp() {
    if (!_treeBasePath || _treeBasePath === '/') return;
    const parent = _treeBasePath.substring(0, _treeBasePath.lastIndexOf('/')) || '/';
    _treeBasePath = parent;

    const titleEl = document.getElementById('fmTreeTitle');
    if (titleEl) titleEl.textContent = parent === '/' ? '/' : parent.split('/').pop();

    const res = await LP.get(`/filemanager/list?path=${encodeURIComponent(parent)}`);
    if (!res?.success) return;
    renderTree(res.data.items, parent, _activeTab);
  }

  async function refreshTree() {
    if (!_treeBasePath) return;
    const res = await LP.get(`/filemanager/list?path=${encodeURIComponent(_treeBasePath)}`);
    if (!res?.success) return;
    renderTree(res.data.items, _treeBasePath, _activeTab);
  }

  function highlightTreeItem(path) {
    // Use iteration instead of CSS selector to avoid escaping issues with paths containing " or special chars
    document.querySelectorAll('.fm-tree-item.fm-tree-active').forEach(el => {
      el.classList.remove('fm-tree-active');
    });
    document.querySelectorAll('.fm-tree-item').forEach(el => {
      if (el.dataset.path === path) {
        el.classList.add('fm-tree-active');
      }
    });
  }

  // ── Tree Search/Filter ───────────────────────────
  function filterTree(query) {
    const container = document.getElementById('fmTreeContainer');
    const clearBtn = document.getElementById('fmTreeFilterClear');
    if (!container) return;

    const q = query.trim().toLowerCase();

    // Show/hide clear button
    if (clearBtn) clearBtn.style.display = q.length > 0 ? 'flex' : 'none';

    // Toggle filtering class on container
    container.classList.toggle('fm-tree-filtering', q.length > 0);

    if (!q) {
      // Reset: show all items
      container.querySelectorAll('.fm-tree-item').forEach(el => el.classList.remove('fm-tree-hidden'));
      return;
    }

    // Filter items: hide those whose name doesn't match
    container.querySelectorAll('.fm-tree-item').forEach(el => {
      const nameEl = el.querySelector('.fm-tree-name');
      if (!nameEl) return;
      const name = nameEl.textContent.toLowerCase();
      el.classList.toggle('fm-tree-hidden', !name.includes(q));
    });

    // Show parent directories that have visible children
    container.querySelectorAll('.fm-tree-children').forEach(ch => {
      const hasVisible = Array.from(ch.querySelectorAll('.fm-tree-item')).some(item => !item.classList.contains('fm-tree-hidden'));
      // If has visible children, also show the parent dir item
      if (hasVisible) {
        const prevItem = ch.previousElementSibling;
        if (prevItem && prevItem.classList.contains('fm-tree-item')) {
          prevItem.classList.remove('fm-tree-hidden');
        }
      }
    });
  }

  function clearTreeFilter() {
    const input = document.getElementById('fmTreeFilterInput');
    if (input) {
      input.value = '';
      filterTree('');
      input.focus();
    }
  }

  // ── Draggable Split Divider ────────────────────────
  let _splitDividerInitialized = false;

  function initSplitDivider() {
    if (_splitDividerInitialized) return;
    _splitDividerInitialized = true;

    const divider = document.getElementById('fmSplitDivider');
    const treePanel = document.getElementById('fmTreePanel');
    if (!divider || !treePanel) return;

    // Restore saved width
    const savedWidth = localStorage.getItem('lp_fm_tree_width');
    if (savedWidth) {
      const w = parseInt(savedWidth, 10);
      if (w >= 180 && w <= 600) {
        treePanel.style.width = w + 'px';
      }
    }

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    function onMouseDown(e) {
      // Only left click
      if (e.button !== 0) return;
      // Disable on small screens
      if (window.innerWidth <= 768) return;

      isDragging = true;
      startX = e.clientX;
      startWidth = treePanel.offsetWidth;

      divider.classList.add('dragging');
      document.body.classList.add('fm-resizing');

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      // Prevent text selection while dragging
      e.preventDefault();
    }

    function onMouseMove(e) {
      if (!isDragging) return;

      const delta = e.clientX - startX;
      let newWidth = startWidth + delta;

      // Clamp between 180px and 50% of container
      const container = divider.parentElement;
      if (container) {
        const maxWidth = container.offsetWidth * 0.5;
        newWidth = Math.max(180, Math.min(newWidth, maxWidth));
      } else {
        newWidth = Math.max(180, Math.min(newWidth, 600));
      }

      treePanel.style.width = newWidth + 'px';
    }

    function onMouseUp() {
      if (!isDragging) return;
      isDragging = false;

      divider.classList.remove('dragging');
      document.body.classList.remove('fm-resizing');

      // Persist to localStorage
      localStorage.setItem('lp_fm_tree_width', treePanel.offsetWidth);

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    divider.addEventListener('mousedown', onMouseDown);

    // Cleanup on window resize (switch to mobile layout)
    window.addEventListener('resize', () => {
      if (window.innerWidth <= 768) {
        treePanel.style.width = ''; // Reset to CSS default
      } else if (!treePanel.style.width) {
        // Restore saved width when going back to desktop
        const saved = localStorage.getItem('lp_fm_tree_width');
        if (saved) treePanel.style.width = saved + 'px';
      }
    });
  }

  // ── Editor: Theme Toggle ───────────────────────────
  let _editorTheme = localStorage.getItem('lp_fm_editor_theme') || 'dark';

  function toggleEditorTheme() {
    _editorTheme = _editorTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('lp_fm_editor_theme', _editorTheme);
    applyEditorTheme();
  }

  function applyEditorTheme() {
    const splitContainer = document.getElementById('fmSplitView');
    if (!splitContainer) return;

    if (_editorTheme === 'light') {
      splitContainer.classList.add('fm-editor-light');
    } else {
      splitContainer.classList.remove('fm-editor-light');
    }

    // Update CodeMirror theme
    if (_cm) {
      _cm.setOption('theme', _editorTheme === 'light' ? 'material' : 'material-darker');
      _cm.refresh();
    }

    // Update toggle icon
    const icon = document.getElementById('fmThemeIcon');
    if (icon) {
      icon.className = _editorTheme === 'light' ? 'bi bi-moon-fill' : 'bi bi-sun-fill';
    }

    // Update toggle button title
    const btn = document.getElementById('fmThemeToggle');
    if (btn) {
      btn.title = _editorTheme === 'light' ? 'Switch to Dark Theme' : 'Switch to Light Theme';
    }
  }

  // ── Editor (CodeMirror) ───────────────────────────
  let _cm = null;
  let _cmInitialized = false;

  /** Map file extensions to CodeMirror modes */
  function getModeByExtension(path) {
    const ext = path.split('.').pop()?.toLowerCase();
    const map = {
      js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
      ts: 'javascript', tsx: 'javascript',
      json: 'application/json',
      html: 'htmlmixed', htm: 'htmlmixed',
      css: 'css', scss: 'text/x-scss', less: 'text/x-less',
      xml: 'xml', svg: 'xml', xhtml: 'xml',
      py: 'python', pyw: 'python',
      php: 'php', phtml: 'php',
      sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
      sql: 'sql',
      yaml: 'yaml', yml: 'yaml',
      md: 'markdown', markdown: 'markdown',
      java: 'text/x-java', c: 'text/x-csrc', cpp: 'text/x-c++src',
      cs: 'text/x-csharp', go: 'text/x-go', rs: 'text/x-rustsrc',
      rb: 'text/x-ruby', pl: 'text/x-perl',
      swift: 'text/x-swift', kt: 'text/x-kotlin',
      nginx: 'text/x-nginx-conf', conf: 'text', ini: 'text',
      env: 'text', htaccess: 'text', log: 'text', txt: 'text',
    };
    return map[ext] || 'text';
  }

  function initCodeMirror() {
    if (_cmInitialized) return;
    const textarea = document.getElementById('fmEditorTextarea');
    if (!textarea || typeof CodeMirror === 'undefined') return;
    _cmInitialized = true;

    _cm = CodeMirror.fromTextArea(textarea, {
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      lineWrapping: false,
      theme: _editorTheme === 'light' ? 'material' : 'material-darker',
      styleActiveLine: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      extraKeys: {
        'Ctrl-S': () => saveSplitEditor(),
        'Cmd-S': () => saveSplitEditor(),
        Tab: (cm) => {
          // Custom 2-space tab
          cm.replaceSelection('  ');
        },
      },
      // Default to plain text until a file is opened
      mode: 'text',
    });

    // Track unsaved changes
    _cm.on('change', () => {
      const badge = document.getElementById('fmEditorUnsaved');
      if (badge) badge.style.display = 'inline';
      updateCodeMirrorStats();
    });

    // Cursor position tracking (attached once here, not per renderSplitEditor)
    _cm.on('cursorActivity', updateCodeMirrorStats);

    // Initial stats
    updateCodeMirrorStats();
  }

  function updateCodeMirrorStats() {
    if (!_cm) return;
    const stats = document.getElementById('fmEditorStats');
    if (!stats) return;
    const value = _cm.getValue();
    const lineCount = value.split('\n').length;
    const ch = value.length;
    const cursor = _cm.getCursor();
    stats.textContent = `Ln ${cursor.line + 1}, Col ${cursor.ch + 1} | ${lineCount} lines | ${ch} chars`;
  }

  function renderSplitEditor(path, content) {
    _editingPath = path;

    // Update header
    const headerPath = document.getElementById('fmEditorPath');
    const unsavedBadge = document.getElementById('fmEditorUnsaved');
    if (headerPath) headerPath.textContent = path;
    if (_cm) {
      // Suppress the unsaved badge during programmatic setValue
      _cm.setValue(content);
      _cm.clearHistory();

      // Hide badge AFTER setValue (which fires 'change' event)
      if (unsavedBadge) unsavedBadge.style.display = 'none';

      // Set mode based on file extension
      const mode = getModeByExtension(path);
      _cm.setOption('mode', mode);

      // Refresh to ensure proper sizing
      setTimeout(() => _cm.refresh(), 50);

      updateCodeMirrorStats();
    }

    // Highlight in tree
    highlightTreeItem(path);
    renderTabs();
  }

  async function saveSplitEditor() {
    if (!_cm || !_editingPath) return;

    const content = _cm.getValue();
    try {
      const res = await LP.post('/filemanager/write', { path: _editingPath, content });
      if (res?.success) {
        LP.toast('File saved successfully', 'success');
        const badge = document.getElementById('fmEditorUnsaved');
        if (badge) badge.style.display = 'none';
        _tabContents[_editingPath] = content;
      } else {
        LP.toast('Failed to save: ' + res?.message, 'error');
      }
    } catch (err) {
      LP.toast('Failed to save: ' + err.message, 'error');
    }
  }

  function closeSplitView() {
    document.getElementById('fmSplitView').style.display = 'none';
    document.getElementById('fmFileArea').style.display = 'block';
    _editingPath = null;
    _openTabs = [];
    _activeTab = null;
    _tabContents = {};
    _previewTabs = {};
    // Reset CodeMirror
    if (_cm) {
      _cm.setValue('');
      _cm.clearHistory();
    }
    // Reset preview
    const editorBody = document.querySelector('.fm-editor-body');
    if (editorBody) editorBody.classList.remove('fm-showing-preview');
    const editorFooter = document.getElementById('fmEditorFooter');
    if (editorFooter) editorFooter.style.display = 'flex';
    const themeToggle = document.getElementById('fmThemeToggle');
    if (themeToggle) themeToggle.style.display = '';
    refresh();
  }

  // Override openFileEditor to use split view
  async function openFileEditor(path) {
    await openSplitView(path);
  }

  // Backward compat alias — the old modal-based editor is removed,
  // but this stays in the public API in case plugins reference it.
  async function _saveFile(_path, _modalId, _keepOpen) {
    if (_editingPath) {
      await saveSplitEditor();
    } else {
      LP.toast('No file is currently open in the editor', 'error');
    }
  }

  async function renameSelected() {
    if (!selectedItem) return;
    const newName = prompt('New name:', selectedItem.name);
    if (!newName || newName === selectedItem.name) return;

    const res = await LP.post('/filemanager/rename', { path: selectedItem.path, newName });
    if (res?.success) {
      LP.toast('Renamed successfully', 'success');
      refresh();
    } else {
      LP.toast(res?.message || 'Rename failed', 'error');
    }
  }

  async function deleteSelected() {
    if (!selectedItem) return;
    const confirmed = await LP.confirm(`Delete <strong>${escHtml(selectedItem.name)}</strong>?<br><small class="text-danger">This action cannot be undone.</small>`, 'Delete File');
    if (!confirmed) return;

    const _res = await LP.del('/filemanager/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LP.state.accessToken}` },
      body: JSON.stringify({ path: selectedItem.path }),
    });

    // Custom delete call (LP.del wraps body issue)
    const delRes = await fetch('/api/filemanager/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LP.state.accessToken}` },
      credentials: 'include',
      body: JSON.stringify({ path: selectedItem.path }),
    }).then(r => r.json());

    if (delRes?.success) {
      LP.toast('Deleted', 'success');
      refresh();
    } else {
      LP.toast(delRes?.message || 'Delete failed', 'error');
    }
  }

  function copySelected() {
    if (!selectedItem) return;
    _clipboard = { ...selectedItem, action: 'copy' };
    LP.toast(`${selectedItem.name} copied to clipboard`, 'info');
  }

  function moveSelected() {
    if (!selectedItem) return;
    _clipboard = { ...selectedItem, action: 'move' };
    LP.toast(`${selectedItem.name} cut to clipboard`, 'info');
  }

  async function createFile() {
    const name = await LP.prompt('Enter new file name (e.g. index.html, script.js, .env):', 'text', 'Create New File');
    if (!name || !name.trim()) return;
    const fileName = name.trim();
    const filePath = (currentPath === '/' ? '' : currentPath) + '/' + fileName;

    const res = await LP.post('/filemanager/write', { path: filePath, content: '' });
    if (res?.success) {
      LP.toast(`File "${fileName}" created successfully`, 'success');
      refresh();
      // Auto open text editor for newly created file
      openItem({ path: filePath, type: 'file', name: fileName });
    } else {
      LP.toast(res?.message || 'Failed to create file', 'error');
    }
  }

  async function createFolder() {
    const name = await LP.prompt('Enter new folder name:', 'text', 'Create New Folder');
    if (!name || !name.trim()) return;
    const folderName = name.trim();
    const folderPath = (currentPath === '/' ? '' : currentPath) + '/' + folderName;
    const res = await LP.post('/filemanager/mkdir', { path: folderPath });
    if (res?.success) { LP.toast(`Folder "${folderName}" created`, 'success'); refresh(); }
    else LP.toast(res?.message || 'Failed to create folder', 'error');
  }

  async function mkdir() {
    return createFolder();
  }

  function openTerminal() {
    const path = currentPath || '/';
    window.location.href = `/terminal?path=${encodeURIComponent(path)}`;
  }

  async function upload(files) {
    if (!files?.length) return;
    const formData = new FormData();
    for (const file of files) formData.append('files', file);
    formData.append('path', currentPath);

    LP.toast(`Uploading ${files.length} file(s)...`, 'info', null, 2000);

    const res = await fetch(`/api/filemanager/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LP.state.accessToken}` },
      credentials: 'include',
      body: formData,
    }).then(r => r.json());

    if (res?.success) { LP.toast(`Uploaded ${files.length} file(s)`, 'success'); refresh(); }
    else LP.toast(res?.message || 'Upload failed', 'error');
  }

  let selectedUploadFiles = [];

  function showUploadModal() {
    selectedUploadFiles = [];
    document.getElementById('modalUploadFilesList').innerHTML = '';
    document.getElementById('btnStartUpload').disabled = true;
    document.getElementById('modalFileInput').value = '';
    
    const modalEl = document.getElementById('uploadModal');
    const uModal = new bootstrap.Modal(modalEl);
    uModal.show();

    // Hook drag-drop events specifically for the modal zone
    const zone = document.getElementById('modalDragZone');
    if (zone) {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.style.borderColor = 'var(--accent-primary)';
        zone.style.background = 'rgba(59,130,246,0.1)';
      });
      zone.addEventListener('dragleave', () => {
        zone.style.borderColor = 'rgba(255,255,255,0.15)';
        zone.style.background = 'rgba(0,0,0,0.15)';
      });
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.style.borderColor = 'rgba(255,255,255,0.15)';
        zone.style.background = 'rgba(0,0,0,0.15)';
        if (e.dataTransfer.files.length) {
          handleSelectedUploads(e.dataTransfer.files);
        }
      });
    }
  }

  function handleSelectedUploads(files) {
    if (!files || files.length === 0) return;
    for (const f of files) {
      // Avoid duplication
      if (!selectedUploadFiles.some(existing => existing.name === f.name && existing.size === f.size)) {
        selectedUploadFiles.push(f);
      }
    }
    renderSelectedUploadsQueue();
  }

  function renderSelectedUploadsQueue() {
    const list = document.getElementById('modalUploadFilesList');
    const btn = document.getElementById('btnStartUpload');
    if (!list) return;

    if (selectedUploadFiles.length === 0) {
      list.innerHTML = '';
      if (btn) btn.disabled = true;
      return;
    }

    if (btn) btn.disabled = false;

    list.innerHTML = selectedUploadFiles.map((f, index) => `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 8px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center;">
        <div style="display:flex; flex-direction:column; overflow:hidden; max-width: 80%;">
          <span class="text-white text-truncate" style="font-size: 12.5px; font-weight: 500;">${escHtml(f.name)}</span>
          <span style="font-size: 10px; color: var(--text-muted);">${LP.formatBytes(f.size)}</span>
        </div>
        <button type="button" class="btn-lp btn-lp-ghost btn-lp-sm" onclick="LP.call('FMPage.removeSelectedUpload', '${LP.encJsArg(index)}')" style="width:28px; height:28px; padding:0; display:flex; align-items:center; justify-content:center; border-radius: 6px; color:#ef4444;" title="Remove">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `).join('');
  }

  function removeSelectedUpload(index) {
    selectedUploadFiles.splice(index, 1);
    renderSelectedUploadsQueue();
  }

  async function startSelectedUploads() {
    if (selectedUploadFiles.length === 0) return;
    const btn = document.getElementById('btnStartUpload');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Uploading...';
    }

    try {
      await upload(selectedUploadFiles);
      bootstrap.Modal.getInstance(document.getElementById('uploadModal'))?.hide();
    } catch (e) {
      LP.toast('Upload failed: ' + e.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-upload me-1"></i> Start Upload';
      }
    }
  }

  async function downloadSelected() {
    if (!selectedItem) return;
    const url = await _getDownloadUrl(selectedItem.path);
    window.open(url, '_blank');
  }

  async function zipSelected() {
    if (!selectedItem) return;
    const output = currentPath + '/' + selectedItem.name + '.zip';
    const res = await LP.post('/filemanager/zip', { path: selectedItem.path, output });
    if (res?.success) { LP.toast('Zipped: ' + output, 'success'); refresh(); }
    else LP.toast(res?.message || 'Zip failed', 'error');
  }

  function toggleView() {
    viewMode = viewMode === 'grid' ? 'list' : 'grid';
    localStorage.setItem('lp_fm_view', viewMode);
    const btn = document.getElementById('toggleViewBtn');
    if (btn) btn.innerHTML = viewMode === 'grid' ? '<i class="bi bi-grid"></i>' : '<i class="bi bi-list-ul"></i>';
    refresh();
  }

  function refresh() { navigate(currentPath); }

  function goUp() {
    const parts = currentPath.split('/').filter(Boolean);
    if (!parts.length) return;
    parts.pop();
    navigate('/' + parts.join('/') || '/');
  }

  // ── Drag & Drop ───────────────────────────────────
  function initDragDrop() {
    const overlay = document.getElementById('dropOverlay');
    const container = document.querySelector('.lp-card-body'); // use parent container for drag

    if (!container) return; // guard: filemanager not on page

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (overlay) overlay.classList.add('visible');
    });
    container.addEventListener('dragleave', () => {
      if (overlay) overlay.classList.remove('visible');
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      if (overlay) overlay.classList.remove('visible');
      if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
    });
  }

  // ── Download Token Cache ─────────────────────────
  let _downloadTokenCache = {};

  async function _getDownloadUrl(path) {
    // Check cache first (tokens are valid for 60s)
    if (_downloadTokenCache[path] && _downloadTokenCache[path].expires > Date.now()) {
      return _downloadTokenCache[path].url;
    }
    try {
      const res = await LP.post('/filemanager/generate-download-token', { path });
      if (res?.success && res.data?.url) {
        _downloadTokenCache[path] = {
          url: res.data.url,
          expires: Date.now() + 55000, // slightly under 60s to be safe
        };
        return res.data.url;
      }
    } catch {}
    // Fallback: use token directly in URL (legacy)
    return `/api/filemanager/download?path=${encodeURIComponent(path)}&token=${LP.state.accessToken}`;
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Public ────────────────────────────────────────
  return {
    async init() {
      await LP.init();
      if (!LP.state.accessToken) return;
      initDragDrop();
      initCodeMirror();
      initSplitDivider();
      applyEditorTheme();
      navigate('/');
    },

    navigate,
    refresh,
    goUp,
    toggleView,
    selectItem,
    openItem,
    renameSelected,
    deleteSelected,
    copySelected,
    moveSelected,
    createFile,
    createFolder,
    mkdir,
    openTerminal,
    upload,
    showUploadModal,
    handleSelectedUploads,
    removeSelectedUpload,
    startSelectedUploads,
    downloadSelected,
    zipSelected,
    showContextMenu,
    saveFile: _saveFile,
    _saveFile,
    updateBulkBar,
    toggleSelectAll,
    bulkCompress,
    bulkDownload,
    bulkChmod,
    bulkDelete,

    // Split view / editor
    openSplitView,
    switchTab,
    closeTab,
    openTreeFile,
    goTreeUp,
    refreshTree,
    saveSplitEditor,
    closeSplitView,
    filterTree,
    clearTreeFilter,
    toggleEditorTheme,
  };
})();

document.addEventListener('DOMContentLoaded', () => FMPage.init());
window.FMPage = FMPage;
window.FM = FMPage;
window.FileManager = FMPage;
