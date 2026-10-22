/**
 * CSP-safe inline event handler migration.
 *
 * Historically the panel used `onclick="..."`-style attributes, which require
 * `script-src-attr 'unsafe-inline'` (nonces do not apply to attributes). This
 * post-render transformer rewrites every static handler in server-rendered HTML
 * into a `data-lp-handler` marker plus a nonced inline script that attaches the
 * equivalent listener with `addEventListener`.
 *
 * Dynamic HTML built by client-side JavaScript is migrated separately through
 * `LP.registerInlineHandler()` in public/js/app.js, so the browser never needs
 * attribute handlers.
 */

const HANDLER_ATTR_RE = /(\s)(on[a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

const NAMED_ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
  nbsp: '\u00a0',
};

const decodeHtmlAttribute = (value) => String(value || '').replace(
  /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
  (match, entity) => {
    const key = entity.toLowerCase();
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
  }
);

function findTagEnd(html, start) {
  let quote = null;
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

/**
 * Mask the *bodies* of script/style tags and HTML comments. The surrounding
 * tags stay in place so the nonce injector can still process them.
 */
function maskOpaqueContent(html) {
  const saved = [];
  const store = (content) => {
    const token = `\u0000LP_CSP_${saved.length}\u0000`;
    saved.push(content);
    return token;
  };

  let output = html.replace(
    /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
    (match, open, body, close) => open + store(body) + close
  );
  output = output.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (match, open, body, close) => open + store(body) + close
  );
  output = output.replace(/<!--[\s\S]*?-->/g, (comment) => store(comment));

  return {
    html: output,
    restore(value) {
      return value.replace(/\u0000LP_CSP_(\d+)\u0000/g, (match, index) => saved[Number(index)] ?? '');
    },
  };
}

function appendHandlerScript(html, handlers, nonce) {
  if (!handlers.length) return html;

  const bindings = handlers.map((handler) => {
    const safeCode = String(handler.code).replace(/<\/script/gi, '<\\/script');
    return `  (function () {
    var el = document.querySelector('[data-lp-handler~="${handler.id}"]');
    if (!el) return;
    var target = (el.tagName === 'BODY' && '${handler.event}' === 'load') ? window : el;
    target.addEventListener('${handler.event}', function (event) {
      try {
        var result = (function (event) {
${safeCode}
        }).call(el, event);
        if (result === false) event.preventDefault();
      } catch (err) {
        console.error('[CSP handler]', err);
      }
    }, false);
  })();`;
  }).join('\n');

  const script = `<script nonce="${nonce}">
(function () {
${bindings}
})();
</script>`;

  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${script}\n</body>`);
  }
  return `${html}\n${script}`;
}

/**
 * @param {string} html Rendered HTML.
 * @param {string} nonce Per-request CSP nonce.
 * @returns {string} HTML without inline event-handler attributes.
 */
export function migrateInlineHandlers(html, nonce) {
  if (typeof html !== 'string' || !html.includes('on')) return html;

  const masked = maskOpaqueContent(html);
  const handlers = [];
  let sequence = 0;

  let output = '';
  let cursor = 0;

  while (cursor < masked.html.length) {
    const lt = masked.html.indexOf('<', cursor);
    if (lt === -1) {
      output += masked.html.slice(cursor);
      break;
    }

    // Not a tag (for example a stray `<` in text): keep scanning.
    if (!/[a-z!/?]/i.test(masked.html[lt + 1] || '')) {
      output += masked.html.slice(cursor, lt + 1);
      cursor = lt + 1;
      continue;
    }

    const end = findTagEnd(masked.html, lt);
    if (end === -1) {
      output += masked.html.slice(cursor);
      break;
    }

    const tag = masked.html.slice(lt, end + 1);
    output += masked.html.slice(cursor, lt);

    // Closing tags, doctypes, comments (already masked), script and style tags
    // do not contain migratable handlers.
    if (/^<\s*[!/]/.test(tag) || /^<\s*(?:script|style)\b/i.test(tag)) {
      output += tag;
      cursor = end + 1;
      continue;
    }

    const handlerIds = [];
    const cleanedTag = tag.replace(HANDLER_ATTR_RE, (match, space, attr, doubleQuoted, singleQuoted, unquoted) => {
      const event = attr.slice(2).toLowerCase();
      const code = decodeHtmlAttribute(doubleQuoted ?? singleQuoted ?? unquoted ?? '');
      if (!code.trim()) return space;

      const id = `s${sequence++}`;
      handlerIds.push(id);
      handlers.push({ id, event, code });
      return '';
    });

    if (!handlerIds.length) {
      output += tag;
    } else {
      // One element can carry several handlers (for example mouseover +
      // mouseout + click). Keep a single, space-separated attribute so the
      // generated script can bind every event to the same element.
      const close = cleanedTag.lastIndexOf('>');
      const selfClosing = /\/\s*>$/.test(cleanedTag);
      const insertAt = selfClosing ? cleanedTag.lastIndexOf('/') : close;
      const before = cleanedTag.slice(0, insertAt).replace(/\s+$/, '');
      const after = cleanedTag.slice(insertAt);
      output += `${before} data-lp-handler="${handlerIds.join(' ')}"${after}`;
    }

    cursor = end + 1;
  }

  output = masked.restore(output);
  return appendHandlerScript(output, handlers, nonce);
}

export default { migrateInlineHandlers };
