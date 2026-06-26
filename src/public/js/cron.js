const CronPage = (() => {
  let modal;

  async function loadData() {
    try {
      const res = await LP.get('/cron');
      if (res?.success) {
        renderTasks(res.data || []);
      }
    } catch (e) {
      console.error(e);
      LP.toast('Failed to load cron tasks', 'error');
    }
  }

  function renderTasks(tasks) {
    const tbody = document.getElementById('cronTableBody');
    LP.paginate(tasks, 10, 'cronTableBody', 'cronPagination', t => `
      <tr>
        <td class="font-mono"><strong>${t.name}</strong></td>
        <td class="font-mono">${t.schedule}</td>
        <td class="font-mono" style="font-size:12px;color:var(--text-secondary)">${t.command}</td>
        <td>${t.lastRun ? new Date(t.lastRun).toLocaleString() : 'Never'}</td>
        <td>
          <span class="lp-badge ${t.status === 'active' ? 'lp-badge-success' : 'lp-badge-warning'}">
            <span class="lp-badge-dot"></span> ${t.status}
          </span>
        </td>
        <td style="text-align:right">
          <button class="btn-lp btn-lp-ghost btn-lp-sm" onclick="CronPage.toggleTask('${t.id}')"><i class="bi ${t.status === 'active' ? 'bi-pause-fill text-warning' : 'bi-play-fill text-success'}"></i></button>
          <button class="btn-lp btn-lp-ghost btn-lp-sm text-danger" onclick="CronPage.deleteTask('${t.id}')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `, 'No scheduled tasks found', 6);
  }

  function showCreateModal() {
    if (!modal) modal = new bootstrap.Modal(document.getElementById('createCronModal'));
    document.getElementById('createCronForm').reset();
    modal.show();
  }

  async function createTask(e) {
    e.preventDefault();
    const name = document.getElementById('cronName').value;
    const schedule = document.getElementById('cronSchedule').value;
    const command = document.getElementById('cronCommand').value;
    
    try {
      const res = await LP.post('/cron', { name, schedule, command });
      if (res?.success) {
        LP.toast('Cron task added successfully', 'success');
        modal.hide();
        loadData();
      } else {
        LP.toast(res?.message || 'Failed to add cron task', 'error');
      }
    } catch (err) {
      LP.toast('Error adding cron task', 'error');
    }
  }

  async function toggleTask(id) {
    try {
      const res = await LP.patch(`/cron/${id}/toggle`);
      if (res?.success) {
        LP.toast('Task toggled', 'success');
        loadData();
      } else {
        LP.toast(res?.message || 'Failed to toggle task', 'error');
      }
    } catch (e) {
      LP.toast('Error toggling task', 'error');
    }
  }

  async function deleteTask(id) {
    if (!(await LP.confirm(`Are you sure you want to delete this task?`, 'Delete Task'))) return;
    try {
      const res = await LP.delete(`/cron/${id}`);
      if (res?.success) {
        LP.toast('Task deleted', 'success');
        loadData();
      } else {
        LP.toast(res?.message || 'Failed to delete task', 'error');
      }
    } catch (e) {
      LP.toast('Error deleting task', 'error');
    }
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    loadData();
  });

  return {
    loadData,
    showCreateModal,
    createTask,
    toggleTask,
    deleteTask
  };
})();
