---
name: engraim-onboard
description: >
  Set up a brand-new EngrAIm workspace for a folder/project. Use on first run (the
  SessionStart nudge), when the user runs /engraim:onboard, or when adopting EngrAIm into
  an existing project. Scans the project deterministically, seeds the memory frame
  (ENV/USER/SOUL), offers history backfill and optional semantic recall, and explains the
  workflow — without turning it into an interrogation.
---

# Onboard a workspace

Goal: get a new workspace from empty stubs to genuinely useful in a couple of minutes,
mostly from what can be detected rather than what the user has to type.

## Steps
1. **Scan.** Call `scan_project` (read-only). Summarize for the user what this project is:
   languages, build tooling, package scripts, git remotes, notable top-level files.
2. **Seed the frame** by editing files in `.engraim/frame/` directly:
   - `ENV.md` — the durable, bounded environment facts worth injecting every session
     (stack, tooling, key conventions detected). Keep it tight; it's a hot tier.
   - `SOUL.md` — operating rules that are obvious from the project (e.g. "this is a
     library, keep the public API stable") — only what you're confident about.
   - `USER.md` — ask **one** short question about working/communication preferences (or
     infer from how the user talks). Don't interrogate.
3. **Offer backfill.** Suggest `/engraim:backfill` to bootstrap memory from past Claude Code
   sessions in this project (note older transcripts may already be trimmed).
3b. **Offer a .gitignore suggestion** (don't write without asking): recommend the project
   ignore `.engraim/store.db` (rebuildable index) and `.engraim/vendor/` (optional deps), and
   commit the rest of `.engraim/` (wiki + frame are canonical, diffable knowledge).
4. **Mention semantic recall** as optional: `/engraim:enable-semantic`. Make clear keyword
   recall already works and semantic is a nice-to-have that adds a dependency.
5. **Finish.** Call `mark_onboarded` (stops the first-run nudge) and give a two-line tour:
   just work normally — sessions are captured and distilled (`/engraim:curate`), corrections
   become calibration (`/engraim:calibrate`), recurring procedures can become skills
   (`/engraim:draft-skill`), and `/engraim:lint` surfaces knowledge gaps.

## Discipline
- Prefer detected facts over asked ones. Every question has a cost.
- Seed, don't overfit: a few solid frame lines beat a wall of speculation.
- Don't record secrets from config files you scan.
