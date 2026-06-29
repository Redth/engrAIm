# EngrAIm

**Self-improving, temporal workspace memory for Claude Code.** A marketplace plugin that
turns any project directory into a workspace with persistent memory: it captures your Claude
Code sessions, distills them into a `[[wikilinked]]` knowledge base plus a bitemporal fact
store, recalls them later, learns how you want it to behave, and lets the workspace grow its
own skills — so you stop re-explaining your environment every session.

*Name: **EngrAIm** = engram (a memory trace) + AI; also "ingrain" — knowledge worked in
deeply over time. Identifiers use lowercase `engraim`.*

## Design principles
- **Markdown is canonical, SQLite is a derived index.** Knowledge lives in plain markdown
  (`.engraim/wiki/`, frame files) — diffable, git-friendly, openable in any editor (or
  Obsidian; not required). The SQLite DB is a rebuildable index.
- **Prescribed vs generated, strictly separated.** *This plugin* ships only the mechanism —
  skills, hooks, the memory server, schema. It contains **no domain knowledge**. Everything
  about *your* project (facts, wiki pages, calibration, project-specific skills) is
  *generated* into that project's own `.engraim/` and `.claude/skills/`. Plugin updates
  replace the mechanism and never touch your workspace data.
- **Pure Node, zero required dependencies.** Storage uses built-in `node:sqlite` (FTS5); the
  MCP server speaks JSON-RPC over stdio by hand (no SDK). Nothing to `pip`/`npm install`. No
  daemon, no cloud. Semantic recall is an *optional* add-on (see below).

## Requirements
- **Node ≥ 22.13** (for built-in `node:sqlite` with FTS5, unflagged on the 22.x LTS line). `node --version`. Nothing else required.

## Install
```bash
/plugin marketplace add redth/engrAIm
/plugin install engraim@engraim
```
That's the whole install. Open Claude Code in any project; the first session creates
`.engraim/` and nudges you to run `/engraim:onboard`.

## How it works
- **Capture.** A Stop hook stages each session's transcript; `/engraim:curate` (or
  `/engraim:backfill` for history) distills it into facts + wiki pages — never raw dumps.
- **Recall.** `recall` searches the wiki + facts (keyword by default; hybrid keyword+vector
  if semantic is enabled). The SessionStart hook injects a frame snapshot + active rules.
- **Stay true over time.** Re-stating a known fact *corroborates* it (confidence rises);
  changes go through `supersede` (history is kept); `whats_true(entity, as_of)` time-travels.
- **Self-improve.** Corrections become calibration overrides (`/engraim:calibrate`) that
  expire unless reaffirmed and can graduate to permanent rules in `frame/SOUL.md`; a guarded
  retrospective (`/engraim:retro`) consolidates and prunes.
- **Grow skills.** Recurring procedures become workspace skills via a gated ladder
  (`/engraim:draft-skill` → review → `/engraim:promote-skill` into `.claude/skills/`).
- **Notice gaps.** `/engraim:lint` scans the wiki for dangling links / stubs / orphans and
  writes a research agenda.

## Components
```
.claude-plugin/marketplace.json     ← the marketplace catalog
plugins/engraim/
  .claude-plugin/plugin.json        ← plugin manifest
  .mcp.json                         ← registers the engraim-memory MCP server (node)
  hooks/        session_start · session_capture (Stop) · pre_compact
  commands/     init · status · onboard · curate · backfill · calibrate · retro ·
                skills · draft-skill · promote-skill · lint · enable-semantic
  skills/       engraim-memory · -research · -curate · -calibrate · -retro ·
                -skillsmith · -onboard
  server/       store.mjs · cli.mjs · engraim_server.mjs · semantic.mjs
  schema/       VERSION + migrations
  templates/workspace/   the .engraim/ skeleton copied into each project
scripts/selftest.mjs                ← `node scripts/selftest.mjs` verifies a fresh clone
```

## What lives in your workspace (not the plugin)
`<project>/.engraim/`: `frame/` (SOUL/ENV/USER hot tiers), `wiki/` (canonical knowledge),
`sources/`, `calibration/`, `registry.md`, `pending/`, and `store.db` (rebuildable index).
Promoted skills land in `<project>/.claude/skills/`. Suggested project `.gitignore`:
```
.engraim/store.db        # rebuildable index
.engraim/vendor/         # optional semantic deps
```
Commit the rest — the wiki and frame are your durable, diffable knowledge.

## Onboarding a workspace
The first session auto-creates `.engraim/` and nudges `/engraim:onboard`, which runs a
deterministic project scan (languages, tooling, scripts, git remotes) to seed the frame,
offers `/engraim:backfill`, and explains the workflow. The nudge stops once onboarded.

## Semantic recall (optional, never required)
Keyword recall works with zero dependencies. For meaning-based recall, run
`/engraim:enable-semantic`. Two small optional pieces:
- **Vector index:** the `sqlite-vec` package (~200K), installed into `.engraim/vendor/`.
- **Embedder (pick one):** a local **Ollama** (or any OpenAI-style) HTTP endpoint via
  `ENGRAIM_EMBED_URL` — *no npm dependency, just `fetch`* — or `@huggingface/transformers`
  for a fully-local embedder.
When neither is present, recall silently stays keyword-only. Hits are tagged
`via: fts | semantic | both`. Run `reindex_semantic` once after enabling.

## Companion (optional)
For skill *authoring*, EngrAIm composes with Anthropic's **skill-creator** rather than
vendoring it: `/plugin marketplace add anthropics/skills`. When present, `engraim-skillsmith`
hands off authoring/evaluation to it, then runs the result through EngrAIm's
draft→gate→activate pipeline. Not required — there's a built-in authoring checklist fallback.

## Develop / verify
```bash
git clone https://github.com/redth/engrAIm && cd engrAIm
node scripts/selftest.mjs          # exercises store, hooks, and the MCP handshake
/plugin marketplace add ./         # dogfood locally before publishing (see SETUP.md)
```

## Roadmap
Next: domain-agnostic polish and a first public release. See `CHANGELOG.md` for version
history. (Domain knowledge — homelab, a specific stack, etc. — is intentionally *not* shipped
here; it's generated per-workspace.)

## License
MIT — see `LICENSE`.
