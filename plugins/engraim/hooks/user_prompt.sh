#!/usr/bin/env bash
# UserPromptSubmit: two proactive nudges on every prompt — (1) a calibrate reflex when the
# message reads like durable project-wide feedback ("from now on", "always remember", ...),
# and (2) a throttled backlog reminder so long sessions still resurface curate/retro/skill
# upkeep. Deterministic; the model decides whether to act. Silent when nothing applies.
set -euo pipefail
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cat | NODE_NO_WARNINGS=1 node "$PLUGIN_ROOT/server/cli.mjs" user-prompt 2>/dev/null || true
exit 0
