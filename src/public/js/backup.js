const BackupPage = (() => {
  let modal;
  let restoreModal;

  async function loadData() {
    try {
      const res = await LP.get('/backup');
      if (res?.success) {
        renderBackups(res.data || []);
      }
    } catch (e) {
      console.error(e);
      LP.toast('Failed to load backups', 'error');
    }
  }

  function renderBackups(backups) {
    const tbody = document.getElementById('backupTableBody');
    LP.paginate(backups, 10, 'backupTableBody', 'backupPagination', b => `
      <tr>
        <td class="font-mono"><strong>${LP.escHtml(b.name)}</strong></td>
        <td>${LP.formatBytes(b.size)}</td>
        <td>${new Date(b.created).toLocaleString()}</td>
        <td style="text-align:right">
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-primary" onclick="LP.call('BackupPage.showRestoreModal', '${LP.encJsArg(b.name)}')" title="Restore Backup"><i class="bi bi-clock-history"></i></button>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="LP.call('BackupPage.deleteBackup', '${LP.encJsArg(b.name)}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `, 'No backups found', 4);
  }

  function showCreateModal() {
    if (!modal) modal = new bootstrap.Modal(document.getElementById('createBackupModal'));
    document.getElementById('createBackupForm').reset();
    document.getElementById('btnCreateBackup').disabled = false;
    document.getElementById('btnCreateBackup').innerHTML = 'Create Backup';
    modal.show();
  }

  async function createBackup(e) {
    e.preventDefault();
    const type = document.getElementById('backupType').value;
    const target = document.getElementById('backupTarget').value;
    
    const btn = document.getElementById('btnCreateBackup');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Creating...';
    
    try {
      const res = await LP.post('/backup', { type, target });
      if (res?.success) {
        LP.toast('Backup created successfully', 'success');
        modal.hide();
        loadData();
      } else {
        LP.toast(res?.message || 'Failed to create backup', 'error');
        btn.disabled = false;
        btn.innerHTML = 'Create Backup';
      }
    } catch (err) {
      LP.toast('Error creating backup', 'error');
      btn.disabled = false;
      btn.innerHTML = 'Create Backup';
    }
  }

  async function deleteBackup(filename) {
    if (!(await LP.confirm(`Are you sure you want to delete the backup "${filename}"? This action cannot be undone.`, 'Delete Backup'))) return;
    try {
      const res = await LP.delete('/backup', { filename });
      if (res?.success) {
        LP.toast('Backup deleted', 'success');
        loadData();
      } else {
        LP.toast(res?.message || 'Failed to delete backup', 'error');
      }
    } catch (e) {
      LP.toast('Error deleting backup', 'error');
    }
  }

  function showRestoreModal(filename) {
    if (!restoreModal) restoreModal = new bootstrap.Modal(document.getElementById('restoreBackupModal'));
    document.getElementById('restoreBackupForm').reset();
    document.getElementById('restoreFilename').value = filename;
    document.getElementById('btnRestoreBackup').disabled = false;
    document.getElementById('btnRestoreBackup').innerHTML = 'Restore Backup';
    restoreModal.show();
  }

  async function restoreBackup(e) {
    e.preventDefault();
    const filename = document.getElementById('restoreFilename').value;
    const target = document.getElementById('restoreTarget').value;
    
    if (!(await LP.confirm(`WARNING: Restoring backup ${filename} to ${target} may OVERWRITE existing data. Continue?`, 'Restore Backup'))) return;

    const btn = document.getElementById('btnRestoreBackup');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Restoring...';
    
    try {
      const res = await LP.post('/backup/restore', { filename, target });
      if (res?.success) {
        LP.toast('Backup restored successfully', 'success');
        restoreModal.hide();
      } else {
        LP.toast(res?.message || 'Failed to restore backup', 'error');
        btn.disabled = false;
        btn.innerHTML = 'Restore Backup';
      }
    } catch (err) {
      LP.toast('Error restoring backup', 'error');
      btn.disabled = false;
      btn.innerHTML = 'Restore Backup';
    }
  }

  let s3Modal;

  async function showS3Modal() {
    if (!s3Modal) s3Modal = new bootstrap.Modal(document.getElementById('s3ConfigModal'));
    document.getElementById('s3ConfigForm').reset();
    
    try {
      const res = await LP.get('/backup/s3');
      if (res?.success && res.data) {
        const config = res.data;
        document.getElementById('s3Enabled').checked = config.enabled || false;
        document.getElementById('s3Endpoint').value = config.endpoint || '';
        document.getElementById('s3Region').value = config.region || 'us-east-1';
        document.getElementById('s3Bucket').value = config.bucket || '';
        document.getElementById('s3AccessKey').value = config.accessKey || '';
        document.getElementById('s3SecretKey').value = config.secretKey || '';
      }
    } catch (err) {
      console.error(err);
    }
    s3Modal.show();
  }

  async function saveS3Config(e) {
    e.preventDefault();
    const enabled = document.getElementById('s3Enabled').checked;
    const endpoint = document.getElementById('s3Endpoint').value;
    const region = document.getElementById('s3Region').value;
    const bucket = document.getElementById('s3Bucket').value;
    const accessKey = document.getElementById('s3AccessKey').value;
    const secretKey = document.getElementById('s3SecretKey').value;

    try {
      const res = await LP.post('/backup/s3', { enabled, endpoint, region, bucket, accessKey, secretKey });
      if (res?.success) {
        LP.toast('S3 Backup configuration saved successfully', 'success');
        s3Modal.hide();
      } else {
        LP.toast(res?.message || 'Failed to save S3 configuration', 'error');
      }
    } catch (err) {
      LP.toast('Connection error', 'error');
    }
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    loadData();
  });

  return {
    loadData,
    showCreateModal,
    createBackup,
    deleteBackup,
    showRestoreModal,
    restoreBackup,
    showS3Modal,
    saveS3Config
  };
})();
