/**
 * HTTP Telemetry & Metrics Collection Middleware
 * Records request volume, response status distributions, and latencies
 * for Prometheus / OpenMetrics scraping.
 */

class HttpMetricsCollector {
  constructor() {
    this.requestsTotal = new Map(); // key: `${method}|${route}|${status}` -> count
    this.durations = []; // sliding window of recent latencies in seconds (max 1000)
    this.maxDurationWindow = 1000;
  }

  /**
   * Normalize route paths to prevent high-cardinality label explosion
   */
  _normalizeRoute(req) {
    let route = req.baseUrl || req.path || '/';
    // Remove query string
    route = route.split('?')[0];

    // Collapse IDs, UUIDs, hashes, and mongo/hex IDs to :id
    route = route.replace(/\/[0-9a-fA-F]{24}(\/|$)/g, '/:id$1');
    route = route.replace(/\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(\/|$)/g, '/:id$1');
    route = route.replace(/\/\d+(\/|$)/g, '/:id$1');
    route = route.replace(/\/mem_\d+_[a-z0-9]+(\/|$)/g, '/:id$1');

    return route || '/';
  }

  middleware() {
    return (req, res, next) => {
      // Don't track the /metrics endpoint itself to prevent skewing
      if (req.path === '/metrics' || req.path === '/api/metrics') {
        return next();
      }

      const start = process.hrtime.bigint();

      res.on('finish', () => {
        const end = process.hrtime.bigint();
        const durationSec = Number(end - start) / 1e9;

        const method = req.method || 'GET';
        const route = this._normalizeRoute(req);
        const status = String(res.statusCode || 200);

        const key = `${method}|${route}|${status}`;
        this.requestsTotal.set(key, (this.requestsTotal.get(key) || 0) + 1);

        if (this.durations.length >= this.maxDurationWindow) {
          this.durations.shift();
        }
        this.durations.push(durationSec);
      });

      next();
    };
  }

  getMetricsSummary() {
    const sorted = [...this.durations].sort((a, b) => a - b);
    const count = sorted.length;

    const p50 = count > 0 ? sorted[Math.floor(count * 0.5)] : 0;
    const p90 = count > 0 ? sorted[Math.floor(count * 0.9)] : 0;
    const p99 = count > 0 ? sorted[Math.floor(count * 0.99)] : 0;
    const sum = sorted.reduce((acc, d) => acc + d, 0);

    const requests = [];
    for (const [key, cnt] of this.requestsTotal.entries()) {
      const [method, route, status] = key.split('|');
      requests.push({ method, route, status, count: cnt });
    }

    return {
      requests,
      count,
      sum,
      p50,
      p90,
      p99,
    };
  }

  reset() {
    this.requestsTotal.clear();
    this.durations = [];
  }
}

export const httpMetrics = new HttpMetricsCollector();
export const metricsMiddleware = httpMetrics.middleware();
export default httpMetrics;
