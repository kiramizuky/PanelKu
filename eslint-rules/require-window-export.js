/**
 * @fileoverview ESLint rule: require-window-export
 *
 * Detects `const ModuleName = { ... }` or `let ModuleName = (() => { ... })()`
 * declarations at module level without a matching `window.ModuleName = ModuleName;`
 * assignment anywhere in the same file.
 *
 * Why? In Panelku's architecture, client-side JS modules are loaded as `<script>` tags
 * in the browser. `const` and `let` at global scope create a global lexical variable but
 * do NOT set a property on `window`. Functions like `LP.call()` and inline
 * `onclick="Module.fn()"` resolve names via `window[name]`, so the module MUST be
 * explicitly assigned. (`var` at global scope DOES set a window property, so it's excluded.)
 *
 * @see scripts/check-window-assignment.js for the CI-gate version (also scans plugins' inline scripts)
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require window.ModuleName = ModuleName for module-level const/let declarations',
      recommended: false,
    },
    schema: [],
    messages: {
      missingWindowExport:
        'Module "{{name}}" is defined with const/let but missing matching ' +
        'window.{{name}} = {{name}}; assignment. ' +
        'LP.call() and inline onclick="..." will fail without it.',
    },
  },

  create(context) {
    /** Map<name, VariableDeclarator node> */
    const moduleDeclarations = new Map();

    /** Set<name> of window assignments found */
    const windowAssignments = new Set();

    return {
      /**
       * Collect top-level const/let declarations whose value is an ObjectExpression
       * or an IIFE (CallExpression wrapping an Arrow/Function expression).
       * These are the "module" patterns used across Panelku's client-side JS.
       */
      VariableDeclarator(node) {
        // Only module-level (Program scope) const/let declarations
        const parentDecl = node.parent;
        if (!parentDecl || parentDecl.type !== 'VariableDeclaration') return;
        if (parentDecl.kind !== 'const' && parentDecl.kind !== 'let') return;

        const grandParent = parentDecl.parent;
        if (!grandParent) return;
        if (grandParent.type !== 'Program' && grandParent.type !== 'ExportNamedDeclaration') {
          return;
        }

        // Must have an identifier name
        if (!node.id || node.id.type !== 'Identifier') return;
        if (!node.init) return;

        const name = node.id.name;

        // Detect module patterns: ObjectExpression or IIFE (CallExpression)
        const isModule =
          node.init.type === 'ObjectExpression' ||
          (node.init.type === 'CallExpression' &&
            (node.init.callee.type === 'ArrowFunctionExpression' ||
             node.init.callee.type === 'FunctionExpression'));

        if (isModule) {
          moduleDeclarations.set(name, node);
        }
      },

      /**
       * Collect `window.X = X;` assignments.
       * Handles both top-level and nested (inside DOMContentLoaded, IIFE, etc.).
       */
      AssignmentExpression(node) {
        if (
          node.left.type === 'MemberExpression' &&
          node.left.object.type === 'Identifier' &&
          node.left.object.name === 'window' &&
          node.left.property.type === 'Identifier' &&
          node.right.type === 'Identifier' &&
          node.left.property.name === node.right.name
        ) {
          windowAssignments.add(node.left.property.name);
        }
      },

      /** Final check — report missing window exports */
      'Program:exit'() {
        for (const [name, declNode] of moduleDeclarations) {
          if (!windowAssignments.has(name)) {
            context.report({
              node: declNode,
              messageId: 'missingWindowExport',
              data: { name },
            });
          }
        }
      },
    };
  },
};
