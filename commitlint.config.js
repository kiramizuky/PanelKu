/**
 * [8.4] Commitlint — Conventional Commits enforced in husky commit-msg hook.
 * Extends the conventional config and adds the commit types this repo uses
 * (including scoped prefixes like fix(security), chore(ci), docs, test).
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Conventional defaults already allow: build, chore, ci, docs, feat, fix,
    // perf, refactor, revert, style, test. Add the ones used in this repo's history:
    'type-enum': [
      2,
      'always',
      ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test', 'security'],
    ],
    // Panelku commits use scopes like (security), (ci), (deps), (deps-dev), (plugins)
    'scope-empty': [1, 'never'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0], // allow long doc links in body
  },
};
