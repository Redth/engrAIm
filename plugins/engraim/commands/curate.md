---
description: Distill staged session transcripts into EngrAIm memory — extract durable facts and write/update wiki pages.
---
Process the sessions staged in `.engraim/pending/sessions.jsonl` (the Stop hook stages them automatically after each session).

Follow the `engraim-curate` skill. In short:
1. Read the list of staged sessions (`engraim-memory` tool `list_pending`, or read `.engraim/pending/sessions.jsonl`).
2. For each, read the transcript JSONL at its `transcript_path` (it lives under `~/.claude/projects/...`). Use `ingest_session` for a mechanical first pass, then YOU distill: what was decided, what was fixed, what was learned about this environment.
3. Write durable knowledge as wiki pages via `wiki_upsert` (one page per entity/concept/how-to, cross-linked with `[[wikilinks]]`), and atomic facts via `remember`. Cite the `session_id` as the source.
4. Distill, don't dump — capture decisions/outcomes/reasons, not the whole transcript. Never persist secrets (keys, tokens) seen in tool output.
5. Clear processed entries from the pending list and report a short summary of what was added.
