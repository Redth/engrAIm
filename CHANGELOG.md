# Changelog

All notable changes to EngrAIm. Versions track the plugin (`plugin.json`); the workspace
schema version is separate (currently 5) and migrates additively + self-heals on open.

## 0.5.0
- **Wiki-gap lint** — scan the knowledge graph for dangling `[[links]]`, stubs, orphans, and
  under-linked pages; write a prioritized research agenda to `wiki/_gaps.md` (`/engraim:lint`).
- **Optional semantic recall** — hybrid keyword + vector search. Needs the small `sqlite-vec`
  package plus an embedder (a local Ollama/OpenAI HTTP endpoint — no npm dep — or
  transformers.js). Degrades cleanly to keyword-only when absent (`/engraim:enable-semantic`,
  `reindex_semantic`).
- **Guided onboarding** — deterministic project scan seeds the frame; first-run nudge;
  `/engraim:onboard`, `scan_project`, `mark_onboarded`.
- Server now drains in-flight async work before exiting.

## 0.4.0
- **Skill promotion** — workspaces grow their own skills via a gated ladder: draft to
  `.engraim/pending/skills/` → gatekeeper review (structural checks + script-safety scan) →
  activate into the project `.claude/skills/`. SessionStart pre-creates `.claude/skills/`.
  Composes with Anthropic's skill-creator when present (not vendored).

## 0.3.0
- **Self-improvement loop** — expiring calibration overrides, the one-off→standing→permanent
  promotion ladder (permanent rules written into `frame/SOUL.md`), verdict-annotation
  feedback, and a guarded retrospective (`/engraim:calibrate`, `/engraim:retro`).

## 0.2.0
- **Temporal + corroboration fact layer** — dedupe-or-corroborate on write, confidence,
  supersede chains, bitemporal as-of + history queries. Self-healing additive migrations.

## 0.1.0
- Initial pure-Node build: workspace bootstrap, session-transcript capture/staging, FTS5
  memory + wiki, research-as-intake, hand-rolled MCP stdio server. Zero dependencies.
