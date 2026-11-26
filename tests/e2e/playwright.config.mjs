import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || '23999';
const BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node ../../src/server.js',
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          NODE_ENV: 'test',
          PORT,
          JWT_SECRET: process.env.JWT_SECRET || 'e2e-jwt-secret-must-be-32-chars-min',
          JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'e2e-refresh-secret-must-be-32-chars',
          APP_SECRET: process.env.APP_SECRET || 'e2e-app-secret-must-be-32-chars-min',
        },
      },
});
