# Engraim — a self-improving, temporal workspace-memory plugin

*A Claude Code plugin (marketplace-installable) that turns any project directory into a workspace with persistent, temporal, self-improving memory — no server, no separate install. Name: **EngrAIm** (engram + AI; also "ingrain" — knowledge worked in deeply over time). Repo: `github.com/redth/engrAIm`. Identifiers use lowercase `engraim`.*

> **Revision v2** — folds in field-tested techniques from a colleague's PM-Copilot toolkit (see §10): the **verdict-annotation feedback loop** (outputs are the feedback channel), **calibration files with expiry + a promotion ladder**, a **scheduled retrospective cadence**, **corroboration gating / no silent drops**, and a **self-pruning source registry**. The serverless temporal/markdown spine is unchanged; the self-improvement model (§7) is substantially upgraded.
>
> **Revision v3** — adds a **linked-markdown wiki as the canonical knowledge tier** and **research-as-intake** (Karpathy "LLM wiki" pattern, adapted — see §11). Knowledge now lives in Obsidian-compatible `[[wikilinked]]` markdown (no Obsidian/install required), which makes the git-checkpoint story clean; SQLite becomes a derived index. Agents research the web when blocked, **prefer canonical sources** via per-domain trust tiers, and intake verified findings automatically. §2, §3, §4, §5, §8 updated accordingly.
>
> **Revision v4** — makes capture **automatic from Claude Code session transcripts** (the JSONL at `~/.claude/projects/…`, handed to hooks as `transcript_path`) instead of a live buffer, adds `/engraim:backfill` to cold-start a workspace from past sessions, and adds an explicit **automation dial** (§7) clarifying what runs unattended vs what's gated. New §12 documents the transcript mechanism. §4, §5, §7, §8, §9 updated.

---

## 0. The one-sentence shape

A versioned plugin ships the **brains** (skills, hooks, agents, an embedded MCP server, schemas, migrations). Each project it touches grows its own **workspace store** (a single SQLite file + a few markdown files + workspace-only generated skills). The plugin reads and writes that store through lifecycle hooks but **never stores generated data inside itself**, so `/plugin update` can replace the brains wholesale while every workspace keeps its accumulated knowledge — and a migration step lets new plugin versions upgrade old workspaces in place.

---

## 1. What we borrow from the proven systems (Hermes, OpenClaw)

Both the most popular self-hosted agents of 2026 converged on the same serverless core. We steal the parts that work and fix the parts that don't.

| Pattern | Source | Verdict |
|---|---|---|
| Tiered memory: fixed frame / facts / procedures / episodic | Hermes (SOUL/USER + MEMORY + skills + SQLite FTS5) | **Adopt.** Clean separation of concerns. |
| Bounded files with forced consolidation at ~80% | Hermes (MEMORY.md ~2.2k chars) | **Adopt the discipline, relax the cap.** Bounded "hot" tier + unbounded cold tier in SQLite. |
| Frozen snapshot injected at session start; write-through to disk | Hermes / OpenClaw | **Adopt.** Maps directly to a SessionStart hook. |
| Episodic recall = SQLite FTS5 over markdown | Both | **Adopt + upgrade** to `sqlite-vec` for semantic recall; keep FTS5 alongside for hybrid (BM25 + vector). |
| Gated/staged skill creation (approve before promote) | Hermes (`pending/skills/<id>.json`) | **Adopt.** This is the quality-control answer to "self-improving" not turning into self-poisoning. |
| External memory as *additive* layer, never replacing built-in | Hermes provider plugins | **Adopt as philosophy.** Our store is canonical; bolt-ons are optional. |
| Community skill hub + compaction, no relationship graph | OpenClaw | **Avoid the weakness.** Isolated silos with no temporal/relational structure is the exact gap we're closing. |
| "Memory files as pointer indexes, not raw dumps"; distill takeaways | Hermes / Claude Code memory design | **Adopt.** Store decisions and deltas, not transcripts. |

Key realization: **none of these need a server, a vector DB, or a graph DB.** The temporal/relational structure they lack can be added as columns and link tables in the same SQLite file. That keeps the whole thing inside one portable file.

---

## 2. Storage: serverless, temporal, single-file

**Engine:** one SQLite database per workspace, with `sqlite-vec` for embeddings and FTS5 for keyword. No daemon. The host model (whatever Claude Code is running) does entity/fact extraction during the consolidation step, so there is no local LLM requirement.

**Why not Graphiti/Neo4j/FalkorDB:** those are servers and store data as opaque DB files that don't diff. We replicate the useful 80% — temporal facts + entity relationships — as a schema inside SQLite. (If a workspace later outgrows this, the MCP server can expose an optional Graphiti backend without changing the plugin's interface.)

**Temporal model (bitemporal-lite).** Facts are never deleted; they're invalidated. Minimum columns on the `fact` table:

- `valid_from`, `valid_until` — when the fact was true *in the world*
- `recorded_at`, `invalidated_at` — when we *learned/superseded* it
- `source_episode_id` — provenance link back to the raw observation
- `confidence`, `entity_id`, `predicate`, `object`

This gives you "what's true now" (the default query) and "what did this look like before the migration" (time-travel) for free, the same capability Graphiti sells, in a file you can copy.

**Four logical tiers (markdown is canonical; SQLite is a derived index):**

1. **Frame (markdown, read-only-ish):** `SOUL`-equivalent — how the agent should behave in *this* workspace. Rarely changes.
2. **Hot facts (markdown, bounded):** `ENV.md` / `USER.md` equivalents — the small, always-injected snapshot (inventory summary, conventions, active quirks). Consolidated when it grows.
3. **Wiki (linked markdown pages) — the human-readable knowledge graph.** One page per entity / concept / how-to / troubleshooting writeup, cross-linked with `[[wikilinks]]` (Obsidian-compatible, but plain markdown — no app or install required; the links *are* the graph, in diffable text). This is where distilled, narrative, procedural knowledge lives — the stuff that reads badly as rows in a fact table. Borrowed from Karpathy's "LLM wiki" pattern (§11): the agent maintains the pages and the link bookkeeping; you rarely edit them by hand.
4. **Index + facts (SQLite):** atomic temporal facts, entity edges, embeddings, and the skill/script registry. This is the *query engine over the wiki*, not the source of truth — it embeds and indexes the wiki pages for semantic recall and holds the bitemporal facts. Rebuildable from the markdown at any time.

**Sources are immutable.** Raw captured material — including web pages/search results the agent fetched while solving a problem (§11) — lands in `sources/` as immutable episodes with provenance. Facts and wiki pages are *derived* from sources and can be regenerated; sources themselves are never edited. (Same principle as Karpathy's immutable `sources/` layer.)

**On git — now much better.** Because the wiki (and frame, and JSONL export of facts) is canonical markdown, your real knowledge is fully diffable and checkpointable; a commit is a meaningful snapshot you can read and roll back. The SQLite file stays a rebuildable derived index — regenerate it from the wiki + JSONL after a pull. So you get the git-native checkpoints you originally wanted, without giving up semantic/temporal query.

---

## 3. The central problem: prescribed vs generated (ownership model)

This is the part that has to be right, or updates will eat the workspace or the workspace will fork the plugin. The rule is **strict directory ownership with a one-way data flow.**

```
PRESCRIBED  (ships in the plugin; lives in ~/.claude/plugins/cache/engraim;
            REPLACED WHOLESALE on /plugin update; treat as read-only)
└── engraim/
    ├── .claude-plugin/plugin.json        # name, semver, component paths
    ├── skills/                           # generic procedures (proxmox, docker, kg-curate…)
    ├── agents/                           # curator, migrator, skill-gatekeeper subagents
    ├── hooks/hooks.json + *.sh           # lifecycle wiring (uses ${CLAUDE_PLUGIN_ROOT})
    ├── mcp/                              # the bundled memory MCP server (the only "tool" surface)
    ├── schema/                           # versioned DDL + migrations/NNNN_*.sql
    └── templates/                        # seed ENV.md, SOUL.md, skill scaffolds

GENERATED   (lives in the PROJECT, e.g. <project>/.engraim/;
            PERSISTS across updates; owned by the workspace; plugin only writes here via hooks)
└── .engraim/
    ├── manifest.json                     # { schema_version, plugin_version_last_seen, workspace_id }
    ├── frame/SOUL.md  ENV.md  USER.md     # the markdown tiers (instantiated from templates once)
    ├── wiki/                             # CANONICAL knowledge: linked [[wikilink]] markdown pages (entities, concepts, how-tos)
    ├── sources/                          # IMMUTABLE raw captures: fetched pages/search results w/ url + trust tier + fetched_at
    ├── store.db                          # DERIVED index: sqlite-vec + FTS5 + temporal facts/edges over wiki + sources
    ├── export/facts.jsonl                # text checkpoint for git (facts); wiki/ is already git-native
    ├── calibration/<domain>.md           # dated calibration log + EXPIRING standing overrides (the learning tier)
    ├── registry.md                       # sources/tools/MCPs + per-domain TRUST tiers; rated, cadence-tagged, w/ "removed & why"
    ├── reports/YYYY-MM-DD-*.md           # dated generated outputs — carry inline `verdict: ___` feedback tags
    ├── skills/                           # WORKSPACE-SPECIFIC generated skills (namespaced, provenance-tagged)
    ├── scripts/                          # workspace-specific generated tools/scripts (self-verifying; see §7)
    └── pending/                          # staged, un-approved skills/scripts awaiting promotion
```

**The four invariants that make updates safe:**

1. **Plugin never writes into its own cache dir at runtime.** All runtime writes go to `<project>/.engraim/`. So replacing the cache on update loses nothing.
2. **Workspace never contains plugin logic — only data + workspace-unique generated artifacts.** Generated skills are stamped with `provenance: generated` + `created_by_plugin_version`; prescribed skills are namespaced `engraim:<skill>`. No name collisions, and the curator can tell its own output from shipped content.
3. **Reads merge, writes are scoped.** At session start the agent sees prescribed skills (from cache) *and* generated skills (from `.engraim/skills/`). When it learns something new, it can only write into `.engraim/`.
4. **A version handshake bridges the two.** `manifest.json` records the workspace's `schema_version` and the last plugin version that touched it. On the next session a hook compares that against the plugin's current `schema/VERSION` and runs any pending migrations (see §6). This is how a plugin update *reaches* an existing workspace without you doing anything.

**Conflict rule for generated vs prescribed skills:** if the plugin later ships a generic skill that overlaps a workspace-generated one, the generated one wins *in that workspace* but the gatekeeper agent flags it for review ("you hand-grew `docker-prune`; v1.4 now ships one — keep yours, adopt theirs, or merge?"). Never silent.

---

## 4. Plugin component inventory

Everything below ships **prescribed**. None of it holds workspace data.

**MCP server (the only tool surface) — `engraim-memory`**
The single component that touches `store.db`, so storage logic lives in one place and the agent/skills stay declarative. Tools (Graphiti-shaped so a future backend swap is invisible):
- `remember(observation, entities?, valid_from?, source?)` — extract → upsert facts + episode, embed, index; `source` carries url + trust tier when the observation came from research
- `recall(query, as_of?, k?)` — hybrid (vector + FTS5) retrieval over facts *and* wiki pages, optional time-travel via `as_of`; returns single-source facts flagged `low-confidence` rather than hiding them
- `relate(subject, predicate, object)` — explicit link
- `whats_true(entity, as_of?)` — current or historical fact set
- `forget(fact_id)` / `supersede(fact_id, new)` — invalidate, never hard-delete
- `wiki_get(page)` / `wiki_upsert(page, content, links[])` — read/write a wiki page; the curator uses these to distill knowledge and maintain `[[wikilink]]` bookkeeping
- `intake(url|text, trust_tier?)` — capture a fetched source into immutable `sources/`, then distill into the wiki (create/update pages, add cross-links). The research-as-intake entry point (§11)
- `ingest_session(transcript_path|session_id)` — read a Claude Code session JSONL, extract facts/decisions/sources, distill into wiki + facts. Used by the Stop hook (current session) and `/engraim:backfill` (historical sessions). See §12.
- `lint()` — wiki health check: broken links, orphan pages, contradictions (conflicting temporal facts), and **gaps → a suggested research agenda** (§11)
- `snapshot()` — produce the bounded hot-tier injection text for SessionStart
- `migrate(to_version)` — run DDL migrations (called by the heal hook)
- `export_jsonl()` / `rebuild_index()` — rebuild the SQLite index from the canonical wiki + JSONL (git-checkpoint bridge)

**Hooks (lifecycle wiring)** — paths via `${CLAUDE_PLUGIN_ROOT}`, scripts `chmod +x`:
- `SessionStart` → ensure `.engraim/` exists (instantiate from templates on first run) → run heal/migrate handshake → inject `snapshot()` + frame files into context. Also: if a retro/lint is due (cadence check), flag it. *This is the "frozen snapshot at session start."*
- `Stop` / `SessionEnd` → fire the **curator agent** with the `transcript_path` Claude Code hands the hook → curator reads the just-completed JSONL transcript, extracts facts/decisions/sources, distills into wiki + facts, consolidates the hot tier if >80%, proposes skills/scripts into `pending/`. **This is the primary capture path** (see §12) — a complete record read once, not a hand-built buffer. Run `async` so it never blocks you.
- `PreCompact` (optional but recommended) → harvest before mid-session context is dropped, so long sessions don't lose their early learnings before Stop fires.
- `PostToolUse` (optional, narrow) → only for *live* reactions you want during the session (e.g. an unresolved error → trigger `engraim:research` immediately). Not the capture mechanism anymore; the transcript is.

**Agents (subagents, own context windows):**
- `curator` — reads session transcripts (`transcript_path` / backfilled history); turns episodes into facts + wiki pages; runs consolidation; decides what's worth keeping (distill, don't dump); writes "dropped & why" notes (no silent drops). Every extracted fact/page cites its `session_id` for full lineage.
- `skill-gatekeeper` — reviews staged `pending/` skills/scripts; only promotes on approval (CLI diff or auto-approve policy you set). The quality gate.
- `retrospective` — runs on a cadence (not session boundary): re-checks whether recent high-salience facts held up, finds misses, applies the echo-chamber + action-test guardrails, appends dated notes to `calibration/`, and proposes ladder promotions (transient → standing → permanent). *This is the "was I right" loop, separate from "what did I learn."*
- `migrator` — applies schema migrations idempotently; can also "self-heal" a corrupted/partial store by rebuilding indexes or replaying JSONL.

**Skills (generic, prescribed):**
- `engraim:curate-memory`, `engraim:recall`, `engraim:promote-skill` — how to drive the MCP tools well.
- `engraim:research` — the research-as-intake reflex (§11): when a skill hits a knowledge gap or an error it can't resolve from memory, it searches the web, **prefers canonical sources** (consults `registry.md` trust tiers; first-party docs > reputable > community > unverified), solves the problem, then calls `intake()` so the verified finding becomes a wiki page with its source and trust tier. Knowledge grows as a byproduct of work, not from manual feeding.
- Domain seeds for *your* world: `engraim:proxmox`, `engraim:docker`, `engraim:homelab-inventory` — the generic procedures, written so they call `recall()` first, fall back to `engraim:research`, and `remember()`/`intake()` what they learn — accumulating *your* specific environment on top of the generic baseline.

**Commands (slash):**
- `/engraim:init` (adopt a project), `/engraim:status` (tiers, capacity, schema version, pending count, expiring overrides), `/engraim:review` (walk pending skills + verdict feedback + due-to-expire overrides), `/engraim:retro` (run the retrospective on demand), `/engraim:lint` (wiki health + gap-driven research agenda), `/engraim:backfill` (scan this project's historical session transcripts to bootstrap memory — §12), `/engraim:checkpoint` (export JSONL + optional git commit), `/engraim:timetravel <entity> <date>`.

---

## 5. Lifecycle (the loops)

```
SESSION START
  hook → .engraim exists? (init from templates if not)
       → version handshake → migrate if needed (§6)
       → inject SOUL.md + ENV.md + snapshot() facts  ── the frozen hot context
WORK
  agent uses engraim:* skills → recall(query, as_of?) on demand
       → gap or unresolved error? → engraim:research: web_search → prefer canonical source
                                  → solve → intake(url, trust_tier) → wiki grows  (§11)
       → (PreCompact hook harvests early-session learnings if a long session compacts)
SESSION END (Stop/SessionEnd hook → curator agent, async)
  → read transcript_path JSONL (complete record)  ── primary capture, no live buffer (§12)
  → extract facts/decisions/sources → remember()/supersede()  ── temporal store grows
  → distill durable findings/sources → wiki_upsert() + cross-link  ── wiki grows, denser
  → consolidate hot tier if >80%                          ── forget discipline
  → if a repeatable procedure emerged → stage skill/script into pending/
BACKFILL (once, on adoption / on /engraim:backfill)
  → scan ~/.claude/projects/<this-project>/*.jsonl history → bootstrap wiki+facts (§12)
SELF-IMPROVE (async / on /engraim:review)
  → read verdict tags on prior reports → write recurring fixes to calibration/ (expiring)
  → skill-gatekeeper reviews pending/ → promote to .engraim/skills (provenance-tagged)
RETROSPECTIVE + LINT (on cadence / on /engraim:retro, /engraim:lint)
  → did high-salience facts hold up? what got missed? echo-chamber + action-test guardrails
  → wiki lint: broken links, orphans, contradictions, GAPS → research agenda → engraim:research
  → append dated retro note → propose ladder promotions (transient→standing→permanent rule)
```

The expensive model work (extraction, consolidation) happens **once at session end**, reading the persisted transcript rather than re-deriving from a live buffer — and runs `async` so it never makes you wait. (Same cost trick as Hermes, but the transcript is a complete record we get for free.)

---

## 6. Updates, migrations, self-heal

**How plugin updates work (Claude Code spec):** plugins live in a marketplace (a git repo with `marketplace.json`); users run `/plugin install engraim@<marketplace>` and `/plugin update`. Third-party plugins don't auto-update by default (governed by `CLAUDE_CODE_AUTO_UPDATE_PLUGINS`); versions pin via semver in `plugin.json` or a commit `sha` in the marketplace entry. Rollback = repoint the marketplace entry to the previous SHA. So we get versioned, intentional updates for free — and because the cache is replaced wholesale, **the prescribed/generated split is what makes updates non-destructive.**

**Schema migrations (the bridge that makes updates *reach* old workspaces):**
- Plugin ships `schema/VERSION` and `schema/migrations/NNNN_*.sql` (forward-only, idempotent).
- `.engraim/manifest.json` stores the workspace's current `schema_version`.
- SessionStart heal hook: `if workspace.schema_version < plugin.schema_version → migrator runs missing migrations → bump manifest`. Pure additive migrations (new tables/columns) so an upgrade never breaks an older workspace, and a *downgrade* (rolled-back plugin) still reads because new columns are nullable.
- This means: ship v1.4 with a new `confidence` column or a new MCP tool, and every existing workspace quietly upgrades itself on next open.

**Self-heal:** the migrator also runs an integrity pass — if `store.db` is missing/corrupt it rebuilds from `export/facts.jsonl`; if FTS5/vec indexes are stale it reindexes; if `.engraim/` is partial it re-instantiates only the missing pieces from templates (never overwriting existing data). A `/engraim:status` surfaces drift.

---

## 7. Self-improvement without self-poisoning

The honest risk in "self-improving" systems is the agent promoting a bad skill or polluting memory with low-value noise; quality control on what gets distilled is the unsolved tension in this whole category. The PM toolkit (§10) solves a lot of this with zero infrastructure, so v2 adopts its mechanics wholesale.

**How much of this is automated? (The dial.)** Most of it runs unattended; only *promotion* is gated, and even that is a tunable policy, not a wall. The spectrum:

| Stage | Default | Why it's safe to automate (or not) |
|---|---|---|
| Capture from session transcripts (§12), extract facts, embed/index, write & cross-link wiki pages, consolidation, decay/expiry, lint detection | **Fully automatic** | Writes are additive, reversible, provenance-stamped, and "no silent drops"; they can only touch the *generated* workspace (`.engraim/`), never the plugin (§3). Worst case is recoverable noise, not corruption. |
| Wiki edits from research intake | **Automatic, with a rail** | Freshly-intaked knowledge is marked `unverified` until it survives one real use; trust tier + corroboration bound the blast radius. |
| Standing overrides in `calibration/` | **Automatic, but self-limiting** | Written automatically when a correction recurs, but they *expire* (§7 ladder rung 2), so a bad one ages out on its own. |
| Skill / script promotion (`pending/` → active) | **Gated by default; auto-promote optional** | Procedures are executable behavior change — higher stakes. Default stages for review; opt into "auto-promote after N successful reuses" per workspace. |
| Promotion into a *prescribed* skill (rung 3) | **Always a PR** | This changes shipped logic for every workspace; a human reviews. Never silent. |

The thing that *makes* aggressive automation safe here isn't restraint — it's the structural guarantees already in the plan: additive/reversible writes, provenance + lineage, expiry, corroboration, no-silent-drops, and the hard prescribed/generated boundary. Turn the dial as far toward "hands-off" as your trust allows; the floor is well-defended.

**The promotion ladder (the core model).** Learning climbs three rungs, and the rung determines durability. Nothing is born permanent.

1. **Transient — a verdict on an artifact.** Every generated report/output carries inline `` · `verdict: ___` `` tags. You (or a reviewing agent) annotate what was wrong; the *next* run reads the prior artifact first and recalibrates. No store, no model — the artifact is the feedback channel, and it's git-native. This is the cheapest possible loop and catches most miscalibration.
2. **Standing — an expiring override in `calibration/<domain>.md`.** When a correction recurs, the curator writes it as a dated standing override **with an expiry** (e.g. 90 days, reaffirmed on review). This is temporal decay implemented in markdown: stale preferences age out unless re-confirmed, so the workspace doesn't ossify around old quirks. The MCP `recall`/`snapshot` calls read active (un-expired) overrides and apply them.
3. **Permanent — a rule promoted into a prescribed skill.** When the same override keeps getting reaffirmed across review cycles, it has earned its way into the shipped logic — surfaced as a suggested edit to a `engraim:` skill (a PR against the plugin), not silently written. Recurring truth graduates from data into code, with a human gate at the top rung.

**Scheduled retrospective (a cadence distinct from session-end).** Session-end consolidation handles "what did I learn today"; a separate periodic retro handles "was I right." On its cadence the **retrospective agent**: re-checks whether recent high-salience facts/decisions actually held up, hunts for things it missed, appends a dated retro note to `calibration/`, and proposes ladder promotions. Two guardrails ride along, both lifted from the toolkit:
- **Echo-chamber check** — force at least one item per cycle from outside the workspace's usual patterns; if there genuinely is none, say so rather than padding. Stops the memory from narrowing to a self-reinforcing loop.
- **Action test** — any fact/topic tagged high-salience that never drives an action gets downgraded. Salience must be earned by consequence, not recency.

**Corroboration gating + no silent drops (the integrity rules).** Two disciplines the MCP server enforces so the store stays trustworthy:
- **Corroborate before asserting.** A fact needs ≥2 independent sources before `recall` presents it as established; single-source facts are returned but flagged `low-confidence` rather than omitted. (A confident wrong fact destroys trust; a flagged thin one is a useful lead.) Implemented as a `corroboration_count` + `source_episode_id` set on each fact.
- **No silent drops.** Consolidation and `forget`/`supersede` never delete quietly — they log what was dropped and why to `calibration/`. Forgetting is auditable and reversible from the JSONL export.

**Plus the cheaper standing defenses (unchanged from v1):**
- **Stage, don't auto-commit.** New skills/scripts land in `pending/` with a rationale + the trajectory that produced them; promotion is explicit (manual, or policy like "auto-promote after N successful reuses").
- **Bounded hot tier forces choices.** The ~80% consolidation rule means the agent must *merge and prune*, not just append — the mechanism that keeps Hermes' memory from rotting.
- **Distill, don't dump.** Capture decisions/deltas and the *reason*, not raw command logs.
- **Self-verifying generated scripts.** Any script the workspace generates ships with a `--verify` self-test and chainable output modes, so the agent calls a checked tool instead of recomputing deterministic work each time.

---

## 8. Build roadmap

1. **Skeleton plugin** — `plugin.json`, marketplace repo, a no-op SessionStart hook that creates `.engraim/` from templates. Prove install/update/uninstall and the cache-vs-workspace boundary.
2. **MCP server v0 + transcript capture** — SQLite + FTS5 only (no vectors yet): `remember`/`recall`/`snapshot`. Wire SessionStart injection + the `Stop` hook that reads `transcript_path` and runs `ingest_session` (§12). You now have OpenClaw-equivalent memory, captured automatically from real sessions.
3. **Temporal layer** — add bitemporal columns + `whats_true`/`supersede`/`timetravel`. Now you've passed OpenClaw.
4. **Semantic recall** — add `sqlite-vec`, hybrid retrieval. Embedding via host model or a small bundled embedder.
5. **Wiki layer + backfill** — `wiki/` pages + `wiki_get`/`wiki_upsert`, curator distills facts/sources into linked markdown. Index the pages for recall. Add `/engraim:backfill` + `ingest_session` over historical transcripts to cold-start the wiki from past work (§12). This is the canonical knowledge tier and the git-native checkpoint (§11).
6. **Research-as-intake** — `engraim:research` skill + `intake()`; trust tiers in `registry.md`; `/engraim:lint` for gaps→agenda. Now the workspace grows knowledge from real problem-solving (§11).
7. **Learning loop** — curator agent, `pending/` staging, skill-gatekeeper, `/engraim:review`.
8. **Feedback + calibration** — verdict tags on generated reports; `calibration/<domain>.md` with expiring standing overrides; the promotion ladder; corroboration flagging + no-silent-drops logging. (Cheapest high-leverage upgrade — can be pulled early.)
9. **Retrospective cadence** — the `retrospective` agent + `/engraim:retro`, echo-chamber and action-test guardrails.
10. **Migrations + self-heal** — `schema/VERSION`, migrator, integrity pass. Ship a deliberate v0→v1 migration to test the handshake end-to-end.
11. **Domain seeds** — `engraim:proxmox`, `engraim:docker`, `engraim:homelab-inventory`. Dogfood on your actual lab.
12. **Polish for marketplace** — token-cost audit (`claude plugin details`), README, semver discipline, SHA-pinnable entry.

Tooling to lean on while building: the official `plugin-dev` plugin (`/plugin-dev:create-plugin`, `plugin-validator`, `skill-reviewer`), `skill-creator`, and the `mcp-builder` skill for the server.

---

## 9. Risks / open questions

- **Embedding without a server.** Host-model embeddings keep it install-free but cost tokens per `remember`; a tiny bundled embedder (e.g. a small all-MiniLM via transformers.js (Node-native), or the host model) is faster/cheaper but adds an install. Decide per appetite — FTS5-only (step 2) is a fine long-lived fallback.
- **Multi-machine workspaces.** If the same project is opened from two machines, `store.db` needs a sync story (the JSONL export + git, or Syncthing on `.engraim/`). Single-writer assumption for v1.
- **Hot-tier injection cost.** Every session pays for the snapshot tokens. Keep it genuinely bounded; `/engraim:status` should show the token cost (Claude Code can estimate per-component always-on cost).
- **Where the line sits between "fact" and "skill."** Environment inventory = facts (MCP store). Repeatable multi-step procedure = skill (staged file). The curator needs a clear heuristic or it'll mis-file; worth nailing in step 5.
- **Generated-vs-prescribed skill overlap** (the §3 conflict rule) needs a real UX, not just a flag — probably surfaced in `/engraim:status` and `/engraim:review`.
- **Wiki page identity / merge.** "Did I already have a page for this?" is the wiki's version of fact dedup. Needs a naming convention + a fuzzy-match-before-create step in `wiki_upsert`, or the graph fragments into near-duplicate pages. `lint()` catching orphans/near-dupes is the safety net.
- **Research trust is a heuristic, not truth.** Trust tiers reduce but don't eliminate bad intake; a confident-sounding wrong doc still gets in. Corroboration + `fetched_at` + supersession limit the blast radius, but a found answer is provisional until it's been used successfully — consider marking freshly-intaked knowledge `unverified` until it survives one real use.
- **Research cost / loops.** "Search when blocked" can get expensive or loop. Bound it (max searches per gap, don't re-research something already in the wiki within N days) and let `recall` short-circuit research when the wiki already answers.
- **Transcript extraction quality.** Session JSONL is noisy and verbose; pulling durable signal (decisions, outcomes, fixes) out of it without hoarding the whole conversation is the hard part — this is the same "distill, don't dump" discipline, now applied to a bigger, messier input. Tune the curator prompt against real transcripts.
- **Transcript retention is a clock.** Claude Code trims/deletes old transcripts, so backfill is partly a race; schedule periodic backfill so sessions are harvested before they're GC'd. Conversely, don't assume a transcript will still be there later — extract eagerly.
- **Secrets in transcripts.** Tool output and pasted text can contain keys/tokens. Extraction must redact/skip secret patterns; the store keeps the "never persist raw secrets" rule. Scope stays current-project-only (derived from `cwd`), never other projects' histories.

---

## 10. Techniques borrowed from the PM-Copilot toolkit (and what we left behind)

A colleague's PM toolkit for GitHub Copilot CLI — a plain git repo of skills/prompts/workflows, symlinked into `~/.copilot/skills/`, with a SQLite session store and date-stamped markdown reports. Different shape (no temporal layer, no embeddings, no installable/updatable packaging, no shipped-vs-generated separation), but its *learning and quality mechanics* are unusually mature. Adopted:

| Technique (theirs) | How it shows up in Engraim |
|---|---|
| **Verdict annotations** — outputs carry inline `verdict: ___`; next run reads them and recalibrates. The artifact is the feedback channel. | The transient rung of the promotion ladder (§7); reports in `.engraim/reports/` carry verdict tags. |
| **Calibration file with expiring standing overrides** — dated log + override table where each entry has a 90-day expiry. | `calibration/<domain>.md`; the standing rung (§7). Temporal decay in markdown, no DB needed. |
| **Promotion / graduation ladder** — recurring fixes climb from one-off → standing override → permanent rule in the skill (with a worked "miss → root-cause → systemic fix" example). | The three-rung model in §7 — the spine of the v2 self-improvement design. |
| **Scheduled retrospective** — a week-later review of whether judgments held, with echo-chamber and action-test guardrails. | The `retrospective` agent + `/engraim:retro` (§4, §5, §7). |
| **Corroboration rule** — ≥2 independent sources before asserting; else label low-confidence, don't drop. | `corroboration_count` on facts; `recall` flags low-confidence (§4, §7). |
| **No silent drops** — every classified item reaches output or is logged as dropped with a reason. | Consolidation/`forget` logs to `calibration/`; reversible from JSONL (§7). |
| **Rated, cadence-tagged source registry** with a "removed & why" list. | `registry.md` in the generated layer (§3) — the workspace's self-pruning catalog of its own sources/tools/MCPs. |
| **Deterministic helper scripts** with `--verify` self-test + chainable output. | Convention for workspace-generated `scripts/` (§7). |
| **Negative knowledge / exclusions** (explicit "skip these"). | Supported as exclusion facts in the store. |
| **Stub → instance context pattern** (`templates/context-stubs/` ship; `context/` is filled in). | Validates Engraim's prescribed-template → generated-frame split (§3). |
| **Cadence gating** ("don't run the weekly job on a Tuesday — STOP"). | Hooks/agents are cadence-aware, not just session-boundary-aware. |

**Deliberately not adopted:** the symlink-the-repo install model (great live-edit loop, but no versioning/updates/separation — the exact things Engraim needs); PM-specific skills (standup, 1:1 prep, telemetry, release notes); and the assumption that the repo itself is both shipped logic and personal data (the conflation Engraim's §3 split exists to prevent). The `instruction.md` vs `SKILL.md` inconsistency in their repo is also a small caution: pick one skill format and validate against it.

---

## 11. Wiki layer + research-as-intake (Karpathy "LLM wiki" pattern, adapted)

Karpathy's framing — *"Obsidian is the IDE, the LLM is the programmer, the wiki is the codebase"* — is a clean way to think about the canonical knowledge tier: a network of linked markdown pages the **LLM** writes and maintains, where ingesting one source touches many pages and the graph gets denser (and more useful) over time. We adopt the pattern but change two things to fit a self-improving workspace.

**Adopted:**
- **Linked-markdown wiki as the canonical knowledge tier** (§2 tier 3): one page per entity/concept/how-to, `[[wikilinked]]` into a navigable graph. Plain markdown — **no Obsidian, no install**; the format is Obsidian-compatible only so you *could* point Obsidian (free) or VS Code at the folder for a graph view later. The wikilinks are the graph, in diffable text — which is what finally makes the git-checkpoint goal clean (canonical knowledge is markdown; SQLite is a rebuildable index over it).
- **Immutable sources, derived everything-else** (§2): raw captures live in `sources/` and are never edited; facts and wiki pages are regenerable derivations with provenance back to a source. Same discipline as Karpathy's immutable `sources/`.
- **One ingest → many pages.** `intake()`/the curator create and cross-link multiple pages per source — the link bookkeeping you'd never do by hand.
- **`lint()` as a first-class op.** Find broken links, orphans, and contradictions — and turn the wiki's *gaps* into a research agenda the agent can act on. This is what couples the wiki to proactive growth.

**Changed for Engraim (your divergence):**
- **Intake is a byproduct of work, not manual feeding.** The article's flow is human-driven (clip articles, run `/ingest-url`). Engraim's primary intake stream is the agent's own research: a skill hits a gap or an error it can't resolve from memory → it web-searches → solves the problem → the verified finding flows into the wiki via `intake()`. You never have to curate a reading pile; the wiki grows from real problem-solving. (Manual `intake(url)` still exists for when you *do* want to drop something in.)
- **Source trust / canonicity is scored at intake.** Every captured source records `source_url`, `fetched_at`, and a `trust_tier`: **first-party docs** (e.g. proxmox.com, docs.docker.com, Microsoft Learn) > **reputable** (official project repos, well-regarded maintainers' blogs) > **community** (Stack Overflow, forums, Reddit) > **unverified**. The `engraim:research` skill prefers higher tiers, and `registry.md` holds per-domain trust ratings so the policy learns (a domain that repeatedly proved reliable gets promoted; noise gets demoted and remembered as removed). Trust composes with the §7 rules: a single first-party-docs source can be treated as canonical, while a community source needs corroboration before `recall` asserts it. Because docs change per version, intake stamps `fetched_at` and the temporal model handles "this was true for version X" — a found answer can later be superseded.

**Why this fits the rest of the plan:** the wiki is just a richer expression of the "markdown is canonical, SQLite is a derived index" principle from §2; research-as-intake is the external-facing complement to the curator's internal capture (§5); and trust tiers are the external-source extension of the corroboration/registry machinery already in §7 and §10. No new infrastructure, no server, no Obsidian — it's all markdown plus the existing MCP surface.

---

## 12. Capture from session transcripts (the primary intake path)

Claude Code persists a complete, append-only JSONL transcript of every session at `~/.claude/projects/<url-encoded-project-path>/<session-id>.jsonl` — user prompts, assistant text, tool calls with exact inputs/outputs, thinking blocks, subagent chains, and git snapshots. Every hook receives `transcript_path` (and `session_id`, `cwd`) on stdin. The CLI, the VS Code/JetBrains extensions, and Claude Desktop's coding features all write to this same store. (This is the Claude Code equivalent of the `session_store` SQLite the PM toolkit queried for "recent session context" — same idea, JSONL instead of a table.)

This replaces the live-buffer capture from earlier drafts. Two modes:

- **Per-session (automatic).** The `Stop`/`SessionEnd` hook hands the curator the just-finished `transcript_path`; it reads the complete record once and distills facts + wiki pages, async so it never blocks you. A `PreCompact` hook does an early harvest so long sessions don't lose their first hours before Stop fires. Reading the persisted transcript is cheaper and more complete than instrumenting every tool call, and it captures the thinking/tool-I/O a buffer would miss.
- **Backfill (one-shot).** `/engraim:backfill` scans the project's existing transcript history to bootstrap a workspace from work you did *before* Engraim existed — the cold-start answer. There's a deadline baked in: Claude Code compacts and eventually deletes old transcripts, so extracting durable knowledge into Engraim's persistent store is partly a race against its garbage collector. Run backfill at adoption; re-run periodically to catch sessions before they're trimmed.

**Provenance & scope:** every fact/page extracted this way cites its `session_id`, so lineage runs all the way back to the conversation that produced it (and the transcript becomes an immutable `sources/` entry, per §2). Scope is the **current project only** — the curator derives the project's transcript folder from `cwd` and never reads other projects' histories. Transcripts can hold secrets (pasted keys, tool output), so extraction redacts/skips obvious secret patterns and the store inherits the same "never persist raw secrets" rule as the frame tiers.

**Caveats** (also in §9): transcripts are noisy — extraction quality is the hard part, and the curator should distill decisions/outcomes, not transcribe; the transcript omits system prompts and Engraim's own injected context (it's the conversation + tool I/O), which is fine for our purposes; and the path is `HOME`-relative, so containerized/remote setups need `CLAUDE_ROOT`-style overrides.

---

*Net: Hermes' tiered, consolidating memory model + a Graphiti-shaped temporal layer, collapsed into markdown tiers (a `[[wikilinked]]` knowledge wiki as the canonical store) with SQLite as a derived index — fed automatically by session-transcript capture and on-demand web research, refined by the PM toolkit's verdict-driven, ladder-promoted, retrospective self-improvement loop — wrapped as a Claude Code plugin whose strict prescribed/generated split makes it safely updatable and self-healing, with zero servers and nothing to install beyond the plugin itself.*
