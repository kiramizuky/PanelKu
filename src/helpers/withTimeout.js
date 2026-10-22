/**
 * Promise timeout helper for slow host probes.
 *
 * systeminformation can block for seconds on a busy host (SMART, process list,
 * network connections). A stuck probe must not hold the WebSocket broadcast or
 * the HTTP fallback forever, so every SI call is bounded.
 */
export const SI_TIMEOUT_MS = Math.max(500, Number.parseInt(process.env.SI_TIMEOUT_MS || '3000', 10) || 3000);

export function withTimeout(promise, ms = SI_TIMEOUT_MS, label = 'operation') {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve(promise);

  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), { code: 'ETIMEDOUT', label }));
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

export function siCall(factory, label) {
  return withTimeout(Promise.resolve().then(factory), SI_TIMEOUT_MS, label);
}

export default withTimeout;
