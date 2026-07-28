/**
 * Integration test: git-deployer stash/pop logic
 *
 * Tests the auto-stash-before-deploy and stash-pop-after-deploy flow
 * by creating temporary git repositories with controlled dirty states.
 *
 * The test verifies:
 * 1. Clean repo → no stash, no pop
 * 2. Dirty repo (uncommitted changes) → stash happens, script runs, pop restores
 * 3. Stash pop conflict → conflict is detected and stash ref is preserved
 *
 * Uses real git commands (like the actual webhook handler does).
 */

// ── Environment setup ──
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'jest-gitdeploy-test-secret-' + Date.now();
process.env.JWT_REFRESH_SECRET = 'jest-gitdeploy-refresh-secret-' + Date.now();
process.env.APP_SECRET = 'jest-gitdeploy-app-secret-' + Date.now();

import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Create a temporary directory and initialize a git repo in it.
 * Returns { root, file } where file is a path to an existing tracked file.
 */
function createGitRepo() {
  const root = resolve(tmpdir(), `gitdeploy-test-${randomUUID()}`);
  mkdirSync(root, { recursive: true });

  // Init git
  execSync('git init', { cwd: root });
  execSync('git config user.email "test@test.local"', { cwd: root });
  execSync('git config user.name "Test"', { cwd: root });

  // Create initial commit on main branch
  const initialFile = resolve(root, 'README.md');
  writeFileSync(initialFile, '# Test Repo\n');
  execSync('git add -A', { cwd: root });
  execSync('git commit -m "Initial commit"', { cwd: root });

  return { root, initialFile };
}

/**
 * Get the current git status porcelain output for a repo.
 */
async function getGitStatus(cwd) {
  try {
    const { stdout } = await execAsync('git status --porcelain', { cwd });
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Get number of stashes in the repo.
 */
async function stashCount(cwd) {
  try {
    const { stdout } = await execAsync('git stash list', { cwd });
    return stdout.trim() ? stdout.trim().split('\n').length : 0;
  } catch {
    return 0;
  }
}

/**
 * Simulate the webhook handler's stash/pop logic.
 * This mirrors the exact logic from plugins/git-deployer/index.js
 * to allow testing without spinning up the full Express app.
 */
async function simulateDeploy(repoPath, script) {
  let stashed = false;
  let stashRef = '';
  let stashConflict = false;
  let status = 'success';
  let output = '';

  // Phase 1: Stash dirty changes
  try {
    const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd: repoPath });
    if (statusOut.trim()) {
      await execAsync('git stash push -m "auto-stash-before-deploy"', { cwd: repoPath });
      stashed = true;
      const { stdout: hashOut } = await execAsync('git stash list --format="%H" -1', { cwd: repoPath });
      stashRef = hashOut.trim();
      output += '[INFO] Local changes stashed before deploy. Stash ref: ' + stashRef + '\n';
    }
  } catch (_) {
    // Not a git repo or git not available
  }

  // Phase 2: Run deploy script
  try {
    const { stdout, stderr } = await execAsync(script, { cwd: repoPath });
    output += stdout + '\n' + stderr;
  } catch (err) {
    status = 'error';
    output += err.message + '\n' + (err.stdout || '') + '\n' + (err.stderr || '');
  }

  // Phase 3: Restore stashed changes
  if (stashed) {
    try {
      const { stdout: popOut, stderr: popErr } = await execAsync('git stash pop', { cwd: repoPath });
      output += '\n[INFO] Stashed changes restored after deploy.\n' + popOut;
      if (popErr) output += '\n' + popErr;
    } catch (popErr) {
      stashConflict = true;
      status = 'warning';
      output += '\n[CONFLICT] Stash pop failed — merge conflict detected!';
      output += '\n[CONFLICT] Stash ref: ' + stashRef;
      output += '\n[CONFLICT] Error: ' + popErr.message;
    }
  }

  return { stashed, stashRef, stashConflict, status, output };
}

// ═══════════════════════════════════════════════════════════
//  TEST SUITES
// ═══════════════════════════════════════════════════════════

describe('git-deployer stash/pop logic', () => {

  let repo;

  afterEach(() => {
    // Cleanup temp repo
    if (repo?.root && existsSync(repo.root)) {
      try { rmSync(repo.root, { recursive: true, force: true }); } catch {}
    }
  });

  // ─────────────────────────────────────────────────────────
  //  SCENARIO 1: Clean repo — no stash, no pop
  // ─────────────────────────────────────────────────────────

  test('Clean repo — no stash, script runs normally', async () => {
    repo = createGitRepo();

    // Script that creates a new file (like a deploy would)
    const script = `node -e "require('fs').writeFileSync('deploy-output.txt', '')"`;

    const result = await simulateDeploy(repo.root, script);

    // Should NOT have stashed
    expect(result.stashed).toBe(false);
    expect(result.stashRef).toBe('');
    expect(result.stashConflict).toBe(false);
    expect(result.status).toBe('success');

    // No stashes created
    expect(await stashCount(repo.root)).toBe(0);

    // Deploy output file should exist
    expect(existsSync(resolve(repo.root, 'deploy-output.txt'))).toBe(true);
  });

  // ─────────────────────────────────────────────────────────
  //  SCENARIO 2: Dirty repo — stash before deploy, pop after
  // ─────────────────────────────────────────────────────────

  test('Dirty repo — stashes changes, deploys, then restores', async () => {
    repo = createGitRepo();

    // Make some uncommitted changes (simulating plugin install, config edits, etc.)
    writeFileSync(resolve(repo.root, 'local-config.txt'), 'my-local-change\n');
    // Also modify the tracked README.md
    const readmePath = resolve(repo.root, 'README.md');
    const originalReadme = readFileSync(readmePath, 'utf-8');
    writeFileSync(readmePath, originalReadme + '\n## Local Edit\n');

    // Verify repo is dirty
    const dirtyStatus = await getGitStatus(repo.root);
    expect(dirtyStatus).not.toBe('');

    // Script that creates a deploy artifact (like git pull would)
    const script = 'echo "build-artifact" > dist.txt';

    const result = await simulateDeploy(repo.root, script);

    // Should have stashed
    expect(result.stashed).toBe(true);
    expect(result.stashRef).toMatch(/^[a-f0-9]{40}$/); // SHA hash
    expect(result.stashConflict).toBe(false);
    expect(result.status).toBe('success');

    // Output should mention stash
    expect(result.output).toContain('[INFO] Local changes stashed before deploy');
    expect(result.output).toContain('[INFO] Stashed changes restored after deploy');

    // Deploy artifact should exist
    expect(existsSync(resolve(repo.root, 'dist.txt'))).toBe(true);

    // Stashed changes should be restored — local-config.txt should still exist
    expect(existsSync(resolve(repo.root, 'local-config.txt'))).toBe(true);
    expect(readFileSync(resolve(repo.root, 'local-config.txt'), 'utf-8')).toContain('my-local-change');

    // README should have the local edit restored
    const restoredReadme = readFileSync(readmePath, 'utf-8');
    expect(restoredReadme).toContain('## Local Edit');

    // Repo should be clean (no stashes left, no pending changes from stash pop)
    expect(await stashCount(repo.root)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────
  //  SCENARIO 3: Dirty repo with deploy modifying same files → conflict
  // ─────────────────────────────────────────────────────────

  test('Deploy modifies same file as local changes — detects stash conflict', async () => {
    repo = createGitRepo();

    // Make local changes to README.md (the tracked file)
    const readmePath = resolve(repo.root, 'README.md');
    writeFileSync(readmePath, '# My Local Version\n');

    // Script that also modifies README.md (simulating git pull with upstream changes)
    // We need the deploy script to create a conflicting change.
    // Since we stashed the local change first, the deploy runs on the CLEAN state.
    // Then git stash pop tries to apply the local change on top of the deploy's changes.
    // If the deploy modifies the same area as the local change → conflict!
    const script = [
      'echo "# Deploy Version (conflicting)" > README.md',
    ].join(' && ');

    const result = await simulateDeploy(repo.root, script);

    // The deploy script succeeds (overwrites README on the clean state)
    expect(result.status).toBe('warning'); // warning because stash pop failed

    // When stash pop runs, it tries to apply "# My Local Version" on top of
    // "# Deploy Version (conflicting)" — these will conflict because git
    // sees both as modifications to the tracked README.md.
    //
    // Note: git stash pop uses a 3-way merge. If the files are completely
    // different (no common parent lines), git will auto-resolve by taking
    // the stashed version or the working version. Let's detect if a conflict
    // actually occurred or if git auto-resolved.
    if (result.stashConflict) {
      // ✅ Conflict detected as expected
      expect(result.stashConflict).toBe(true);
      expect(result.output).toContain('[CONFLICT] Stash pop failed');
      expect(result.stashRef).toMatch(/^[a-f0-9]{40}$/);

      // Stash should still exist (not popped)
      expect(await stashCount(repo.root)).toBe(1);

      // Verify stash discarding works
      const { stdout: dropOut } = await execAsync('git stash drop', { cwd: repo.root });
      expect(dropOut).toContain('Dropped');
      expect(await stashCount(repo.root)).toBe(0);

    } else {
      // Git auto-resolved (happens when changes are in non-overlapping areas)
      // This is acceptable behavior — the important thing is no data loss
      console.log('  [INFO] Git auto-resolved the conflict (no manual intervention needed)');
      expect(result.stashed).toBe(true);
      expect(result.output).toContain('[INFO] Stashed changes restored after deploy');
      expect(await stashCount(repo.root)).toBe(0);
    }
  });

  // ─────────────────────────────────────────────────────────
  //  SCENARIO 4: No git repo — gracefully continues
  // ─────────────────────────────────────────────────────────

  test('Non-git directory — gracefully handles missing git repo', async () => {
    const nonGitDir = resolve(tmpdir(), `gitdeploy-nongit-${randomUUID()}`);
    mkdirSync(nonGitDir, { recursive: true });

    const script = 'echo "works without git"';

    const result = await simulateDeploy(nonGitDir, script);

    // Should not crash — stash is skipped, script runs
    expect(result.stashed).toBe(false);
    expect(result.status).toBe('success');
    expect(result.output).toContain('works without git');

    // Cleanup
    try { rmSync(nonGitDir, { recursive: true, force: true }); } catch {}
  });

  // ─────────────────────────────────────────────────────────
  //  SCENARIO 5: Script failure with dirty repo — stash still restored
  // ─────────────────────────────────────────────────────────

  test('Script fails but stashed changes are still restored', async () => {
    repo = createGitRepo();

    // Modify a TRACKED file so git stash actually has content to stash
    const readmePath = resolve(repo.root, 'README.md');
    const originalReadme = readFileSync(readmePath, 'utf-8');
    writeFileSync(readmePath, originalReadme + '\n## Local Edit\n');

    // Script that fails
    const script = 'exit 1';

    const result = await simulateDeploy(repo.root, script);

    // Script failed
    expect(result.status).toBe('error');

    // But stash should have been popped (restored)
    // because the stash pop runs regardless of script success/failure
    expect(result.stashConflict).toBe(false);
    expect(result.output).toContain('[INFO] Stashed changes restored after deploy');

    // Local changes should be restored
    const restoredReadme = readFileSync(readmePath, 'utf-8');
    expect(restoredReadme).toContain('## Local Edit');

    // No leftover stashes
    expect(await stashCount(repo.root)).toBe(0);
  });
});
