import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, 'locales');

export const DEFAULT_LOCALE = 'en';
export const SUPPORTED_LOCALES = ['en', 'id'];

const dictionaries = new Map();

function loadDictionaries() {
  for (const locale of SUPPORTED_LOCALES) {
    const filePath = path.join(LOCALES_DIR, `${locale}.json`);
    if (fs.existsSync(filePath)) {
      dictionaries.set(locale, JSON.parse(fs.readFileSync(filePath, 'utf8')));
    }
  }
}

loadDictionaries();

function resolveNestedKey(obj, key) {
  if (!obj || typeof key !== 'string') return undefined;
  return key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
}

/**
 * Resolve a translation key for a given locale, interpolating {{param}} tokens.
 * Falls back to DEFAULT_LOCALE ('en') and then the raw key.
 */
export function t(key, params = {}, locale = DEFAULT_LOCALE) {
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  let template = resolveNestedKey(dictionaries.get(safeLocale), key);
  if (template === undefined && safeLocale !== DEFAULT_LOCALE) {
    template = resolveNestedKey(dictionaries.get(DEFAULT_LOCALE), key);
  }
  if (typeof template !== 'string') return key;

  return template.replace(/\{\{(\w+)\}\}/g, (_, token) =>
    params[token] !== undefined ? String(params[token]) : `{{${token}}}`
  );
}

/**
 * Return the full locale dictionary merged over the English fallback.
 */
export function getDictionary(locale = DEFAULT_LOCALE) {
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  return {
    locale: safeLocale,
    supported: SUPPORTED_LOCALES,
    messages: dictionaries.get(safeLocale) || dictionaries.get(DEFAULT_LOCALE) || {},
  };
}

/**
 * Resolve preferred locale from request headers/query/cookies.
 */
export function resolveRequestLocale(req) {
  const candidates = [
    req.query?.lang,
    req.headers?.['x-locale'],
    req.cookies?.lp_locale,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && SUPPORTED_LOCALES.includes(c.toLowerCase())) {
      return c.toLowerCase();
    }
  }
  const accept = req.headers?.['accept-language'];
  if (typeof accept === 'string') {
    const primary = accept.split(',')[0]?.trim().slice(0, 2).toLowerCase();
    if (SUPPORTED_LOCALES.includes(primary)) {
      return primary;
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * Express middleware attaching req.locale, req.t, res.locals.locale, and res.locals.t.
 */
export function i18nMiddleware(req, res, next) {
  const locale = resolveRequestLocale(req);
  const translator = (key, params = {}) => t(key, params, locale);
  req.locale = locale;
  req.t = translator;
  if (res.locals) {
    res.locals.locale = locale;
    res.locals.t = translator;
  }
  next();
}

export default {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  t,
  getDictionary,
  resolveRequestLocale,
  i18nMiddleware,
};
