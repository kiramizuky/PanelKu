import { jest } from '@jest/globals';
import copilotService from '../src/modules/terminal/copilot.service.js';
import anomalyDetectorService from '../src/modules/ai-repair/anomaly-detector.service.js';
import snapshotService from '../src/modules/backup/snapshot.service.js';
import prometheusService from '../src/modules/monitor/prometheus.service.js';
import k8sService from '../src/modules/cluster/k8s.service.js';
import { getDb } from '../src/core/db/sqlite.js';

describe('Fase 3: Terminal AI Copilot & Anomaly Detector', () => {
  beforeAll(() => {
    getDb();
  });

  test('Copilot translates natural language to safe Linux commands', async () => {
    const res = await copilotService.generateCommand('find large files above 100mb');
    expect(res).toBeDefined();
    expect(res.command).toContain('find');
    expect(res.safety.riskLevel).toBe('low');
    expect(res.safety.isSafe).toBe(true);
    expect(res.explanation).toBeTruthy();
  });

  test('Copilot detects destructive commands and triggers safety guardrail', async () => {
    const safety = copilotService.assessSafety('rm -rf / --no-preserve-root');
    expect(safety.isSafe).toBe(false);
    expect(safety.riskLevel).toBe('critical');
    expect(safety.requiresConfirmation).toBe(true);
    expect(safety.warnings.length).toBeGreaterThan(0);
  });

  test('Copilot explains shell command arguments and flags', async () => {
    const res = await copilotService.explainCommand('tar -czf backup.tar.gz /var/www');
    expect(res.breakdown).toBeDefined();
    expect(res.breakdown.length).toBeGreaterThan(1);
    expect(res.summary).toContain('tar');
  });

  test('Anomaly detector scans system telemetry and creates RCA incident reports', async () => {
    const scan = await anomalyDetectorService.scanLogAnomalies();
    expect(scan).toBeDefined();
    expect(scan.anomalies).toBeInstanceOf(Array);

    const rca = await anomalyDetectorService.createIncidentReport({
      title: 'PHP-FPM Pool Failure Alert',
      incidentType: 'SERVICE_CRASH',
      severity: 'high',
      summary: 'PHP-FPM worker pool exceeded maximum children limit.',
      rootCause: 'Sudden traffic spike causing memory pressure.',
      remediationAction: 'Restarted php8.2-fpm and doubled pm.max_children',
    });

    expect(rca).toBeDefined();
    expect(rca.id).toBeTruthy();
    expect(rca.status).toBe('resolved');

    const list = await anomalyDetectorService.listIncidentReports(5);
    expect(list.some(r => r.id === rca.id)).toBe(true);
  });
});

describe('Fase 4: Instant Volume Snapshots & Rollback', () => {
  test('Creates, verifies, and manages volume snapshot points', async () => {
    const snapshot = await snapshotService.createSnapshot('test_unit_snap', './src', 'Unit test snapshot point');
    expect(snapshot).toBeDefined();
    expect(snapshot.id).toBeTruthy();
    expect(snapshot.name).toBe('test_unit_snap');

    const verify = await snapshotService.verifySnapshot(snapshot.id);
    expect(verify.isValid).toBe(true);

    const rollback = await snapshotService.rollbackSnapshot(snapshot.id);
    expect(rollback.success).toBe(true);

    const list = await snapshotService.listSnapshots();
    expect(list.some(s => s.id === snapshot.id)).toBe(true);

    const del = await snapshotService.deleteSnapshot(snapshot.id);
    expect(del.success).toBe(true);
  });
});

describe('Fase 5: Prometheus Exporter & Kubernetes Inspector', () => {
  test('Prometheus service produces OpenMetrics compliant metrics stream', async () => {
    const metrics = await prometheusService.getMetrics();
    expect(typeof metrics).toBe('string');
    expect(metrics).toContain('node_cpu_count');
    expect(metrics).toContain('node_memory_bytes_total');
    expect(metrics).toContain('panelku_waf_rules_total');
  });

  test('K8s service returns cluster state structure safely even without cluster', async () => {
    const summary = await k8sService.getClusterSummary();
    expect(summary).toBeDefined();
    expect(typeof summary.installed).toBe('boolean');
    expect(summary.nodes).toBeInstanceOf(Array);
    expect(summary.pods).toBeInstanceOf(Array);
    expect(summary.services).toBeInstanceOf(Array);
  });
});
