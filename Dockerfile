FROM node:22-alpine

# Build dependencies for native addons (better-sqlite3, node-pty)
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app

ENV NODE_ENV=production
# Containers are restarted by the orchestrator; there is no systemd/pm2 inside
# the container, so the updater must use its in-process fallback.
ENV PANELKU_UPDATE_SUPERVISOR=false

# Copy lockfile too: `npm ci` gives reproducible installs.
# NOTE: devDependencies are not needed at runtime; native modules are still built.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy source and runtime plugins
COPY src/ ./src/
COPY plugins/ ./plugins/

# Create storage directories
RUN mkdir -p storage/logs storage/uploads storage/backups storage/temp

# Health check (PORT defaults to 3000 inside Docker)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/api/health', r => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

EXPOSE 3000

CMD ["node", "src/server.js"]
