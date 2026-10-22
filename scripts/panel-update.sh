#!/usr/bin/env bash
# ============================================================
# Panelku — Detached Update Supervisor
#
# Started by the panel (usually through systemd-run) before the update.
# It keeps running when the panel restarts, writes progress to
# storage/update_state.json, waits for /api/health and rolls back when the
# new commit does not boot within the timeout.
#
# The Node worker does the heavy lifting so the update logic stays in one
# place (updater.service.js) and is covered by the Jest suite.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${PANELKU_NODE_BIN:-$(command -v node || true)}"

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "[panel-update] node binary not found (set PANELKU_NODE_BIN)" >&2
  exit 1
fi

if [ ! -f "$SCRIPT_DIR/panel-update-worker.mjs" ]; then
  echo "[panel-update] worker script missing: $SCRIPT_DIR/panel-update-worker.mjs" >&2
  exit 1
fi

exec "$NODE_BIN" "$SCRIPT_DIR/panel-update-worker.mjs" "$@"
