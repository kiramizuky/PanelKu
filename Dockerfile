FROM node:20-alpine

# Install build dependencies for node-pty
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app

# Copy package files
COPY package.json ./
RUN npm install --production

# Copy source
COPY src/ ./src/
COPY .env.example ./.env

# Create storage directories
RUN mkdir -p storage/logs storage/uploads storage/backups storage/temp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

EXPOSE 3000

CMD ["node", "src/server.js"]
