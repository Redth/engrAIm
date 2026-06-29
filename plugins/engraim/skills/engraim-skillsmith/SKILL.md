---
name: engraim-skillsmith
description: >
  Author, review, and promote workspace-local skills so this project can grow its own
  capabilities. Use when a multi-step procedure recurs across sessions, when the user says
  "make this a skill" / "automate this", or when running /engraim:draft-skill,
  /engraim:promote-skill, or /engraim:skills. Drives the draft -> gate -> activate pipeline
  (draft_skill, review_skill, promote_skill, list_skills, retire_skill). Composes with
  Anthropic's skill-creator when it's available rather than duplicating it.
---

# Skillsmith: grow the workspace's own skills

EngrAIm lets a workspace mint its own skills. EngrAIm owns the **promotion pipeline and
gate** (provenance, validation, safety); it does NOT replace a dedicated skill-authoring
tool.

## Compose with skill-creator (don't reinvent it)
If Anthropic's **skill-creator** skill is available (it ships pre-loaded in Claude Code and
is installable via `/plugin marketplace add anthropics/skills`), prefer it for *authoring
and evaluating* the skill — it has a real draft → test → iterate eval harness. Then bring the
finished SKILL.md (+ scripts) into EngrAIm's pipeline with `draft_skill` so it gets
provenance, the gate, and a tracked promotion. If skill-creator isn't present, author with
the checklist below.

## When to mint a skill
- The same multi-step recipe has come up across sessions (a deploy/verify/repair sequence,
  a project-specific build incantation, a data-massage pipeline).
- The user explicitly asks to capture/automate a procedure.
- A curated session or retrospective surfaces a durable, repeatable workflow.
Don't mint a skill for one-offs or for knowledge — knowledge goes in the wiki (engraim-memory).

## Authoring checklist
- **name**: kebab-case, matches the directory.
- **description**: third person, lead with the use case, include the phrases a user would
  actually say (the description is the trigger, not documentation). A little "pushy" is good.
- **body**: focused; progressive disclosure — keep SKILL.md tight and point to `references/`
  or `scripts/` for detail. Scripts run via bash and their code never enters context.
- No secrets (keys, tokens). No destructive shell. Scope it to THIS workspace.

## The pipeline (the ladder)
1. **Draft** → `draft_skill(name, description, body, scripts?)` writes it to
   `.engraim/pending/skills/<name>/`. It is **inert** there — Claude Code does not load it.
2. **Gate** → `review_skill(name)` runs structural checks (frontmatter, kebab name, no
   duplicate) and a **safety scan** of bundled scripts. Fix structural failures in the draft;
   never force past them.
3. **Activate** → `promote_skill(name)` copies it to the project `.claude/skills/<name>/`,
   where Claude Code loads it (live — SessionStart pre-creates that dir). Safety warnings
   block promotion unless the user explicitly approves `force: true`.
4. **Prescribe (manual, gated)** → if a workspace skill proves broadly useful beyond this
   project, propose it as a PR to the shipped plugin's `skills/` (copy it into the plugin
   repo and open a PR). Never auto-modify the installed plugin.

## Discipline
- The gate is the point — go draft → review → promote; don't hand-write into `.claude/skills/`
  and skip provenance.
- Retire with `retire_skill(name)` when a skill stops earning its place (it leaves history).
- Prefer one sharp skill over several vague ones.
