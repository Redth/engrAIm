# Changelog

All notable changes to EngrAIm. Versions track the plugin (`plugin.json`); the workspace
schema version is separate (currently 5) and migrates additively + self-heals on open.

## 0.6.0
- **Proactive upkeep nudges** — so the self-improvement loop never depends on the user
  remembering the commands. Two new hooks plus a richer SessionStart:
  - **UserPromptSubmit** (`user_prompt.sh` → `cli user-prompt`): deterministic phrase
    detection surfaces a calibrate nudge on durable, project-wide feedback ("from now on",
    "always remember", "in this project", "prefer X over Y", …), and a 6h-throttled reminder
    of pending curate/retro/skill upkeep so long sessions don't drift.
  - **PostToolUse** (`tool_followup.sh` → `cli post-tool`, matched on calibrate / draft_skill
    / ingest_session / mark_onboarded): chains the natural next step — calibrate → curate +
    promote-override, draft-skill → promote-skill, onboard → backfill, curate → retro.
  - **SessionStart** now also surfaces a `/engraim:retro` pass once its inputs (expiring
    overrides, promotion candidates, ≥6 staged sessions) accumulate.
  - All nudges are model-gated (the hook detects; the model decides whether to act) and
    covered by the self-test.
- **Release tooling** — `scripts/bump-version.mjs <version|major|minor|patch>` keeps the two
  release-version sources (`marketplace.json`, `plugin.json`) in lockstep and flips the
  `## Unreleased` CHANGELOG heading. The self-test now guards that the two versions agree.
  A `Release` workflow tags + publishes a GitHub Release on merge to `main` when the version
  changed (idempotent — ordinary merges no-op). The workspace schema version is untouched.

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
