/**
 * [CSP HARDEN] Nonce middleware for Content Security Policy.
 *
 * Generates a cryptographically random nonce per HTTP request,
 * stores it in res.locals.nonce, and automatically injects it
 * into inline <script> and <style> tags after EJS rendering.
 *
 * This allows CSP to use 'nonce-...' instead of 'unsafe-inline'
 * for scriptSrc and styleSrc, drastically reducing XSS surface area.
 *
 * Inline event handlers (onclick, onchange, etc.) still require
 * 'unsafe-inline' in scriptSrcAttr — those cannot use nonces.
 */

import crypto from 'crypto';

/**
 * Generates a CSP nonce and stores it on res.locals.
 * MUST be registered before helmet() in app.js so the
 * nonce is ready when helmet builds the CSP header.
 */
export const nonceMiddleware = (req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64url');
  next();
};

/**
 * Post-render hook that injects the nonce into all inline
 * <script> and <style> tags within the rendered HTML.
 *
 * Skips:
 *  - External scripts (<script src="...">)
 *  - Tags that already have a nonce attribute
 *
 * This avoids modifying every single EJS view file.
 */
export const nonceInjector = (req, res, next) => {
  const originalRender = res.render.bind(res);

  // Override res.render to intercept the rendered HTML
  res.render = (view, options = {}, callback) => {
    // Make nonce available in templates too (for manual use if needed)
    options.nonce = res.locals.nonce;

    // If a callback was passed (streaming / sub-renders), wrap it
    const wrappedCallback = typeof callback === 'function'
      ? (err, html) => callback(err, html)
      : undefined;

    // For the final render (no callback), inject nonce into the output
    if (!wrappedCallback) {
      return originalRender(view, options, (err, html) => {
        if (err) return res.send(err);
        res.send(injectNoncesIntoHtml(html, res.locals.nonce));
      });
    }

    return originalRender(view, options, wrappedCallback);
  };

  next();
};

/**
 * Regex-based HTML post-processor that adds nonce to inline
 * <script> and <style> tags.
 *
 * Pattern explanation:
 *   (<script|<style)  — capture opening tag name
 *   (                 — capture attributes (optional)
 *     \s              — must be preceded by whitespace
 *     [^>]*?          — any attributes, non-greedy
 *   )?                — attributes are optional
 *   >                 — close of opening tag
 *
 * We match the opening tag, check if it needs a nonce, and replace.
 */
function injectNoncesIntoHtml(html, nonce) {
  return html.replace(
    /<(script|style)(\s[^>]*?)?>/gi,
    (match, tagName, attrs) => {
      const attrStr = attrs || '';

      // Skip external scripts (they have src="...")
      if (tagName.toLowerCase() === 'script' && /\bsrc\s*=/i.test(attrStr)) {
        return match;
      }

      // Skip tags that already have a nonce attribute
      if (/\snonce\s*=/i.test(attrStr)) {
        return match;
      }

      // Inject the nonce
      return `<${tagName}${attrStr} nonce="${nonce}">`;
    }
  );
}
