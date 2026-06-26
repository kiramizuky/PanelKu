const CronPage = (() => {
  let modal;

  function parseCronToText(cronStr) {
    if (!cronStr) return '-';
    const parts = cronStr.trim().split(/\s+/);
    if (parts.length !== 5) return cronStr;
    const [min, hour, day, month, dow] = parts;
    
    if (min === '0' && hour.startsWith('*/') && day === '*' && month === '*' && dow === '*') {
      return `Setiap ${hour.substring(2)} Jam`;
    }
    if (!min.includes('*') && !hour.includes('*') && day === '*' && month === '*' && dow === '*') {
      return `Setiap Hari pukul ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (!min.includes('*') && !hour.includes('*') && day.startsWith('*/') && month === '*' && dow === '*') {
      return `Setiap ${day.substring(2)} Hari pukul ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (!min.includes('*') && !hour.includes('*') && day === '*' && month === '*' && dow !== '*') {
      const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
      return `Setiap Hari ${days[dow] || dow} pukul ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (!min.includes('*') && !hour.includes('*') && day !== '*' && month === '*' && dow === '*') {
      return `Setiap Tanggal ${day} pukul ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (!min.includes('*') && !hour.includes('*') && day !== '*' && month !== '*' && dow === '*') {
      const months = ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
      return `Setiap ${day} ${months[month] || month} pukul ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    return cronStr;
  }

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
        <td class="font-mono" title="${t.schedule}">${CronPage.parseCronToText ? CronPage.parseCronToText(t.schedule) : parseCronToText(t.schedule)}</td>
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
    toggleCronType();
    modal.show();
  }

  function toggleCronType() {
    const type = document.getElementById('cronType').value;
    document.querySelectorAll('.cron-opt').forEach(el => el.style.display = 'none');
    
    if (type === 'n_jam') {
      document.getElementById('cronNjam').style.display = 'block';
    } else if (type === 'harian') {
      document.getElementById('cronTime').style.display = 'block';
    } else if (type === 'n_hari') {
      document.getElementById('cronNhari').style.display = 'block';
      document.getElementById('cronTime').style.display = 'block';
    } else if (type === 'mingguan') {
      document.getElementById('cronMingguan').style.display = 'block';
      document.getElementById('cronTime').style.display = 'block';
    } else if (type === 'bulanan') {
      document.getElementById('cronTanggal').style.display = 'block';
      document.getElementById('cronTime').style.display = 'block';
    } else if (type === 'tanggal') {
      document.getElementById('cronBulan').style.display = 'block';
      document.getElementById('cronTanggal').style.display = 'block';
      document.getElementById('cronTime').style.display = 'block';
    } else if (type === 'manual') {
      document.getElementById('cronManual').style.display = 'block';
    }
  }

  async function createTask(e) {
    e.preventDefault();
    const name = document.getElementById('cronName').value;
    const type = document.getElementById('cronType').value;
    let schedule = document.getElementById('cronSchedule').value;
    const command = document.getElementById('cronCommand').value;

    if (type !== 'manual') {
      const t = document.getElementById('inpTime').value;
      const [h, m] = t.split(':');
      const hour = parseInt(h, 10);
      const min = parseInt(m, 10);
      
      if (type === 'n_jam') {
        const nJam = document.getElementById('inpNjam').value;
        schedule = \`0 */\${nJam} * * *\`;
      } else if (type === 'harian') {
        schedule = \`\${min} \${hour} * * *\`;
      } else if (type === 'n_hari') {
        const nHari = document.getElementById('inpNhari').value;
        schedule = \`\${min} \${hour} */\${nHari} * *\`;
      } else if (type === 'mingguan') {
        const dow = document.getElementById('inpMingguan').value;
        schedule = \`\${min} \${hour} * * \${dow}\`;
      } else if (type === 'bulanan') {
        const tgl = document.getElementById('inpTanggal').value;
        schedule = \`\${min} \${hour} \${tgl} * *\`;
      } else if (type === 'tanggal') {
        const tgl = document.getElementById('inpTanggal').value;
        const bln = document.getElementById('inpBulan').value;
        schedule = \`\${min} \${hour} \${tgl} \${bln} *\`;
      }
    }
    
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
    deleteTask,
    toggleCronType,
    parseCronToText
  };
})();
