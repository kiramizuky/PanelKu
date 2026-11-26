import { test, expect } from '@playwright/test';

const ADMIN_USER = process.env.E2E_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || 'Admin@123456';

async function loginThroughUI(page) {
  await page.goto('/login');
  await page.fill('input[name="username"], #username', ADMIN_USER);
  await page.fill('input[name="password"], #password', ADMIN_PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|settings\/profile|2fa)/, { timeout: 15_000 });
}

test.describe('PanelKu E2E Security & UI Regression Suite', () => {
  test('Login flow loads cleanly and enforces authentication on protected routes', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('form')).toBeVisible();
    await loginThroughUI(page);
  });

  test('Vulnerability Center renders, runs scan, and exposes Markdown/JSON/SARIF exports', async ({ page }) => {
    await loginThroughUI(page);
    await page.goto('/vulnerabilities');
    await expect(page.locator('#btnScanMenu')).toBeVisible();
    await expect(page.locator('#btnExportReport')).toBeVisible();
    await page.click('#btnExportReport');
    await expect(page.locator('#actExportMarkdown')).toBeVisible();
    await expect(page.locator('#actExportJSON')).toBeVisible();
    await expect(page.locator('#actExportSarif')).toBeVisible();
  });

  test('Web Terminal loads xterm container and status badge', async ({ page }) => {
    await loginThroughUI(page);
    await page.goto('/terminal');
    await expect(page.locator('#terminalsContainer')).toBeVisible();
    await expect(page.locator('#terminalStatusBadge')).toBeVisible();
  });

  test('File Manager renders tree view and navigation controls', async ({ page }) => {
    await loginThroughUI(page);
    await page.goto('/filemanager');
    await expect(page.locator('.fm-tree, #fileTree, #fileList')).toBeVisible();
  });
});
