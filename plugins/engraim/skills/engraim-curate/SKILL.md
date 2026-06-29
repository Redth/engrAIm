---
name: engraim-curate
description: >
  Distill session transcripts into durable memory. Use when processing staged sessions
  (after the Stop hook), when the user runs /engraim:curate or /engraim:backfill, or
  whenever you should turn "what just happened" into lasting knowledge. Turns raw Claude
  Code session JSONL into wiki pages + temporal facts, with provenance and no secrets.
---

# Curate: transcript -> memory

Goal: turn raw session transcripts into a denser, more useful knowledge base — without hoarding the transcript itself.

## Inputs
- Staged sessions: `.engraim/pending/sessions.jsonl` (each line: `{session_id, transcript_path, ended_at, reason}`), or a specific `transcript_path`.
- Transcripts live under `~/.claude/projects/<url-encoded-project-path>/<session-id>.jsonl` — append-only JSONL of user/assistant messages, tool calls + results, and thinking blocks.

## Process (per session)
1. `ingest_session(transcript_path)` — mechanical first pass: registers the session as an immutable source and returns a digest (prompts, tool commands run, files touched, errors seen). This is scaffolding, not the distillation.
2. **You distill** from the transcript + digest:
   - **Decisions** made and *why* (the reasoning, not just the outcome).
   - **Fixes** that worked (problem -> root cause -> solution) — these are prime wiki-page material.
   - **Environment facts** learned (inventory, versions, conventions, quirks specific to THIS project/lab).
   - Skip: routine edits, dead ends with no lesson, anything already in memory.
3. **Write it down:**
   - `wiki_upsert(page, content, links)` for narrative/how-to knowledge; one page per entity/concept; cross-link with `[[wikilinks]]`. Fuzzy-check for an existing page before creating a near-duplicate.
   - `remember(observation, ...)` for atomic facts; set `source` to the `session_id`.
4. **Clear** the processed entries from the pending list; report a 2-3 line summary.

## Rules
- **Distill, don't dump.** A good session yields a handful of facts and 1-3 wiki edits, not a transcript copy.
- **No secrets.** Redact/skip API keys, tokens, passwords, private URLs seen in tool output.
- **Provenance + scope.** Cite `session_id`. Only ever read THIS project's transcript folder (derived from cwd), never other projects'.
- **No silent drops.** If you decide something notable isn't worth keeping, that's fine — but don't silently lose a real decision; when in doubt, record a terse fact.
