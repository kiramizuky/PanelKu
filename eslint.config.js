/**
 * ESLint flat config — Panelku
 * ESLint v9+ flat config format.
 * Run: npx eslint src/
 */

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    destructuredArrayIgnorePattern: '^_',
    caughtErrors: 'none',
  }],
};

const nodeGlobals = {
  // Node.js built-ins
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  require: 'readonly',
  module: 'readonly',
  exports: 'readonly',
  global: 'readonly',
  globalThis: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  performance: 'readonly',
  structuredClone: 'readonly',
  queueMicrotask: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  fetch: 'readonly',
  WebSocket: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Headers: 'readonly',
  FormData: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  Error: 'readonly',
  TypeError: 'readonly',
  SyntaxError: 'readonly',
  ReferenceError: 'readonly',
  RangeError: 'readonly',
};

const browserGlobals = {
  // Browser standard
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  location: 'readonly',
  history: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  addEventListener: 'readonly',
  removeEventListener: 'readonly',
  dispatchEvent: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  MutationObserver: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  FormData: 'readonly',
  FileReader: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  performance: 'readonly',
  crypto: 'readonly',
  EventSource: 'readonly',
  WebSocket: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Element: 'readonly',
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLDivElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  HTMLIFrameElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLSelectElement: 'readonly',
  Node: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  WheelEvent: 'readonly',
  TouchEvent: 'readonly',
  PointerEvent: 'readonly',
  DragEvent: 'readonly',
  XMLHttpRequest: 'readonly',
  matchMedia: 'readonly',
  getComputedStyle: 'readonly',
  innerWidth: 'readonly',
  innerHeight: 'readonly',
  scrollY: 'readonly',
  scrollX: 'readonly',
  screen: 'readonly',
  // Panel globals (defined in layout via CDN or app.js)
  LP: 'readonly',
  bootstrap: 'readonly',
  io: 'readonly',
  // CDN-loaded library globals (loaded in EJS views via script tags)
  Chart: 'readonly',
  Terminal: 'readonly',
  FitAddon: 'readonly',
  // Page-specific globals (defined in individual page JS files)
  ThemesPage: 'readonly',
  prompt: 'readonly',
  event: 'readonly',
};

export default [
  // Ignore patterns
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'src/config/swagger.fixed.js',
      'src/config/swagger.js',
    ],
  },

  // Server-side code (src/ except public)
  {
    files: ['src/**/*.js'],
    ignores: ['src/public/**', 'src/config/swagger*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: { ...rules },
  },

  // Client-side code (src/public/js/)
  {
    files: ['src/public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: { ...rules },
  },

  // Scripts directory
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: { ...rules },
  },

  // Plugin directory
  {
    files: ['plugins/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...nodeGlobals,
        pluginApi: 'readonly',
        pluginLogger: 'readonly',
        pluginDb: 'readonly',
      },
    },
    rules: { ...rules },
  },
];
