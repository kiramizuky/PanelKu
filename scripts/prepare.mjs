/**
 * Cross-platform git hooks setup for development.
 * Gracefully exits 0 if husky is not installed (e.g. production / --omit=dev)
 * or if running in CI or non-dev environment.
 */
if (process.env.NODE_ENV !== 'production' && process.env.CI !== 'true') {
  try {
    const { default: husky } = await import('husky');
    if (typeof husky === 'function') {
      husky();
    }
  } catch {
    // husky not installed (e.g. npm ci --omit=dev), ignore cleanly
  }
}

