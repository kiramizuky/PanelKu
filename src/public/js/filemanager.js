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
        onclick="FMPage.selectItem(this)"
        ondblclick="FMPage.openItem(this)"
        oncontextmenu="FMPage.showContextMenu(event, this)"
        title="${escHtml(item.path)}">
        <div class="fm-item-icon">${getIcon(item)}</div>
        <div class="fm-item-name">${escHtml(item.name)}</div>
        <div class="fm-item-permissions font-mono">${item.permissions || '-'}</div>
        <div class="fm-item-owner">${item.owner || '-'}</div>
        <div class="fm-item-size">${item.type === 'dir' ? 'Folder' : LP.formatBytes(item.size)}</div>
      </div>
    `).join('');

    grid.innerHTML = html;
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

  function selectItem(el) {
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

  // ── Actions ───────────────────────────────────────
  async function openItem(el = null) {
    const item = el ? {
      path: el.dataset.path,
      type: el.dataset.type,
    } : selectedItem;

    if (!item) return;

    if (item.type === 'dir') {
      navigate(item.path);
    } else {
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
          <div class="modal-content" style="background:#0b0f19; border:1px solid var(--glass-border); color:#fff;">
            <div class="modal-header" style="border-bottom:1px solid var(--glass-border); padding: 12px 20px;">
              <h6 class="modal-title font-mono" style="font-size:12px; color:var(--text-secondary);"><i class="bi bi-file-code-fill me-2 text-primary"></i>${escHtml(path)}</h6>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" style="padding:0; display:flex; position:relative; overflow:hidden;">
              <!-- Gutter Line Numbers -->
              <div id="${id}_gutter" style="width:48px; background:#070a13; border-right:1px solid rgba(255,255,255,0.05); color:rgba(255,255,255,0.25); font-family:'JetBrains Mono',monospace; font-size:12.5px; padding:16px 8px 16px 0; text-align:right; select:none; user-select:none; overflow:hidden; line-height:1.6; box-sizing:border-box;">
                <div>1</div>
              </div>
              <!-- Text Area -->
              <textarea id="${id}_ta" style="flex:1; height:500px; background:#0a0e1a; color:#e2e8f0; border:none; padding:16px; font-family:'JetBrains Mono',monospace; font-size:12.5px; resize:none; outline:none; line-height:1.6; overflow-y:auto; box-sizing:border-box; white-space:pre; word-wrap:normal;" wrap="off">${escHtml(content)}</textarea>
            </div>
            <div class="modal-footer" style="border-top:1px solid var(--glass-border); padding: 12px 20px;">
              <div class="me-auto font-mono" id="${id}_stats" style="font-size:11px; color:var(--text-muted);">Lines: 1 | Length: 0</div>
              <button class="btn-lp btn-lp-ghost btn-lp-sm" data-bs-dismiss="modal">Cancel</button>
              <button class="btn-lp btn-lp-primary btn-lp-sm" onclick="FMPage._saveFile('${escHtml(path)}', '${id}')"><i class="bi bi-floppy me-1"></i> Save File</button>
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

      ta.addEventListener('input', updateGutter);
      
      // Initial Gutter generation
      updateGutter();
    }, 200);

    document.getElementById(id).addEventListener('hidden.bs.modal', () => modal.remove());
  }

  async function _saveFile(path, modalId) {
    const content = document.getElementById(`${modalId}_ta`).value;
    const res = await LP.post('/filemanager/write', { path, content });
    if (res?.success) {
      LP.toast('File saved successfully', 'success');
      bootstrap.Modal.getInstance(document.getElementById(modalId))?.hide();
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
    downloadSelected,
    zipSelected,
    showContextMenu,
    _saveFile,
  };
})();

document.addEventListener('DOMContentLoaded', () => FMPage.init());
window.FMPage = FMPage;
