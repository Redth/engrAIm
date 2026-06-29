---
name: engraim-retro
description: >
  Run a periodic, GUARDED retrospective over the workspace memory: consolidate learnings,
  resolve verdicts, prune stale overrides, surface promotions. Use when the user runs
  /engraim:retro, when status shows many pending sessions or expiring overrides, or when a
  body of work has accumulated and the memory needs tightening. Enforces an echo-chamber
  guardrail and an action test so the retrospective improves the memory rather than just
  reinforcing it.
---

# Retrospective (guarded)

Goal: make the memory *tighter and more useful*, not just bigger or more self-confirming.

## Inputs to review
- `list_overrides` — active behavior overrides (note expiring_soon and promotion_candidate).
- `pending_verdicts` — resolved verdicts (act on them) and unresolved ones (chase or drop).
- Recently staged sessions (`list_pending`) and low-confidence / conflicting facts.
- Duplicative or stale wiki pages.

## Actions
- **Consolidate:** merge near-duplicate wiki pages (`wiki_get` then `wiki_upsert`); `supersede`
  facts that changed; turn resolved **negative** verdicts into `calibrate` rules.
- **Promote / prune:** offer `promote_override` for well-worn standing overrides; let stale
  ones expire (do NOT reaffirm what no longer applies); record removed sources in `registry.md`.

## Guardrails — apply BEFORE keeping anything
1. **Echo-chamber test:** would this consolidation survive contact with a *contradicting*
   source? Actively look for disconfirming evidence in the sessions/facts before promoting a
   belief. Don't promote something just because it was repeated.
2. **Action test:** keep a learning only if it would change a *future action*. If it wouldn't
   alter what you'd do next time, it's trivia — drop it. No silent drops of real decisions,
   though: if something notable isn't worth a full page, leave a one-line fact with provenance.

## Output
A short summary: what was consolidated/promoted/pruned, and — explicitly — what you chose
NOT to keep and why. Brevity over completeness.
