import { describe, test, expect } from '@jest/globals';
import { migrateInlineHandlers } from '../src/middleware/cspHandlers.js';

describe('CSP static handler migration', () => {
  test('moves multiple handlers on one element into one delegated attribute', () => {
    const html = '<div id="x" onmouseover="a()" onmouseout="b()" onclick="c()">x</div>';
    const out = migrateInlineHandlers(html, 'test-nonce');

    expect(out).not.toMatch(/\son(?:mouseover|mouseout|click)\s*=/);
    expect((out.match(/data-lp-handler=/g) || []).length).toBe(1);
    expect(out).toContain('data-lp-handler="s0 s1 s2"');
    expect(out).toContain('[data-lp-handler~="s1"]');
    expect(out).toContain('test-nonce');
  });

  test('keeps self-closing tags valid and does not rewrite script bodies', () => {
    const html = '<img src="/x.png" onerror="fallback()"><script>window.x = "onclick";</script>';
    const out = migrateInlineHandlers(html, 'n');

    expect(out).toContain('<img src="/x.png" data-lp-handler="s0">');
    expect(out).toContain('window.x = "onclick";');
    expect(out).not.toContain('onerror="fallback()"');
  });
});
