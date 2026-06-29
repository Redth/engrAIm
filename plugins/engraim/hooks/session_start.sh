#!/usr/bin/env bash
# SessionStart: bootstrap .engraim/ from templates (first run), run the schema/migration
# handshake, and inject the frame snapshot into context. Robust logic lives in cli.mjs.
set -euo pipefail
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cat | NODE_NO_WARNINGS=1 node "$PLUGIN_ROOT/server/cli.mjs" session-start --plugin-root "$PLUGIN_ROOT" 2>/dev/null || true
