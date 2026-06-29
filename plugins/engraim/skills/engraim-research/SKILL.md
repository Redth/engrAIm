---
name: engraim-research
description: >
  The research-as-intake reflex. Use this WHENEVER you hit a knowledge gap or an error
  you can't resolve from memory — instead of guessing or giving up, search the web,
  prefer canonical sources, solve the problem, and intake the verified finding into the
  workspace knowledge base. Trigger on: unfamiliar errors, "how do I do X", version-specific
  behavior, tool/config questions about this environment, or anything where memory came up empty.
---

# Research as intake

When memory (`engraim-memory` → `recall`) doesn't already answer the question:

1. **Search**, preferring canonical sources in this order:
   - **first-party docs** (the project's official docs, vendor docs, e.g. proxmox.com, docs.docker.com, Microsoft Learn)
   - **reputable** (official project repos, well-regarded maintainer blogs)
   - **community** (Stack Overflow, forums, Reddit) — useful, but corroborate before trusting
   - **unverified** — last resort, flag as such
   Check `.engraim/registry.md` for per-domain trust ratings you've learned before; update it when a source proves reliable or noisy.
2. **Solve** the actual problem with what you found.
3. **Intake** the verified finding: call `intake(url_or_text, trust_tier)` — it stores the source immutably and distills it into the wiki. Mark freshly-intaked knowledge as provisional until it has actually worked once.
4. **Don't re-research** something already answered in the wiki within recent memory; `recall` first, always.

The point: the knowledge base grows as a byproduct of real problem-solving — you should not need the user to feed it manually.
