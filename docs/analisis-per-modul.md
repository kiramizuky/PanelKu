# 🧩 Analisis Per-Modul — Panelku v2.0.0

> **Tanggal**: 10 Agustus 2026
> **Cakupan**: 40 modul di `src/modules/` — struktur file, fungsi utama, dan dependensi antar-modul
> **Sumber data**: ekstraksi langsung dari kode (import, ekspor fungsi, metode class, registrasi route)

---

## 1. Ringkasan Eksekutif

Panelku menerapkan **arsitektur modular 3-lapis** yang sangat konsisten: setiap modul = `controller` (handler HTTP) + `routes` (registrasi + auth/RBAC) + `service` (logika bisnis/eksekusi sistem), dilengkapi view EJS dan JS singleton frontend (`window.X = X`).

**Temuan utama soal dependensi:**

- ✅ **Isolasi antar-modul sangat baik** — hanya **6 dependensi lintas-modul** di seluruh `src/modules/` (tabel §3.1). Tidak ada siklus antar-modul selain satu hubungan helper↔modul yang perlu dicatat (§3.3).
- ✅ **Ketergantungan utama bukan antar-modul, melainkan ke lapisan shared**: `middleware/` (80 import), `config/` (75), `helpers/` (48), `models/` (19), `repositories/` (14), `core/` (9).
- ⚠️ **Modul `system` adalah hub bersama** — `password-policy.service`, `package-manager`, dan `ssh.service` dipakai ulang oleh modul lain, helper, dan plugin. Ini adalah titik dengan kopling tertinggi.
- ⚠️ **Plugin sangat bergantung pada `docker.service` + `firewall.service`** (8 plugin memakai keduanya) — perubahan API kedua service ini berdampak luas.
- 📊 **Total ±463 route** terdaftar; 5 modul terbesar: `system` (49), `backup` (23), `auth` (21), `python` (20), `lvm-manager`/`caddy` (20).

---

## 2. Konvensi Arsitektur Modul

```
src/modules/<nama>/
  ├── <nama>.controller.js    # Handler HTTP; memakai helper successResponse/errorResponse
  ├── <nama>.routes.js        # Router + requireAuth + requirePermission('resource:action')
  └── <nama>.service.js       # Logika bisnis; singleton `export default new X()`
src/views/<nama>/index.ejs    # Halaman (49 view total)
src/public/js/<nama>.js       # Singleton frontend (wajib window.X = X, dipaksa ESLint)
```

Pola umum yang dipakai hampir semua modul:

- **Routes**: `router.use(requireAuth)` → endpoint dilindungi `requirePermission('resource:action')`.
- **Controller**: tipis — delegasi ke service, bungkus hasil dengan helper `response.js`.
- **Service**: singleton; untuk operasi sistem memakai `child_process` (sebagian lewat helper `system.js`/`execFile`, sebagian langsung `exec`).
- **Penyimpanan**: models (Mongoose-style di atas SQLite) untuk data panel; `Setting` untuk konfigurasi; perintah sistem untuk target server.

---

## 3. Grafik Dependensi

### 3.1 Dependensi lintas-modul (module → module) di `src/modules/`

| Modul konsumen | Modul yang dipakai | Fungsi yang dipakai |
|---|---|---|
| `users` | `system/password-policy.service` | `validatePassword`, `getPolicy` (enforce saat create/change password) |
| `auth` | `system/password-policy.service` | `validatePassword` (saat login/ubah password) |
| `docker` | `system/package-manager` | `getInstallCommand` (install docker-ce) |
| `monitor` | `dashboard/dashboard.service` | `getMetrics` (realtime via Socket.IO) |
| `agent` | `dashboard/dashboard.service` | `getMetrics` (report ke master cluster) |
| `autoheal` | `alerts/alerts.service` | `sendTelegram/sendEmail/...` (notifikasi insiden) |
| `ai` | `system/system.service` | eksekusi perintah AI copilot |
| `backup` | `plugins/shared/rclone-helper` | helper rclone lintas plugin & modul |

> Hanya **8 pasang** dependensi lintas-modul dari 40 modul — kopling antar-modul tergolong sangat rendah (target desain "semua modul independent" tercapai).

### 3.2 Konsumen service modul di luar `src/modules/`

| Konsumen | Modul service yang dipakai |
|---|---|
| `src/jobs/monitor.job.js` | `monitor.service` + `alerts.service` |
| `src/jobs/health.job.js` | `autoheal.service` |
| `src/jobs/password-expiry-reminder.job.js` | `system/password-policy.service` |
| `src/websocket/docker.ws.js` | `docker.service` (+ `PermissionManager`) |
| `src/websocket/monitor.ws.js` | `monitor.service` |
| `src/websocket/agent-terminal.ws.js` | `terminal.service` |
| `src/helpers/security-advisor.js` | `system/ssh.service` (⚠️ helper → modul) |

### 3.3 Dependensi plugin → modul inti

| Plugin (8 dari 17) | Modul inti yang dipakai |
|---|---|
| `db-admin-manager`, `home-assistant-manager`, `media-cloud-manager`, `minio-manager`, `nextcloud-manager`, `openclaw-manager`, `uptime-kuma-manager`, `adguard-manager` | `docker.service` (deploy/start/stop) + `firewall.service` (buka port) |
| `php-manager`, `rclone-manager` | `system/package-manager` (install dependency host) |
| `backup` (modul) | `plugins/shared/rclone-helper` (sebaliknya: modul → plugin shared) |

### 3.4 Lapisan shared (frekuensi import di `src/modules/`)

| Lapisan | Jumlah import | Komponen utama |
|---|---:|---|
| `middleware/` | 80 | `auth` (requireAuth), `rbac` (requirePermission), `rateLimiter` |
| `config/` | 75 | `logger`, `app`, `constants` |
| `helpers/` | 48 | `response`, `crypto`, `system`, `validate` |
| `models/` | 19 | `User`, `Setting`, `Website`, `WafRule`, `Notification`, `MonitorHistory`, `AlertConfig`, `WhatsappSession` |
| `repositories/` | 14 | `user.repository`, `role.repository`, `session.repository`, `audit.repository` |
| `core/` | 9 | `EventBus`, `PermissionManager`, `Scheduler`, `sqlite`, `plugin-loader` |

### 3.5 Dependensi eksternal kunci per modul

| Modul | Library eksternal |
|---|---|
| `database` | `mysql2/promise`, `pg` |
| `docker` | `dockerode` |
| `redis` | `ioredis` |
| `mongodb` | (driver mongo via command/`mongosh`) |
| `filemanager` | `multer`, `unzipper`, `archiver` |
| `terminal` | `node-pty`, `uuid` |
| `cron` | `node-cron` |
| `whatsapp` | `@whiskeysockets/baileys`, `@hapi/boom`, `axios`, `pino`, `qrcode` |
| `alerts` | `nodemailer` |
| `api-docs` | `swagger-ui-express` |
| `auth` | `jsonwebtoken`, `speakeasy`, `qrcode`, `ldapjs` |
| `dashboard`, `monitor`, `analytics` | `systeminformation` |

---

## 4. Rekap 40 Modul (mount, route, ukuran)

| Modul | Mount `/api/...` | Routes | File service | Metode service |
|---|---|---:|---|---:|
| system | `/system` | 49 | system.service.js | 33 |
| backup | `/backup` | 23 | backup.service.js | 30 |
| auth | `/auth` | 21 | auth.service.js | 14 |
| python | `/python` | 20 | python.service.js | 19 |
| lvm-manager | `/lvm-manager` | 20 | lvm-manager.service.js | 20 |
| caddy | `/caddy` | 20 | caddy.service.js | 27 |
| database | `/database` | 19 | database.service.js | 45 |
| mail | `/mail` | 18 | mail.service.js | 18 |
| iot | `/iot` | 17 | iot.service.js | 21 |
| apache | `/apache` | 17 | apache.service.js | 18 |
| nodejs | `/nodejs` | 16 | nodejs.service.js | 15 |
| mongodb | `/mongodb` | 16 | mongodb.service.js | 16 |
| filemanager | `/filemanager` | 16 | filemanager.service.js | 17 |
| updater | `/updater` | 15 | updater.service.js | 25 |
| redis | `/redis` | 15 | redis.service.js | 18 |
| docker | `/docker` | 14 | docker.service.js | 14 |
| dns | `/dns` | 14 | dns.service.js | 20 |
| cdn | `/cdn` | 13 | cdn.service.js | 13 |
| users | `/users` | 12 | users.service.js | 10 |
| power | `/power` | 12 | power.service.js | 12 |
| ai-repair | `/ai-repair` | 10 | ai-repair.service.js | 13 |
| analytics | `/analytics` | 8 | analytics.service.js | 8 |
| websites | `/websites` | 7 | websites.service.js | 8 |
| roles | `/roles` | 7 | roles.service.js | — |
| plugins | `/plugins` | 7 | (via PluginLoader) | — |
| monitor | `/monitor` | 7 | monitor.service.js | 8 |
| whatsapp | `/whatsapp` | 6 | whatsapp.service.js | 7 |
| autoheal | `/autoheal` | 6 | autoheal.service.js | 13 |
| gpu | `/gpu` | 5 | gpu.service.js | 7 |
| cluster | `/cluster` | 5 | cluster.service.js | 6 |
| waf | `/waf` | 4 | waf.service.js | 4 |
| firewall | `/firewall` | 4 | firewall.service.js | 9 |
| cron | `/cron` | 4 | cron.service.js | 7 |
| terminal | `/terminal` | 3 | terminal.service.js | 10 |
| ssl | `/ssl` | 3 | ssl.service.js | 3 |
| alerts | `/alerts` | 3 | alerts.service.js | 8 |
| agent | `/agent` | 3 | (pakai dashboard) | — |
| dashboard | `/dashboard` | 2 | dashboard.service.js | 2 |
| api-docs | `/api-docs` | 1 | api-docs.controller.js | — |
| ai | `/ai` | 1 | (pakai system) | — |

> ⚠️ Catatan: `routes/index.js` belum memuat mount untuk beberapa view (mis. `/cloudflare`, `/n8n`, `/tailscale` di-*handle* oleh `tunnel.controller` & view terpisah), dan `/lvm-manager` punya **duplikasi**: modul `src/modules/lvm-manager` + `plugins/lvm-manager` (komentar `[DEDUP]` di app.js menandakan modul inti yang dipakai; plugin perlu diverifikasi mana yang aktif).

---

## 5. Detail Per-Modul

> Format tiap entri: **Mount** · **Struktur file** · **Fungsi utama** (metode service utama) · **Dependensi** (hanya yang non-standar).

### A. Platform & Identitas

#### 1. `auth` — Autentikasi & Sesi
- **Mount**: `/api/auth` · **Routes**: 21
- **Struktur**: `auth.controller/service` + `ldap.controller/service` + `sso.controller/service`
- **Fungsi utama**: `login`, `completeLogin`, `verifyTwoFactor`, `refreshToken`, `logoutAll`, `logoutSession`, `getSessions`, `setup2FA/enable2FA/disable2FA`, `_generateTokens`, `_generateTempToken` · LDAP: `authenticate`, `findOrCreateUser`, `testConnection` · SSO: `getAuthorizeUrl`, `handleCallback`
- **Dependensi**: `helpers/system`, `system/password-policy.service`, `jsonwebtoken`, `speakeasy`, `qrcode`, `ldapjs`, `user/session/audit repository`

#### 2. `users` — Manajemen User
- **Mount**: `/api/users` · **Routes**: 12
- **Struktur**: `users.controller/service`
- **Fungsi utama**: `list`, `getById`, `create`, `update`, `changePassword`, `delete`, `toggleStatus`, `regenerateApiKey`, `revokeApiKey`, `_enforcePasswordPolicy`
- **Dependensi**: **`system/password-policy.service`** (lintas-modul), `bcryptjs`

#### 3. `roles` — RBAC
- **Mount**: `/api/roles` · **Routes**: 7
- **Struktur**: `roles.controller/service`
- **Fungsi utama**: `list`, `getById`, `create`, `update`, `updatePermissions`, `delete`, `getAvailableResources`
- **Dependensi**: `PermissionManager` (core), `role.repository`

#### 4. `plugins` — Plugin Marketplace/SDK
- **Mount**: `/api/plugins` · **Routes**: 7
- **Struktur**: `plugins.controller` (+ PluginLoader di core)
- **Fungsi utama**: `getPlugins`, `installPlugin`, `updateProxy`, `uninstallPlugin`, `getMarketplace`, `uploadPlugin`, `updatePlugin`
- **Dependensi**: `PluginLoader` (core) — hot-mount & reverse proxy anti-SSRF

#### 5. `agent` — Cluster Agent API
- **Mount**: `/api/agent` · **Routes**: 3
- **Struktur**: `agent.routes` saja (tipis)
- **Fungsi utama**: laporan metrik ke master + WebSocket terminal `agent-terminal.ws`
- **Dependensi**: **`dashboard/dashboard.service`** (lintas-modul); akses via `X-API-Key` + `apiKeyLimiter`

#### 6. `cluster` — Multi-Node Manager
- **Mount**: `/api/cluster` · **Routes**: 5
- **Struktur**: `cluster.controller/service`
- **Fungsi utama**: `getNodes`, `addNode`, `deleteNode`, `pingNode`, `getNodeMetrics`, `pingAllNodes`
- **Dependensi**: tabel `cluster_nodes` (SQLite)

#### 7. `api-docs` — Swagger UI
- **Mount**: `/api/api-docs` · **Routes**: 1
- **Struktur**: `api-docs.controller`
- **Fungsi utama**: serve OpenAPI spec (`swagger.js`/`swagger.fixed.js` — ⚠️ duplikasi)
- **Dependensi**: `swagger-ui-express`

---

### B. Monitoring & Analitik

#### 8. `dashboard` — Dasbor Realtime
- **Mount**: `/api/dashboard` · **Routes**: 2
- **Fungsi utama**: `getMetrics`, `getServerInfo`, `_getDockerStatus`, `_getFirewallStatus`, `_getPublicIp`, `_getRunningServices`
- **Dependensi**: `systeminformation`; **dipakai ulang oleh** `monitor` & `agent` (modul paling banyak dikonsumsi setelah `system`)

#### 9. `monitor` — Monitoring Historis
- **Mount**: `/api/monitor` · **Routes**: 7
- **Fungsi utama**: `getCurrent`, `saveHistory`, `getHistory`, `getDiskHealth`, `getNetworkStats`, `checkAlerts`, `getProcesses`
- **Dependensi**: `systeminformation`, `MonitorHistory` model, **`dashboard/dashboard.service`** (lintas-modul); dipakai `monitor.job` + `monitor.ws` (event `request:metrics`)

#### 10. `analytics` — Dashboard Analitik
- **Mount**: `/api/analytics` · **Routes**: 8
- **Fungsi utama**: `getMetricsHistory`, `getRealtimeMetrics`, `getSystemLogs`, `getWebLogs`, `getServiceHealth`, `getTopProcesses`, `getNetworkAnalytics`, `getDockerAnalytics`
- **Dependensi**: `systeminformation`, `MonitorHistory` model

#### 11. `alerts` — Notifikasi & Ambang Batas
- **Mount**: `/api/alerts` · **Routes**: 3
- **Fungsi utama**: `getConfig`, `updateConfig`, `testAlert`, `sendTelegram`, `sendEmail`, `sendDiscord`, `sendSlack`, `sendWebhook`, `sendWhatsApp`, `triggerAlert`
- **Dependensi**: `nodemailer`, `AlertConfig` model; **dipakai ulang oleh** `autoheal` (lintas-modul) & `monitor.job`

#### 12. `autoheal` — Watchdog / Service Healer
- **Mount**: `/api/autoheal` · **Routes**: 6
- **Fungsi utama**: `init`, `_runHealthCheck`, `_checkService`, `_checkDocker`, `_checkWebsites`, `_checkResources`, `healService`, `getIncidentHistory`, `runManualCheck`
- **Dependensi**: **`alerts/alerts.service`** (lintas-modul), `Notification` model; dipakai `health.job`

#### 13. `gpu` — NVIDIA GPU Manager
- **Mount**: `/api/gpu` · **Routes**: 5
- **Fungsi utama**: `getGpuInfo`, `getGpuProcesses`, `killProcess`, `resetGpu`, `setPowerLimit`, `_findNvidiaSmi`
- **Dependensi**: `nvidia-smi` (CLI eksternal)

#### 14. `power` — Power Manager
- **Mount**: `/api/power` · **Routes**: 12
- **Fungsi utama**: `getCpuInfo`, `setGovernor`, `setFrequency`, `getPowerProfiles`, `setPowerProfile`, `suspend/hibernate/hybridSleep`, `getThermalInfo`, `getFanInfo`, `setFanSpeed`, `getPowerStats`
- **Dependensi**: sysfs / `cpupower` (Linux)

---

### C. Container & Web Server

#### 15. `docker` — Mini Portainer
- **Mount**: `/api/docker` · **Routes**: 14
- **Fungsi utama**: `getInfo`, `getDashboardSummary`, `listContainers`, `getContainerInfo`, `start/stop/restart/kill/removeContainer`, `listImages`, `removeImage`, `pruneImages`, `searchImages`, `createContainer`, `deployCompose`
- **Dependensi**: `dockerode`, **`system/package-manager`** (lintas-modul); **paling banyak dikonsumsi plugin** (8 plugin); dipakai `docker.ws` (event `exec:create`, `logs:attach`, `stats:attach`, `exec:input`)

#### 16. `websites` — Manajemen Website/Nginx
- **Mount**: `/api/websites` · **Routes**: 7
- **Fungsi utama**: `listWebsites`, `createWebsite`, `updateWebsite`, `deleteWebsite`, `deployGit`, `webhookDeploy`, `generateNginxConfig`, `reloadNginx`, `_validateRootDirectory`
- **Dependensi**: `Website` model, Nginx CLI (host)

#### 17. `ssl` — Sertifikat SSL (acme.sh)
- **Mount**: `/api/ssl` · **Routes**: 3
- **Fungsi utama**: `installAcmeSh`, `issueCertificate`, `configureWebsiteSSL`, `renewCertificate`
- **Dependensi**: `Website` model, `acme.sh` CLI

#### 18. `caddy` — Caddy Server Manager
- **Mount**: `/api/caddy` · **Routes**: 20
- **Fungsi utama**: `installCaddy`, `getStatus`, `serviceAction`, `getCaddyfile/saveCaddyfile/validateCaddyfile/formatCaddyfile`, `getSites` (CRUD), `getCertificates`, `callAdminApi` (admin API Caddy), `getAdminStats`, `getAdminReverseProxy`
- **Dependensi**: Caddy binary + admin API (localhost:2019)

#### 19. `apache` — Apache Manager
- **Mount**: `/api/apache` · **Routes**: 17
- **Fungsi utama**: `installApache`, `uninstallApache`, `getStatus`, `serviceAction`, `testConfig`, `getModules/enable/disableModule`, `getVhosts` (CRUD), `getMainConfig/saveMainConfig`, `getLogs`, `_detectPackageManager`
- **Dependensi**: Apache CLI + `a2enmod/a2dismod`

---

### D. Database

#### 20. `database` — Explorer & Query Console (multi-engine)
- **Mount**: `/api/database` · **Routes**: 19
- **Fungsi utama (45 metode — modul terbesar)**: `list/create/delete*Databases` (MySQL/PG/SQLite), `getSchemas` (PostgreSQL multi-schema), `getTables/getTableInfo/getTableData` (per schema), `runQuery` (+ scanner `_hasRestrictedStatement` untuk blokir DROP/TRUNCATE/ALTER), `getQueryHistory/clearQueryHistory`, `exportData` (JSON/CSV/SQL), `importSql`/`importCsv` (menghormati schema aktif via `SET search_path`), `getDatabaseStats`, `getPgConfig*`/`enablePgRemoteAccess`, `saveCredentials`
- **Dependensi**: `mysql2/promise`, `pg`, `better-sqlite3`, `Setting` model; endpoint `explore`/`import/*` masuk `SKIP_BODY_SCAN_PATHS` WAF (proteksi di layer service)

#### 21. `mongodb` — MongoDB Manager
- **Mount**: `/api/mongodb` · **Routes**: 16
- **Fungsi utama**: `installMongoDB`, `getStatus`, `getServerInfo`, `listDatabases/create/drop`, `getDatabaseStats`, `listCollections/dropCollection`, `findDocuments`, `listUsers/create/dropUser`, `runQuery`, `backupDatabase/restoreDatabase`
- **Dependensi**: `mongosh`/`mongo` CLI (via `_runMongoCommand`); `runQuery` masuk `SKIP_BODY_SCAN_PATHS` WAF

#### 22. `redis` — Redis Manager
- **Mount**: `/api/redis` · **Routes**: 15
- **Fungsi utama**: `getInfo`, `getStats`, `getConfig/setConfig`, `scanKeys`, `getKeyValue`, `deleteKey`, `setKeyTtl`, `flushDb/flushAll`, `save/bgsave`, `getClients/killClient`, `getSlowLog`
- **Dependensi**: `ioredis` (koneksi ke Redis server terkelola)

---

### E. Runtime & Layanan

#### 23. `nodejs` — Node.js Manager (nvm + PM2)
- **Mount**: `/api/nodejs` · **Routes**: 16
- **Fungsi utama**: `installNvm`, `getStatus`, `listRemote`, `installVersion/uninstallVersion`, `setDefault/useVersion`, `listGlobalPackages/install/uninstall`, `getPm2List`, `pm2Action`, `getPm2Logs`, `pm2Start`, `getNodeInfo`
- **Dependensi**: nvm + PM2 CLI

#### 24. `python` — Python Manager (pyenv + Gunicorn)
- **Mount**: `/api/python` · **Routes**: 20
- **Fungsi utama**: `installPyenv`, `listRemote`, `installVersion/uninstallVersion`, `setGlobal`, `listVirtualEnvs/create/delete`, `listPipPackages/install/uninstall`, `getWsgiServers/startWsgi/stopWsgi`, `getSupervisorStatus/createSupervisorConfig/supervisorAction`
- **Dependensi**: pyenv + pip + supervisor CLI

#### 25. `mail` — Mail Server (Postfix/Dovecot)
- **Mount**: `/api/mail` · **Routes**: 18
- **Fungsi utama**: `install/uninstall`, `controlService`, `getAccounts/addAccount/deleteAccount/updatePassword`, `getDomains/add/remove`, `getQueue/flushQueue/deleteFromQueue`, `getSpamConfig/updateSpamConfig`, `getSslInfo`, `getLogs`; validasi email/domain (`_validateEmail`, `_validateDomain`)
- **Dependensi**: Postfix/Dovecot/SpamAssassin CLI

#### 26. `whatsapp` — WhatsApp Gateway (Baileys)
- **Mount**: `/api/whatsapp` · **Routes**: 6
- **Fungsi utama**: `restoreSessions`, `getSessionStatus`, `initSession`, `forwardToWebhook`, `sendMessage`, `deleteSession`
- **Dependensi**: `@whiskeysockets/baileys`, `@hapi/boom`, `axios`, `pino`, `qrcode`, `WhatsappSession` model

#### 27. `iot` — IoT & Edge (MQTT)
- **Mount**: `/api/iot` · **Routes**: 17
- **Fungsi utama**: `getMqttStatus/installMosquitto/controlMosquitto`, `getMosquittoConfig/save`, `getMqttUsers/add/delete`, `getMqttAcl/saveMqttAcl`, `publishMessage`, `getHomeAssistantStatus/installHomeAssistant`, `getNodeRedStatus/installNodeRed`, `discoverDevices`, `getMetrics`; validasi port/id/topic
- **Dependensi**: Mosquitto CLI, nmap (discovery)

---

### F. Keamanan

#### 28. `system` — Modul Sistem & Keamanan (hub bersama)
- **Mount**: `/api/system` · **Routes**: 49 (terbanyak)
- **Struktur**: `system.controller/service` + `package-manager.js` + `password-policy.service.js` + `php.service.js` + `ssh.service.js` + `tunnel.controller.js`
- **Fungsi utama**: `getServiceStatus/manageService`, `installPackage`, `runUpdate/runUpgrade/runAptUpdate/runAptUpgrade`, `reboot`, `getAutoUpdate/setAutoUpdate`, `checkPanelUpdate/runPanelUpdate/restartPanel`, SSH keys & config (`getSSHKeys/addSSHKey/deleteSSHKey/getSSHConfig/updateSSHConfig`), PHP config (`getPHPConfig/updatePHPConfig`), `getAuditStats/getAuditLogs`, `runSecurityScan/fixSecurityIssue`, Tailscale (`installTailscale/tailscaleUp/tailscaleDown`), Password Policy (`getPolicy/updatePolicy/validatePassword/export/import/previewUrl/getHistory`), Cloudflare/N8n tunnel (`startCloudflare/stopCloudflare/startN8n/stopN8n`)
- **Dependensi**: `helpers/security-advisor`; **dieksekusi oleh** `auth`, `users`, `docker`; **dipakai plugin** `php-manager`, `rclone-manager`

#### 29. `firewall` — UFW Manager
- **Mount**: `/api/firewall` · **Routes**: 4
- **Fungsi utama**: `getStatus`, `enable/disable`, `addRule`, `deleteRule`; validasi ketat `_validatePort/_validateProtocol/_validateAction/_validateRuleId`
- **Dependensi**: UFW CLI; **dipakai 8 plugin** (buka port saat deploy container)

#### 30. `waf` — WAF Rules & Fail2Ban
- **Mount**: `/api/waf` · **Routes**: 4
- **Fungsi utama**: `getRules`, `addRule`, `deleteRule`, `getFail2BanLogs`
- **Dependensi**: `WafRule` model (cache global di `waf.middleware.js`), Fail2Ban logs

#### 31. `dns` — DNS Manager (Cloudflare/DuckDNS/No-IP)
- **Mount**: `/api/dns` · **Routes**: 14
- **Fungsi utama**: `getProviders`, `saveProviderConfig`, `testProvider`, `getZones`, `getRecords` (CRUD + `bulkUpdateRecords`), `getDNSSECStatus/enable/disableDNSSEC`, `updateDynamicDNS`, `validateRecord`, `_cfApi`, `_testDuckDNS`, `_testDigitalOcean`
- **Dependensi**: Cloudflare API (axios), DuckDNS/No-IP HTTP

#### 32. `ai-repair` — AI Auto-Repair
- **Mount**: `/api/ai-repair` · **Routes**: 10
- **Fungsi utama**: `analyzeLog`, `getAutoFixSuggestions`, `applyAutoFix`, `runAutoDiagnostic`, `analyzeTrends`, `getHealthScore`, `suggestFix`, `getConfig/saveConfig`, `_callAI`
- **Dependensi**: OpenAI-compatible API (konfigurasi user); endpoint masuk `SKIP_BODY_SCAN_PATHS` WAF

#### 33. `ai` — AI Copilot (chat)
- **Mount**: `/api/ai` · **Routes**: 1
- **Fungsi utama**: `chat`
- **Dependensi**: **`system/system.service`** (lintas-modul); `/api/ai/chat` masuk `SKIP_BODY_SCAN_PATHS` WAF

#### 34. `cdn` — CDN & Cache (Cloudflare/Varnish/Redis/FPC)
- **Mount**: `/api/cdn` · **Routes**: 13
- **Fungsi utama**: `getCloudflareZones`, `purgeCloudflareCache/purgeUrls`, `getCloudflareAnalytics`, `getVarnishStatus/controlVarnish`, `getVarnishConfig/save`, `purgeVarnish`, `getRedisCacheInfo/flushRedisCache`, `getFpcStatus/flushFpc`
- **Dependensi**: Cloudflare API, Varnish CLI, `ioredis`

---

### G. Operasional

#### 35. `filemanager` — File Manager (Split-View + CodeMirror)
- **Mount**: `/api/filemanager` · **Routes**: 16
- **Fungsi utama**: `list`, `getInfo`, `readFile`, `writeFile`, `rename`, `move`, `copy`, `delete`, `mkdir`, `upload`, `download` (+ `generateDownloadToken/downloadByToken`), `zip`, `unzip`, `search`; keamanan `_resolvePath` (anti traversal)
- **Dependensi**: `multer`, `unzipper`, `archiver`; `write/read/unzip` masuk `SKIP_BODY_SCAN_PATHS` WAF

#### 36. `terminal` — Web Terminal (xterm.js + node-pty)
- **Mount**: `/api/terminal` · **Routes**: 3
- **Fungsi utama**: `create`, `write`, `resize`, `onData`, `onExit`, `kill`, `killUserSessions`, `getSession`, `getStats`, `_resolveShell`
- **Dependensi**: `node-pty`, `uuid`; dipakai `agent-terminal.ws` + Socket.IO `/terminal`

#### 37. `backup` — Backup & Disaster Recovery (Rclone/S3)
- **Mount**: `/api/backup` · **Routes**: 23
- **Fungsi utama**: `getRcloneStatus/installRclone`, `testRemote/listRemoteFiles`, `getBackupJobs` (CRUD) + `runBackupJob` + `_applyRetention`, `getBackups/createBackup/deleteBackup/restoreBackup`, S3 (`getS3Config/updateS3Config/testS3Connection/listS3Backups/downloadFromS3`), `restoreFromRemote/listRemoteBackups`, rclone config path management
- **Dependensi**: `plugins/shared/rclone-helper`, rclone CLI, `@aws-sdk/client-s3`; dipakai `backup.job`

#### 38. `cron` — Cron Manager
- **Mount**: `/api/cron` · **Routes**: 4
- **Fungsi utama**: `getTasks`, `addTask`, `deleteTask`, `toggleTask`, `_scheduleJob`, `_save`
- **Dependensi**: `node-cron` (in-process scheduler)

#### 39. `updater` — Auto-Updater & Rollback
- **Mount**: `/api/updater` · **Routes**: 15
- **Fungsi utama**: `getVersionInfo`, `checkForUpdates`, `getChangelog`, `getDiffPreview`, `createPreUpdateBackup`, `listBackups`, `performUpdate`, `performRollback`, `restartPanel`, `runHealthCheck`, `getUpdateHistory`, `getScheduleConfig/setScheduleConfig`; validasi `_validateGitRef`, `_validateCommitHash`, `_validateChannel`
- **Dependensi**: git CLI, `_runCommand`/`_mockCommand` (testability)

#### 40. `lvm-manager` — Storage/LVM/RAID Manager
- **Mount**: `/api/lvm-manager` · **Routes**: 20
- **Fungsi utama**: `getDisks`, `getSmartStatus`, `getRaidArrays` (+ `createRaid/manageRaidDisk/stopRaid`), `getPVs/createPV/removePV`, `getVGs/createVG/extendVG/removeVG`, `getLVs/createLV/extendLV/removeLV`, `formatVolume/mountVolume/unmountVolume`; `mockExec`/`mockExecShell` untuk test
- **Dependensi**: `lsblk`, `pvs/vgs/lvs`, `mdadm`, `mkfs`, `mount` CLI

---

## 6. Temuan Arsitektur

| # | Temuan | Dampak |
|---|---|---|
| T1 | **Kopling antar-modul sangat rendah** (8 pasang saja) | ✅ Sesuai target desain "modul independent"; memudahkan refactor & test per modul |
| T2 | **Modul `system` menjadi hub** (dipakai `auth`, `users`, `docker`, 2 plugin + helper) | ⚠️ Perubahan `password-policy`/`package-manager` berdampak luas; perlu regression test |
| T3 | **`docker` + `firewall` adalah API publik plugin** (8 plugin) | ⚠️ Signature method kedua service ini adalah *contract* plugin SDK — harus stabil & backward-compatible |
| T4 | **Helper → modul** (`security-advisor` → `ssh.service`) membalik arah dependensi | ⚠️ Melanggar lapisan (helper seharusnya tidak import modul); pertimbangkan pindah `ssh.service` ke helpers/ |
| T5 | **Duplikasi LVM**: modul `src/modules/lvm-manager` + `plugins/lvm-manager` | ⚠️ Dua implementasi untuk satu fitur; tentukan satu sumber kebenaran |
| T6 | **Duplikasi Swagger**: `swagger.js` + `swagger.fixed.js` (2.800 LOC total) | ⚠️ Risiko drift dokumentasi API |
| T7 | **Modul besar**: `database` (45 metode, 1.070 baris), `system` (49 route), `caddy` (27 metode, 1.003 baris), `backup` (30 metode, 832 baris) | ⚠️ Kandidat pemecahan (rencana.md 8.4) |
| T8 | **Job/WS menggantung pada service modul**: `monitor.job→monitor+alerts`, `health.job→autoheal`, `docker.ws→docker`, `agent-terminal.ws→terminal` | ✅ Pola sehat (event-driven); pastikan dependency injeksi mudah di-mock saat test |

---

## 7. Rekomendasi

1. **P0 — Stabilitas API `docker`/`firewall`/`system`** karena merupakan kontrak plugin & modul lain: tambahkan integration test + semver yang jelas.
2. **P1 — Perbaiki arah dependensi `security-advisor → ssh.service`** (pindahkan layanan SSH ke `helpers/` atau inject dependency).
3. **P1 — Selesaikan duplikasi LVM & Swagger** (tentukan sumber kebenaran tunggal; `[DEDUP]` di app.js sudah menandakan niat ini).
4. **P1 — Refactor modul raksasa** (`database`, `caddy`, `system`, `backup`) mengikuti rencana.md §8.4.
5. **P2 — Dokumentasikan "Plugin SDK contract"** (metode `dockerService`/`firewallService` yang wajib dijaga) di `docs/plugin-sdk.md`.

---

*Laporan ini dihasilkan dari analisis statis kode `linux-panel/` — lihat juga [analisis-proyek.md](analisis-proyek.md) dan [coverage-baseline.md](coverage-baseline.md).*
