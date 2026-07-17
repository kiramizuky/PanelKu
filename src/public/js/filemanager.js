/**
 * Linux Panel — filemanager.js
 * Full-featured file manager with grid/list view, context menu, upload, etc.
 */

const FMPage = (() => {
  let currentPath = '/';
  let selectedItem = null;
  let viewMode = localStorage.getItem('lp_fm_view') || 'grid';
  let clipboard = null;

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
    const output = currentPath + '/archive-' + Date.now() + '.zip';
    
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
    
    // Download files concurrently using window trigger
    paths.forEach(p => {
      const frame = document.createElement('iframe');
      frame.src = `/api/filemanager/download?path=${encodeURIComponent(p)}&token=${LP.state.accessToken}`;
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
      
      // 1. Image preview modal
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) {
        const id = 'img_view_' + Date.now();
        const modal = document.createElement('div');
        modal.innerHTML = `
          <div class="modal fade" id="${id}" tabindex="-1">
            <div class="modal-dialog modal-lg modal-dialog-centered">
              <div class="modal-content lp-glass-card" style="border:1px solid var(--glass-border); background:rgba(10,12,20,0.95); border-radius:12px; overflow:hidden;">
                <div class="modal-header" style="border-bottom:1px solid var(--glass-border); padding: 12px 20px;">
                  <h6 class="modal-title font-mono text-white" style="font-size:12px;"><i class="bi bi-image me-2 text-primary"></i>Preview: ${escHtml(item.name)}</h6>
                  <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body text-center" style="padding:20px; background:#04060b;">
                  <img src="/api/filemanager/download?path=${encodeURIComponent(item.path)}&token=${LP.state.accessToken}" style="max-width:100%; max-height:70vh; object-fit:contain; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                </div>
              </div>
            </div>
          </div>`;
        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(document.getElementById(id));
        bsModal.show();
        document.getElementById(id).addEventListener('hidden.bs.modal', () => modal.remove());
        return;
      }

      // 2. PDF preview modal
      if (ext === 'pdf') {
        const id = 'pdf_view_' + Date.now();
        const modal = document.createElement('div');
        modal.innerHTML = `
          <div class="modal fade" id="${id}" tabindex="-1">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
              <div class="modal-content" style="border:1px solid var(--glass-border); background:rgba(10,12,20,0.95); border-radius:12px; overflow:hidden; height:90vh;">
                <div class="modal-header" style="border-bottom:1px solid var(--glass-border); padding: 12px 20px;">
                  <h6 class="modal-title font-mono text-white" style="font-size:12px;"><i class="bi bi-file-pdf me-2 text-danger"></i>PDF Reader: ${escHtml(item.name)}</h6>
                  <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body" style="padding:0; height:calc(100% - 50px);">
                  <iframe src="/api/filemanager/download?path=${encodeURIComponent(item.path)}&token=${LP.state.accessToken}" style="width:100%; height:100%; border:none;"></iframe>
                </div>
              </div>
            </div>
          </div>`;
        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(document.getElementById(id));
        bsModal.show();
        document.getElementById(id).addEventListener('hidden.bs.modal', () => modal.remove());
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

  async function openFileEditor(path) {
    const res = await LP.get(`/filemanager/read?path=${encodeURIComponent(path)}`);
    if (!res?.success) { LP.toast('Cannot read file: ' + res?.message, 'error'); return; }

    const content = res.data.content;
    const modal = document.createElement('div');
    const id = 'file_editor_' + Date.now();
    modal.innerHTML = `
      <div class="modal fade" id="${id}" tabindex="-1">
        <div class="modal-dialog modal-xl modal-dialog-scrollable">
          <div class="modal-content" style="background:#0b0f19; border:1px solid var(--glass-border); color:#fff; border-radius:12px; overflow:hidden;">
            <div class="modal-header" style="border-bottom:1px solid var(--glass-border); padding: 12px 20px;">
              <h6 class="modal-title font-mono" style="font-size:12px; color:var(--text-secondary);"><i class="bi bi-file-code-fill me-2 text-primary"></i>${escHtml(path)}</h6>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" style="padding:0; display:flex; position:relative; overflow:hidden; background:#070a13; height:550px;">
              <!-- Gutter Line Numbers -->
              <div id="${id}_gutter" style="width:54px; background:#04060c; border-right:1px solid rgba(255,255,255,0.06); color:rgba(255,255,255,0.2); font-family:'JetBrains Mono',monospace; font-size:12.5px; padding:16px 12px 16px 0; text-align:right; select:none; user-select:none; overflow:hidden; line-height:1.6; box-sizing:border-box;">
                <div>1</div>
              </div>
              <!-- Text Area -->
              <textarea id="${id}_ta" style="flex:1; height:100%; background:transparent; color:#e2e8f0; border:none; padding:16px; font-family:'JetBrains Mono',monospace; font-size:12.5px; resize:none; outline:none; line-height:1.6; overflow-y:auto; overflow-x:auto; box-sizing:border-box; white-space:pre; word-wrap:normal;" wrap="off" spellcheck="false">${escHtml(content)}</textarea>
            </div>
            <div class="modal-footer" style="border-top:1px solid var(--glass-border); padding: 12px 20px;">
              <div class="me-auto font-mono" id="${id}_stats" style="font-size:11px; color:var(--text-muted);">Lines: 1 | Length: 0</div>
              <small class="text-muted me-3 d-none d-sm-inline" style="font-size:11px;"><kbd style="background:rgba(255,255,255,0.08); color:var(--text-muted); font-size:10px; padding:2px 5px; border-radius:3px;">Ctrl + S</kbd> to Quick Save</small>
              <button class="btn-lp btn-lp-ghost btn-lp-sm" data-bs-dismiss="modal">Cancel</button>
              <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="LP.call('FMPage._saveFile', '${LP.encJsArg(path)}', '${LP.encJsArg(id)}', false)"><i class="bi bi-floppy me-1"></i> Save</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const bsModal = new bootstrap.Modal(document.getElementById(id));
    bsModal.show();

    // Hook up Gutter Sync & Line stats
    setTimeout(() => {
      const ta = document.getElementById(`${id}_ta`);
      const gutter = document.getElementById(`${id}_gutter`);
      const stats = document.getElementById(`${id}_stats`);

      function updateGutter() {
        const value = ta.value;
        const lineCount = value.split('\n').length;
        let gutterHtml = '';
        for (let i = 1; i <= lineCount; i++) {
          gutterHtml += `<div>${i}</div>`;
        }
        gutter.innerHTML = gutterHtml;
        stats.textContent = `Lines: ${lineCount} | Length: ${value.length}`;
      }

      // Synchronize Scroll
      ta.addEventListener('scroll', () => {
        gutter.scrollTop = ta.scrollTop;
      });

      // Handle TAB key indentation
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = ta.selectionStart;
          const end = ta.selectionEnd;
          const val = ta.value;
          ta.value = val.substring(0, start) + '  ' + val.substring(end);
          ta.selectionStart = ta.selectionEnd = start + 2;
          updateGutter();
        }

        // Handle Ctrl + S shortcut
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          FMPage._saveFile(path, id, true);
        }
      });

      ta.addEventListener('input', updateGutter);
      
      // Initial Gutter generation
      updateGutter();
    }, 200);

    document.getElementById(id).addEventListener('hidden.bs.modal', () => modal.remove());
  }

  async function _saveFile(path, modalId, keepOpen = false) {
    const content = document.getElementById(`${modalId}_ta`).value;
    const res = await LP.post('/filemanager/write', { path, content });
    if (res?.success) {
      LP.toast('File saved successfully', 'success');
      if (!keepOpen) {
        bootstrap.Modal.getInstance(document.getElementById(modalId))?.hide();
      }
    } else {
      LP.toast('Failed to save: ' + res?.message, 'error');
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

    const res = await LP.del('/filemanager/delete', {
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
    clipboard = { ...selectedItem, action: 'copy' };
    LP.toast(`${selectedItem.name} copied to clipboard`, 'info');
  }

  function moveSelected() {
    if (!selectedItem) return;
    clipboard = { ...selectedItem, action: 'move' };
    LP.toast(`${selectedItem.name} cut to clipboard`, 'info');
  }

  async function mkdir() {
    const name = prompt('New folder name:');
    if (!name) return;
    const res = await LP.post('/filemanager/mkdir', { path: currentPath + '/' + name });
    if (res?.success) { LP.toast('Folder created', 'success'); refresh(); }
    else LP.toast(res?.message || 'Failed', 'error');
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
    window.open(`/api/filemanager/download?path=${encodeURIComponent(selectedItem.path)}&token=${LP.state.accessToken}`, '_blank');
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

  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Public ────────────────────────────────────────
  return {
    async init() {
      await LP.init();
      if (!LP.state.accessToken) return;
      initDragDrop();
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
    mkdir,
    upload,
    showUploadModal,
    handleSelectedUploads,
    removeSelectedUpload,
    startSelectedUploads,
    downloadSelected,
    zipSelected,
    showContextMenu,
    _saveFile,
    updateBulkBar,
    toggleSelectAll,
    bulkCompress,
    bulkDownload,
    bulkChmod,
    bulkDelete,
  };
})();

document.addEventListener('DOMContentLoaded', () => FMPage.init());
window.FMPage = FMPage;
