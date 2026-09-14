/**
 * Jobs Unit Tests
 * Covers src/jobs/backup.job.js, monitor.job.js, password-expiry-reminder.job.js
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import scheduler from '../src/core/scheduler/Scheduler.js';
import { startBackupJob } from '../src/jobs/backup.job.js';
import { startMonitorJob } from '../src/jobs/monitor.job.js';
import { startPasswordExpiryReminder, checkExpiringPasswords } from '../src/jobs/password-expiry-reminder.job.js';
import monitorService from '../src/modules/monitor/monitor.service.js';
import alertsService from '../src/modules/alerts/alerts.service.js';
import passwordPolicyService from '../src/modules/system/password-policy.service.js';

beforeAll(() => {
  scheduler.cancelAll();
});

afterAll(() => {
  scheduler.cancelAll();
});

describe('System Jobs - Lifecycle & Registration', () => {
  test('startBackupJob registers system:backup in scheduler', () => {
    startBackupJob();
    expect(scheduler._jobs.has('system:backup')).toBe(true);
  });

  test('startMonitorJob registers monitor:collect in scheduler', () => {
    startMonitorJob();
    expect(scheduler._jobs.has('monitor:collect')).toBe(true);
  });

  test('startPasswordExpiryReminder registers password-expiry:reminder in scheduler', async () => {
    jest.spyOn(passwordPolicyService, 'getPolicy').mockResolvedValue({
      expiryEnabled: true,
      expiryDays: 90,
      reminderDays: 7,
    });
    startPasswordExpiryReminder();
    // Allow async IIFE inside startPasswordExpiryReminder to resolve
    await new Promise(r => setTimeout(r, 50));
    expect(scheduler._jobs.has('password-expiry:reminder')).toBe(true);
  });
});

describe('Password Expiry Reminder Job - checkExpiringPasswords', () => {
  test('checkExpiringPasswords executes without unhandled errors', async () => {
    jest.spyOn(passwordPolicyService, 'getPolicy').mockResolvedValue({
      expiryEnabled: true,
      expiryDays: 90,
      reminderDays: 7,
    });
    jest.spyOn(alertsService, 'getConfig').mockResolvedValue({
      email: { enabled: false },
    });

    const result = await checkExpiringPasswords();
    expect(Array.isArray(result)).toBe(true);
  });
});
