---
description: Bootstrap EngrAIm memory from this project's historical Claude Code sessions (before the plugin was installed).
---
Cold-start the workspace from past work.

1. Locate this project's transcript history under `~/.claude/projects/<url-encoded-cwd>/` (the folder name is the project's absolute path with `/` replaced). List the `*.jsonl` session files, newest first.
2. There may be many; process the most recent N (ask the user how far back, default 10) to avoid huge token cost. Note that Claude Code eventually trims old transcripts, so older work may already be gone.
3. For each session, follow the `engraim-curate` skill: `ingest_session` for a mechanical pass, then distill durable facts + wiki pages with `session_id` provenance.
4. Report what was bootstrapped (pages created, facts added) and suggest re-running periodically to catch sessions before they're garbage-collected.
