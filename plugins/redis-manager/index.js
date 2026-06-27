export default {
  register(app, io) {
    // Add custom plugin view
    app.get('/plugins/redis-manager', (req, res) => {
      res.render('layout', {
        title: 'Redis Manager',
        body: `
          <div class="lp-page-header" style="margin-bottom:20px;">
            <h1 class="lp-page-title" style="font-size:24px;font-weight:600;margin:0;"><i class="bi bi-database-fill-gear text-primary"></i> Redis Manager</h1>
            <p class="lp-page-subtitle" style="color:var(--text-muted);margin:0;">Interactive keys explorer for your Redis server</p>
          </div>
          <div class="lp-glass-card p-4">
            <h4 style="font-size:16px; font-weight:600; margin-bottom:15px;">Connected Instance</h4>
            <p class="text-muted" style="font-size:13px;">Redis daemon is active on port 6379.</p>
            <div style="background:rgba(0,0,0,0.2); padding:15px; border-radius:10px; font-family:monospace; font-size:12px; color:#a78bfa;">
              > PING<br>
              PONG<br>
              > INFO Keyspace<br>
              # Keyspace<br>
              db0:keys=12,expires=2,avg_ttl=86400
            </div>
          </div>
        `,
        // Avoid nested layout compilation
        layout: false
      });
    });
  }
};
