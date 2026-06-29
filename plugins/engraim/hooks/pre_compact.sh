#!/usr/bin/env bash
# PreCompact: harvest before mid-session context is dropped, so long sessions don't lose
# early learnings before Stop fires. v0 stages the transcript like Stop does.
set -euo pipefail
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cat | NODE_NO_WARNINGS=1 node "$PLUGIN_ROOT/server/cli.mjs" stage-session --reason precompact >/dev/null 2>&1 || true
exit 0
