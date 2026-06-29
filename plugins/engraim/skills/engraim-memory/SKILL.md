---
name: engraim-memory
description: >
  How to use the workspace's persistent memory. ALWAYS use this whenever you need to
  recall what was learned about THIS project/environment before, or whenever you
  learn something durable worth keeping. Use it for: "what do we know about X",
  recalling prior decisions, conventions, environment quirks, fixes, inventory; and
  for recording new durable facts. Drives the `engraim-memory` MCP tools (recall,
  remember, whats_true, wiki_get, wiki_upsert). Prefer recalling from memory before
  searching the web or asking the user to re-explain context.
---

# EngrAIm memory

This workspace has persistent memory in `.engraim/`: a markdown wiki (canonical, human-readable, git-friendly), a temporal fact store, and immutable sources — all indexed for search. Markdown is the source of truth; the SQLite index is derived.

## Recall first
Before researching or asking the user to re-explain, **recall**:
- `recall(query)` — hybrid search across wiki pages + facts. Use natural-language queries with the distinctive nouns ("Proxmox heat exchanger", "MAUI runner LVM").
- `whats_true(entity)` — current facts about a specific entity (e.g. a host, a service, a tool).
- `wiki_get(page)` — read a specific knowledge page in full.

If `recall` returns a relevant single-source fact flagged low-confidence, treat it as a lead to confirm, not an established fact.

## Record durable knowledge
When something is worth keeping (a decision, a fix that worked, a convention, an inventory fact, an environment quirk):
- `remember(observation, subject?, predicate?, object?, source?)` — store an atomic fact. Pass `source` (url + trust tier) when it came from research.
- `wiki_upsert(page, content, links)` — for narrative/procedural knowledge (how-tos, troubleshooting, concept explainers). One page per entity/concept. Cross-link related pages with `[[Page Name]]`. Keep pages focused; let the link graph carry relationships.

## Discipline
- **Distill, don't dump** — capture the decision/outcome/reason, not raw logs.
- **Provenance** — note where a fact came from (a `session_id`, a URL, the user).
- **Never persist secrets** — skip API keys, tokens, passwords seen in tool output.
- **Supersede, don't silently overwrite** — if a fact changed, record the new one; the store keeps history (temporal).

## Temporal & corroboration (v2)
- **Re-stating strengthens, it doesn't duplicate.** Calling `remember` with a fact already
  known bumps its `corroboration_count` and confidence; a fact stays `low_confidence` only
  until it's been corroborated at least once. So when memory and reality agree, re-`remember`
  it — that's the signal that it's solid.
- **Changed, not gone.** When a fact changes, `supersede(fact_id, new_object)` — never
  overwrite. The old value stays in `history` and in as-of queries.
- **Conflicts aren't resolved silently.** If `remember` returns `siblings`, a current fact
  shares the same subject+predicate with a different value. Decide: a genuine *update* →
  `supersede`; an additional value for a multi-valued predicate (a host with several drives)
  → leave both.
- **Time-travel.** `whats_true(entity, as_of=<ISO time>)` returns what was believed as of
  that moment; `history(subject)` shows the whole timeline. Use these for "what did we think
  last month" or to explain how a decision evolved.
