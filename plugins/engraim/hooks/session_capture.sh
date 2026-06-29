#!/usr/bin/env bash
# Stop: stage the just-finished session transcript for curation. Cheap + deterministic;
# model-driven distillation happens later via /engraim:curate.
set -euo pipefail
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cat | NODE_NO_WARNINGS=1 node "$PLUGIN_ROOT/server/cli.mjs" stage-session >/dev/null 2>&1 || true
exit 0
