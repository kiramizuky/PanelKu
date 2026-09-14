/**
 * Power Controller and Mail Controller Unit Tests
 *
 * @jest-environment node
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import powerController from '../src/modules/power/power.controller.js';
import mailController from '../src/modules/mail/mail.controller.js';
import powerService from '../src/modules/power/power.service.js';
import mailService from '../src/modules/mail/mail.service.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(d) {
      this.body = d;
      return this;
    },
  };
}

describe('PowerController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getCpuInfo returns cpu data', async () => {
    jest.spyOn(powerService, 'getCpuInfo').mockResolvedValue({ cores: 4 });
    const res = mockRes();
    await powerController.getCpuInfo({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.cores).toBe(4);
  });

  test('setGovernor validates governor parameter', async () => {
    const badRes = mockRes();
    await powerController.setGovernor({ body: {} }, badRes);
    expect(badRes.statusCode).toBe(400);

    jest.spyOn(powerService, 'setGovernor').mockResolvedValue(true);
    const goodRes = mockRes();
    await powerController.setGovernor({ body: { governor: 'performance' } }, goodRes);
    expect(goodRes.statusCode).toBe(200);
  });

  test('setFrequency validates khz parameter', async () => {
    const badRes = mockRes();
    await powerController.setFrequency({ body: {} }, badRes);
    expect(badRes.statusCode).toBe(400);

    jest.spyOn(powerService, 'setFrequency').mockResolvedValue(true);
    const goodRes = mockRes();
    await powerController.setFrequency({ body: { khz: '2400000' } }, goodRes);
    expect(goodRes.statusCode).toBe(200);
  });

  test('getPowerProfiles and setPowerProfile manage power profile', async () => {
    jest.spyOn(powerService, 'getPowerProfiles').mockResolvedValue(['balanced', 'performance']);
    const resGet = mockRes();
    await powerController.getPowerProfiles({}, resGet);
    expect(resGet.statusCode).toBe(200);

    const badSet = mockRes();
    await powerController.setPowerProfile({ body: {} }, badSet);
    expect(badSet.statusCode).toBe(400);

    jest.spyOn(powerService, 'setPowerProfile').mockResolvedValue(true);
    const goodSet = mockRes();
    await powerController.setPowerProfile({ body: { profile: 'balanced' } }, goodSet);
    expect(goodSet.statusCode).toBe(200);
  });

  test('suspend, hibernate, and hybridSleep', async () => {
    jest.spyOn(powerService, 'suspend').mockResolvedValue(true);
    jest.spyOn(powerService, 'hibernate').mockResolvedValue(true);
    jest.spyOn(powerService, 'hybridSleep').mockResolvedValue(true);

    const res1 = mockRes();
    await powerController.suspend({}, res1);
    expect(res1.statusCode).toBe(200);

    const res2 = mockRes();
    await powerController.hibernate({}, res2);
    expect(res2.statusCode).toBe(200);

    const res3 = mockRes();
    await powerController.hybridSleep({}, res3);
    expect(res3.statusCode).toBe(200);
  });

  test('thermal, fan and stats endpoints', async () => {
    jest.spyOn(powerService, 'getThermalInfo').mockResolvedValue({ temp: 45 });
    jest.spyOn(powerService, 'getFanInfo').mockResolvedValue([{ speed: 1200 }]);
    jest.spyOn(powerService, 'setFanSpeed').mockResolvedValue(true);
    jest.spyOn(powerService, 'getPowerStats').mockResolvedValue({ wattage: 15 });

    const resTherm = mockRes();
    await powerController.getThermalInfo({}, resTherm);
    expect(resTherm.statusCode).toBe(200);

    const resFan = mockRes();
    await powerController.getFanInfo({}, resFan);
    expect(resFan.statusCode).toBe(200);

    const badFanSet = mockRes();
    await powerController.setFanSpeed({ body: {} }, badFanSet);
    expect(badFanSet.statusCode).toBe(400);

    const goodFanSet = mockRes();
    await powerController.setFanSpeed({ body: { device: 'hwmon0', fan: 1, pwm: 150 } }, goodFanSet);
    expect(goodFanSet.statusCode).toBe(200);

    const resStats = mockRes();
    await powerController.getPowerStats({}, resStats);
    expect(resStats.statusCode).toBe(200);
  });
});

describe('MailController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getStatus, install, uninstall', async () => {
    jest.spyOn(mailService, 'getStatus').mockResolvedValue({ installed: true, running: true });
    jest.spyOn(mailService, 'install').mockResolvedValue(true);
    jest.spyOn(mailService, 'uninstall').mockResolvedValue(true);

    const resStatus = mockRes();
    await mailController.getStatus({}, resStatus);
    expect(resStatus.statusCode).toBe(200);

    const resInst = mockRes();
    await mailController.install({}, resInst);
    expect(resInst.statusCode).toBe(200);

    const resUninst = mockRes();
    await mailController.uninstall({}, resUninst);
    expect(resUninst.statusCode).toBe(200);
  });

  test('controlService validates input', async () => {
    const badRes = mockRes();
    await mailController.controlService({ body: {} }, badRes);
    expect(badRes.statusCode).toBe(400);

    jest.spyOn(mailService, 'controlService').mockResolvedValue(true);
    const goodRes = mockRes();
    await mailController.controlService({ body: { service: 'postfix', action: 'restart' } }, goodRes);
    expect(goodRes.statusCode).toBe(200);
  });

  test('account management endpoints', async () => {
    jest.spyOn(mailService, 'getAccounts').mockResolvedValue([{ email: 'user@example.com' }]);
    jest.spyOn(mailService, 'addAccount').mockResolvedValue(true);
    jest.spyOn(mailService, 'deleteAccount').mockResolvedValue(true);
    jest.spyOn(mailService, 'updatePassword').mockResolvedValue(true);

    const resGet = mockRes();
    await mailController.getAccounts({}, resGet);
    expect(resGet.statusCode).toBe(200);

    const badAdd = mockRes();
    await mailController.addAccount({ body: {} }, badAdd);
    expect(badAdd.statusCode).toBe(400);

    const goodAdd = mockRes();
    await mailController.addAccount({ body: { email: 'test@example.com', password: 'Pass' } }, goodAdd);
    expect(goodAdd.statusCode).toBe(200);

    const badDel = mockRes();
    await mailController.deleteAccount({ body: {} }, badDel);
    expect(badDel.statusCode).toBe(400);

    const goodDel = mockRes();
    await mailController.deleteAccount({ body: { email: 'test@example.com' } }, goodDel);
    expect(goodDel.statusCode).toBe(200);

    const badPw = mockRes();
    await mailController.updatePassword({ body: {} }, badPw);
    expect(badPw.statusCode).toBe(400);

    const goodPw = mockRes();
    await mailController.updatePassword({ body: { email: 'test@example.com', password: 'New' } }, goodPw);
    expect(goodPw.statusCode).toBe(200);
  });

  test('domain, queue, spam, ssl and logs endpoints', async () => {
    jest.spyOn(mailService, 'getDomains').mockResolvedValue(['example.com']);
    jest.spyOn(mailService, 'addDomain').mockResolvedValue(true);
    jest.spyOn(mailService, 'removeDomain').mockResolvedValue(true);
    jest.spyOn(mailService, 'getQueue').mockResolvedValue([]);
    jest.spyOn(mailService, 'flushQueue').mockResolvedValue(true);
    jest.spyOn(mailService, 'deleteFromQueue').mockResolvedValue(true);
    jest.spyOn(mailService, 'getSpamConfig').mockResolvedValue({ score: 5 });
    jest.spyOn(mailService, 'updateSpamConfig').mockResolvedValue(true);
    jest.spyOn(mailService, 'getSslInfo').mockResolvedValue([]);
    jest.spyOn(mailService, 'getLogs').mockResolvedValue(['postfix log line']);

    const resDom = mockRes();
    await mailController.getDomains({}, resDom);
    expect(resDom.statusCode).toBe(200);

    const badDomAdd = mockRes();
    await mailController.addDomain({ body: {} }, badDomAdd);
    expect(badDomAdd.statusCode).toBe(400);

    const goodDomAdd = mockRes();
    await mailController.addDomain({ body: { domain: 'mail.test' } }, goodDomAdd);
    expect(goodDomAdd.statusCode).toBe(200);

    const badDomRem = mockRes();
    await mailController.removeDomain({ body: {} }, badDomRem);
    expect(badDomRem.statusCode).toBe(400);

    const goodDomRem = mockRes();
    await mailController.removeDomain({ body: { domain: 'mail.test' } }, goodDomRem);
    expect(goodDomRem.statusCode).toBe(200);

    const resQueue = mockRes();
    await mailController.getQueue({}, resQueue);
    expect(resQueue.statusCode).toBe(200);

    const resFlush = mockRes();
    await mailController.flushQueue({}, resFlush);
    expect(resFlush.statusCode).toBe(200);

    const badDelQ = mockRes();
    await mailController.deleteFromQueue({ body: {} }, badDelQ);
    expect(badDelQ.statusCode).toBe(400);

    const goodDelQ = mockRes();
    await mailController.deleteFromQueue({ body: { queueId: 'msg-1' } }, goodDelQ);
    expect(goodDelQ.statusCode).toBe(200);

    const resSpam = mockRes();
    await mailController.getSpamConfig({}, resSpam);
    expect(resSpam.statusCode).toBe(200);

    const badSpamUp = mockRes();
    await mailController.updateSpamConfig({ body: {} }, badSpamUp);
    expect(badSpamUp.statusCode).toBe(400);

    const goodSpamUp = mockRes();
    await mailController.updateSpamConfig({ body: { requiredScore: 6.5 } }, goodSpamUp);
    expect(goodSpamUp.statusCode).toBe(200);

    const resSsl = mockRes();
    await mailController.getSslInfo({}, resSsl);
    expect(resSsl.statusCode).toBe(200);

    const resLogs = mockRes();
    await mailController.getLogs({ query: { service: 'postfix', lines: '20' } }, resLogs);
    expect(resLogs.statusCode).toBe(200);
  });
});
