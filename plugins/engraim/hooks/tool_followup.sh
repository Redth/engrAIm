#!/usr/bin/env bash
# PostToolUse: after a milestone memory action (calibrate / draft_skill / ingest_session /
# mark_onboarded), surface the natural next step — curate, retro, promote-skill, backfill —
# so the user never has to remember the follow-up. Silent when nothing applies.
set -euo pipefail
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cat | NODE_NO_WARNINGS=1 node "$PLUGIN_ROOT/server/cli.mjs" post-tool 2>/dev/null || true
exit 0
