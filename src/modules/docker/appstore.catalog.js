/**
 * Docker 1-Click App Store Catalog
 * Production-ready templates with default ports, volumes, environment variables, and compose YAMLs.
 */

export const APP_STORE_CATALOG = [
  // ── Web & CMS ──
  {
    id: 'wordpress',
    name: 'WordPress + MariaDB',
    category: 'Web & CMS',
    icon: 'bi-wordpress',
    color: '#21759b',
    description: 'World most popular website and blog publishing platform paired with MariaDB.',
    defaultPort: 8080,
    fields: [
      { key: 'PORT', label: 'HTTP Port', type: 'number', default: 8080 },
      { key: 'DB_PASSWORD', label: 'Database Password', type: 'password', default: 'wp_secret_pass_123' },
      { key: 'DB_ROOT_PASSWORD', label: 'DB Root Password', type: 'password', default: 'root_secret_pass_123' },
    ],
    compose: `version: '3.8'
services:
  db:
    image: mariadb:10.11
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: \${DB_PASSWORD}
    volumes:
      - db_data:/var/lib/mysql

  wordpress:
    image: wordpress:latest
    restart: unless-stopped
    ports:
      - "\${PORT}:80"
    environment:
      WORDPRESS_DB_HOST: db:3306
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: \${DB_PASSWORD}
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wp_data:/var/www/html

volumes:
  db_data:
  wp_data:
`
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud Hub',
    category: 'Web & CMS',
    icon: 'bi-cloud-check-fill',
    color: '#0082c9',
    description: 'Self-hosted productivity platform for files, calendars, contacts, and collaborative office.',
    defaultPort: 8085,
    fields: [
      { key: 'PORT', label: 'HTTP Port', type: 'number', default: 8085 },
      { key: 'DB_PASSWORD', label: 'PostgreSQL Password', type: 'password', default: 'nextcloud_db_pass_123' },
    ],
    compose: `version: '3.8'
services:
  db:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - db_data:/var/lib/postgresql/data

  app:
    image: nextcloud:latest
    restart: unless-stopped
    ports:
      - "\${PORT}:80"
    environment:
      POSTGRES_HOST: db
      POSTGRES_DB: nextcloud
      POSTGRES_USER: nextcloud
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - nextcloud_data:/var/www/html

volumes:
  db_data:
  nextcloud_data:
`
  },
  {
    id: 'ghost',
    name: 'Ghost Blog',
    category: 'Web & CMS',
    icon: 'bi-pencil-square',
    color: '#15171a',
    description: 'Modern, blazing-fast professional publishing platform for newsletters and blogs.',
    defaultPort: 2368,
    fields: [
      { key: 'PORT', label: 'HTTP Port', type: 'number', default: 2368 },
      { key: 'BLOG_URL', label: 'Site URL', type: 'text', default: 'http://localhost:2368' },
    ],
    compose: `version: '3.8'
services:
  ghost:
    image: ghost:5-alpine
    restart: unless-stopped
    ports:
      - "\${PORT}:2368"
    environment:
      url: \${BLOG_URL}
      NODE_ENV: production
    volumes:
      - ghost_data:/var/lib/ghost/content

volumes:
  ghost_data:
`
  },
  {
    id: 'strapi',
    name: 'Strapi CMS',
    category: 'Web & CMS',
    icon: 'bi-boxes',
    color: '#4945ff',
    description: 'Leading open-source headless CMS 100% JavaScript / TypeScript.',
    defaultPort: 1337,
    fields: [
      { key: 'PORT', label: 'HTTP Port', type: 'number', default: 1337 },
      { key: 'APP_KEYS', label: 'App Keys', type: 'text', default: 'toBeModified1,toBeModified2' },
      { key: 'ADMIN_JWT_SECRET', label: 'Admin JWT Secret', type: 'password', default: 'strapi_jwt_secret_token_123' },
    ],
    compose: `version: '3.8'
services:
  strapi:
    image: strapi/strapi:latest
    restart: unless-stopped
    ports:
      - "\${PORT}:1337"
    environment:
      NODE_ENV: production
      APP_KEYS: \${APP_KEYS}
      ADMIN_JWT_SECRET: \${ADMIN_JWT_SECRET}
    volumes:
      - strapi_data:/srv/app

volumes:
  strapi_data:
`
  },

  // ── AI & Machine Learning ──
  {
    id: 'ollama',
    name: 'Ollama (Local LLM Engine)',
    category: 'AI & LLM',
    icon: 'bi-robot',
    color: '#10b981',
    description: 'Run large language models (Llama 3, DeepSeek, Mistral, Qwen) locally on CPU or GPU.',
    defaultPort: 11434,
    fields: [
      { key: 'PORT', label: 'API Port', type: 'number', default: 11434 },
    ],
    compose: `version: '3.8'
services:
  ollama:
    image: ollama/ollama:latest
    restart: unless-stopped
    ports:
      - "\${PORT}:11434"
    volumes:
      - ollama_models:/root/.ollama

volumes:
  ollama_models:
`
  },
  {
    id: 'open-webui',
    name: 'Open WebUI (ChatGPT Interface)',
    category: 'AI & LLM',
    icon: 'bi-chat-square-dots-fill',
    color: '#06b6d4',
    description: 'User-friendly ChatGPT-like web UI for Ollama, OpenAI API, and custom LLM inference.',
    defaultPort: 3080,
    fields: [
      { key: 'PORT', label: 'Web UI Port', type: 'number', default: 3080 },
      { key: 'OLLAMA_BASE_URL', label: 'Ollama Endpoint', type: 'text', default: 'http://host.docker.internal:11434' },
    ],
    compose: `version: '3.8'
services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    restart: unless-stopped
    ports:
      - "\${PORT}:8080"
    environment:
      OLLAMA_BASE_URL: \${OLLAMA_BASE_URL}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - openwebui_data:/app/backend/data

volumes:
  openwebui_data:
`
  },
  {
    id: 'n8n',
    name: 'n8n Workflow Automation',
    category: 'AI & LLM',
    icon: 'bi-bezier2',
    color: '#ea4b71',
    description: 'Extendable workflow automation tool with 350+ native integrations and AI Agent nodes.',
    defaultPort: 5678,
    fields: [
      { key: 'PORT', label: 'Web UI Port', type: 'number', default: 5678 },
      { key: 'WEBHOOK_URL', label: 'Webhook URL', type: 'text', default: 'http://localhost:5678/' },
    ],
    compose: `version: '3.8'
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    restart: unless-stopped
    ports:
      - "\${PORT}:5678"
    environment:
      WEBHOOK_URL: \${WEBHOOK_URL}
      N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "true"
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
`
  },

  // ── Dev & Tools ──
  {
    id: 'portainer',
    name: 'Portainer CE',
    category: 'Dev & Tools',
    icon: 'bi-box-seam',
    color: '#13bef9',
    description: 'Lightweight Docker container management web UI and cluster orchestrator.',
    defaultPort: 9000,
    fields: [
      { key: 'PORT', label: 'HTTP Port', type: 'number', default: 9000 },
    ],
    compose: `version: '3.8'
services:
  portainer:
    image: portainer/portainer-ce:latest
    restart: unless-stopped
    ports:
      - "\${PORT}:9000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - portainer_data:/data

volumes:
  portainer_data:
`
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    category: 'Dev & Tools',
    icon: 'bi-activity',
    color: '#5cdd8b',
    description: 'Self-hosted monitoring tool for HTTP(s), TCP, Ping, DNS with beautiful status pages.',
    defaultPort: 3001,
    fields: [
      { key: 'PORT', label: 'HTTP Port', type: 'number', default: 3001 },
    ],
    compose: `version: '3.8'
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    restart: unless-stopped
    ports:
      - "\${PORT}:3001"
    volumes:
      - uptime_kuma_data:/app/data

volumes:
  uptime_kuma_data:
`
  },
  {
    id: 'vaultwarden',
    name: 'Vaultwarden (Bitwarden Server)',
    category: 'Dev & Tools',
    icon: 'bi-shield-lock-fill',
    color: '#175ddc',
    description: 'Lightweight, self-hosted Bitwarden-compatible password manager written in Rust.',
    defaultPort: 8081,
    fields: [
      { key: 'PORT', label: 'HTTP Port', type: 'number', default: 8081 },
      { key: 'SIGNUPS_ALLOWED', label: 'Allow Signups', type: 'text', default: 'true' },
    ],
    compose: `version: '3.8'
services:
  vaultwarden:
    image: vaultwarden/server:latest
    restart: unless-stopped
    ports:
      - "\${PORT}:80"
    environment:
      SIGNUPS_ALLOWED: \${SIGNUPS_ALLOWED}
    volumes:
      - vw_data:/data

volumes:
  vw_data:
`
  },
  {
    id: 'gitea',
    name: 'Gitea Git Server',
    category: 'Dev & Tools',
    icon: 'bi-git',
    color: '#609926',
    description: 'Painless self-hosted Git service with issue tracking, pull requests, and CI/CD.',
    defaultPort: 3030,
    fields: [
      { key: 'HTTP_PORT', label: 'Web Port', type: 'number', default: 3030 },
      { key: 'SSH_PORT', label: 'SSH Port', type: 'number', default: 2222 },
    ],
    compose: `version: '3.8'
services:
  gitea:
    image: gitea/gitea:latest
    restart: unless-stopped
    ports:
      - "\${HTTP_PORT}:3000"
      - "\${SSH_PORT}:22"
    volumes:
      - gitea_data:/data
      - /etc/timezone:/etc/timezone:ro
      - /etc/localtime:/etc/localtime:ro

volumes:
  gitea_data:
`
  },

  // ── Database & Management ──
  {
    id: 'phpmyadmin',
    name: 'phpMyAdmin',
    category: 'Database',
    icon: 'bi-database-fill-gear',
    color: '#ff9900',
    description: 'Web interface for managing MySQL and MariaDB databases.',
    defaultPort: 8088,
    fields: [
      { key: 'PORT', label: 'HTTP Port', type: 'number', default: 8088 },
      { key: 'PMA_HOST', label: 'MySQL Host', type: 'text', default: 'host.docker.internal' },
    ],
    compose: `version: '3.8'
services:
  phpmyadmin:
    image: phpmyadmin:latest
    restart: unless-stopped
    ports:
      - "\${PORT}:80"
    environment:
      PMA_HOST: \${PMA_HOST}
      UPLOAD_LIMIT: 128M
    extra_hosts:
      - "host.docker.internal:host-gateway"
`
  },
  {
    id: 'pgadmin',
    name: 'pgAdmin 4',
    category: 'Database',
    icon: 'bi-database-check',
    color: '#336791',
    description: 'Comprehensive administration and management tool for PostgreSQL.',
    defaultPort: 5050,
    fields: [
      { key: 'PORT', label: 'HTTP Port', type: 'number', default: 5050 },
      { key: 'PGADMIN_DEFAULT_EMAIL', label: 'Admin Email', type: 'text', default: 'admin@panelku.local' },
      { key: 'PGADMIN_DEFAULT_PASSWORD', label: 'Admin Password', type: 'password', default: 'admin_pass_123' },
    ],
    compose: `version: '3.8'
services:
  pgadmin:
    image: dpage/pgadmin4:latest
    restart: unless-stopped
    ports:
      - "\${PORT}:80"
    environment:
      PGADMIN_DEFAULT_EMAIL: \${PGADMIN_DEFAULT_EMAIL}
      PGADMIN_DEFAULT_PASSWORD: \${PGADMIN_DEFAULT_PASSWORD}
    volumes:
      - pgadmin_data:/var/lib/pgadmin

volumes:
  pgadmin_data:
`
  },
  {
    id: 'redis-commander',
    name: 'Redis Commander',
    category: 'Database',
    icon: 'bi-hdd-network-fill',
    color: '#dc2626',
    description: 'Fast web management tool for Redis servers and key inspection.',
    defaultPort: 8089,
    fields: [
      { key: 'PORT', label: 'HTTP Port', type: 'number', default: 8089 },
      { key: 'REDIS_HOSTS', label: 'Redis Host', type: 'text', default: 'host.docker.internal:6379' },
    ],
    compose: `version: '3.8'
services:
  redis-commander:
    image: rediscommander/redis-commander:latest
    restart: unless-stopped
    ports:
      - "\${PORT}:8081"
    environment:
      REDIS_HOSTS: \${REDIS_HOSTS}
    extra_hosts:
      - "host.docker.internal:host-gateway"
`
  },

  // ── Media & Home ──
  {
    id: 'jellyfin',
    name: 'Jellyfin Media System',
    category: 'Media & Home',
    icon: 'bi-play-circle-fill',
    color: '#aa5cc3',
    description: 'The Free Software Media System for streaming movies, music, and TV shows.',
    defaultPort: 8096,
    fields: [
      { key: 'PORT', label: 'HTTP Port', type: 'number', default: 8096 },
    ],
    compose: `version: '3.8'
services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    restart: unless-stopped
    ports:
      - "\${PORT}:8096"
    volumes:
      - jellyfin_config:/config
      - jellyfin_cache:/cache
      - /var/media:/media:ro

volumes:
  jellyfin_config:
  jellyfin_cache:
`
  },
  {
    id: 'mosquitto',
    name: 'Eclipse Mosquitto MQTT',
    category: 'Media & Home',
    icon: 'bi-broadcast',
    color: '#6c757d',
    description: 'Lightweight open source message broker implementing MQTT protocol for IoT.',
    defaultPort: 1883,
    fields: [
      { key: 'MQTT_PORT', label: 'MQTT Port', type: 'number', default: 1883 },
      { key: 'WS_PORT', label: 'WebSocket Port', type: 'number', default: 9001 },
    ],
    compose: `version: '3.8'
services:
  mosquitto:
    image: eclipse-mosquitto:latest
    restart: unless-stopped
    ports:
      - "\${MQTT_PORT}:1883"
      - "\${WS_PORT}:9001"
    volumes:
      - mosquitto_data:/mosquitto/data
      - mosquitto_log:/mosquitto/log

volumes:
  mosquitto_data:
  mosquitto_log:
`
  },
  {
    id: 'homeassistant',
    name: 'Home Assistant Core',
    category: 'Media & Home',
    icon: 'bi-house-gear-fill',
    color: '#03a9f4',
    description: 'Open source home automation that puts local control and privacy first.',
    defaultPort: 8123,
    fields: [
      { key: 'PORT', label: 'Web UI Port', type: 'number', default: 8123 },
    ],
    compose: `version: '3.8'
services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    restart: unless-stopped
    ports:
      - "\${PORT}:8123"
    volumes:
      - ha_config:/config
      - /etc/localtime:/etc/localtime:ro

volumes:
  ha_config:
`
  }
];

export default APP_STORE_CATALOG;
