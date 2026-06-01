#!/bin/bash
# SessionStart hook — prepares the repo so tests run immediately in a fresh
# Claude Code on the web container. Idempotent and non-interactive.
set -euo pipefail

# Only needed in the remote (web) environment; local dev already has deps.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Install dependencies (npm install benefits from the cached container state).
npm install --no-audit --no-fund
