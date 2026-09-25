/**
 * Prometheus / OpenMetrics Metrics Exporter Service (Fase 5 & Sprint 4)
 */
import os from 'os';
import { getDb } from '../../core/db/sqlite.js';
import dockerService from '../docker/docker.service.js';
import queueManager from '../../core/queue/QueueManager.js';
import httpMetrics from '../../middleware/metrics.middleware.js';

class PrometheusService {
  /**
   * Render Prometheus text-based OpenMetrics format
   */
  async getMetrics() {
    const lines = [];

    // ── System Host Metrics ──
    const cpus = os.cpus();
    const cpuCount = cpus.length || 1;
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const uptimeSec = os.uptime();

    lines.push('# HELP node_cpu_count Total number of CPU cores');
    lines.push('# TYPE node_cpu_count gauge');
    lines.push(`node_cpu_count ${cpuCount}`);

    lines.push('# HELP node_load1 1-minute load average');
    lines.push('# TYPE node_load1 gauge');
    lines.push(`node_load1 ${loadAvg[0].toFixed(2)}`);

    lines.push('# HELP node_load5 5-minute load average');
    lines.push('# TYPE node_load5 gauge');
    lines.push(`node_load5 ${loadAvg[1].toFixed(2)}`);

    lines.push('# HELP node_load15 15-minute load average');
    lines.push('# TYPE node_load15 gauge');
    lines.push(`node_load15 ${loadAvg[2].toFixed(2)}`);

    lines.push('# HELP node_memory_bytes_total Total physical memory in bytes');
    lines.push('# TYPE node_memory_bytes_total gauge');
    lines.push(`node_memory_bytes_total ${totalMem}`);

    lines.push('# HELP node_memory_bytes_used Used memory in bytes');
    lines.push('# TYPE node_memory_bytes_used gauge');
    lines.push(`node_memory_bytes_used ${usedMem}`);

    lines.push('# HELP node_memory_bytes_free Free memory in bytes');
    lines.push('# TYPE node_memory_bytes_free gauge');
    lines.push(`node_memory_bytes_free ${freeMem}`);

    lines.push('# HELP node_uptime_seconds System uptime in seconds');
    lines.push('# TYPE node_uptime_seconds counter');
    lines.push(`node_uptime_seconds ${Math.floor(uptimeSec)}`);

    // ── Node.js Process Telemetry ──
    const mem = process.memoryUsage();
    lines.push('# HELP panelku_process_uptime_seconds Node process uptime in seconds');
    lines.push('# TYPE panelku_process_uptime_seconds counter');
    lines.push(`panelku_process_uptime_seconds ${Math.floor(process.uptime())}`);

    lines.push('# HELP panelku_process_memory_heap_used_bytes Node heap memory used in bytes');
    lines.push('# TYPE panelku_process_memory_heap_used_bytes gauge');
    lines.push(`panelku_process_memory_heap_used_bytes ${mem.heapUsed}`);

    lines.push('# HELP panelku_process_memory_heap_total_bytes Node heap memory allocated in bytes');
    lines.push('# TYPE panelku_process_memory_heap_total_bytes gauge');
    lines.push(`panelku_process_memory_heap_total_bytes ${mem.heapTotal}`);

    lines.push('# HELP panelku_process_memory_rss_bytes Node resident set size in bytes');
    lines.push('# TYPE panelku_process_memory_rss_bytes gauge');
    lines.push(`panelku_process_memory_rss_bytes ${mem.rss}`);

    // ── Panelku Application Metrics ──
    const db = getDb();

    // WAF Rules & Security Metrics
    let wafRulesCount = 0;
    try {
      wafRulesCount = db.prepare('SELECT COUNT(*) as c FROM waf_rules').get()?.c || 0;
    } catch {
      // ignore
    }
    lines.push('# HELP panelku_waf_rules_total Total WAF active blocking rules');
    lines.push('# TYPE panelku_waf_rules_total gauge');
    lines.push(`panelku_waf_rules_total ${wafRulesCount}`);

    // Users count
    let usersCount = 1;
    try {
      usersCount = db.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 1;
    } catch {
      // ignore
    }
    lines.push('# HELP panelku_users_total Total registered users');
    lines.push('# TYPE panelku_users_total gauge');
    lines.push(`panelku_users_total ${usersCount}`);

    // Docker Containers Metrics
    try {
      const summary = await dockerService.getDashboardSummary();
      if (summary) {
        lines.push('# HELP panelku_docker_containers_total Total Docker containers');
        lines.push('# TYPE panelku_docker_containers_total gauge');
        lines.push(`panelku_docker_containers_total ${summary.containers || 0}`);

        lines.push('# HELP panelku_docker_containers_running Running Docker containers');
        lines.push('# TYPE panelku_docker_containers_running gauge');
        lines.push(`panelku_docker_containers_running ${summary.containersRunning || 0}`);

        lines.push('# HELP panelku_docker_containers_stopped Stopped Docker containers');
        lines.push('# TYPE panelku_docker_containers_stopped gauge');
        lines.push(`panelku_docker_containers_stopped ${summary.containersStopped || 0}`);
      }
    } catch {
      // Docker may not be installed/reachable
    }

    // ── Queue Metrics (BullMQ / In-Memory Worker) ──
    try {
      const queueMetrics = await queueManager.getAllQueueMetrics();
      lines.push('# HELP panelku_queue_jobs Background queue jobs count by state');
      lines.push('# TYPE panelku_queue_jobs gauge');

      for (const [qName, counts] of Object.entries(queueMetrics)) {
        lines.push(`panelku_queue_jobs{queue="${qName}",status="waiting"} ${counts.waiting || 0}`);
        lines.push(`panelku_queue_jobs{queue="${qName}",status="active"} ${counts.active || 0}`);
        lines.push(`panelku_queue_jobs{queue="${qName}",status="completed"} ${counts.completed || 0}`);
        lines.push(`panelku_queue_jobs{queue="${qName}",status="failed"} ${counts.failed || 0}`);
      }
    } catch {
      // Queue metrics collection fallback
    }

    // ── HTTP Traffic & Latency Metrics ──
    try {
      const httpSummary = httpMetrics.getMetricsSummary();
      lines.push('# HELP panelku_http_requests_total Total HTTP requests handled');
      lines.push('# TYPE panelku_http_requests_total counter');

      for (const req of httpSummary.requests) {
        lines.push(`panelku_http_requests_total{method="${req.method}",route="${req.route}",status="${req.status}"} ${req.count}`);
      }

      lines.push('# HELP panelku_http_request_duration_seconds HTTP request latency percentiles in seconds');
      lines.push('# TYPE panelku_http_request_duration_seconds summary');
      lines.push(`panelku_http_request_duration_seconds{quantile="0.5"} ${httpSummary.p50.toFixed(4)}`);
      lines.push(`panelku_http_request_duration_seconds{quantile="0.9"} ${httpSummary.p90.toFixed(4)}`);
      lines.push(`panelku_http_request_duration_seconds{quantile="0.99"} ${httpSummary.p99.toFixed(4)}`);
      lines.push(`panelku_http_request_duration_seconds_count ${httpSummary.count}`);
      lines.push(`panelku_http_request_duration_seconds_sum ${httpSummary.sum.toFixed(4)}`);
    } catch {
      // HTTP telemetry fallback
    }

    lines.push('');
    return lines.join('\n');
  }
}

export default new PrometheusService();
