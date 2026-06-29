---
name: engraim-calibrate
description: >
  Record and manage how Claude should BEHAVE in this workspace — corrections, conventions,
  do/don't rules, tone. Use WHENEVER the user corrects you, states a preference, expresses
  frustration with an approach, or a `verdict:` annotation comes back negative. Also use to
  reaffirm, promote, or retire existing behavior overrides. This is the workspace's
  self-improving frame; it's distinct from facts about the world (use engraim-memory for those).
---

# Calibrate: the workspace's behavioral frame

Corrections about *how to act here* are first-class memory. Capturing them is what makes the
workspace get easier to work in over time.

## When to calibrate
- The user corrects your approach ("don't do X", "always Y here").
- They state a standing preference (tooling, style, process, tone).
- They push back or express frustration — the underlying preference is the override.
- A `verdict:` you left on prior work comes back negative — turn the lesson into a rule.

## How
- Phrase it as a short **imperative rule**: "run tests before committing", "prefer pnpm",
  "keep answers terse, no preamble". Add a `scope` tag (git, testing, tone, …) when domain-specific.
- Call `calibrate(rule, scope?, reason?)`. **Re-stating a rule you already have REAFFIRMS it**
  (refreshes its 90-day expiry and counts toward promotion) — that's good, not a duplicate.

## The promotion ladder
1. **Logged / one-off** — captured, low commitment.
2. **Standing** (default) — active and injected into every session; expires in ~90 days unless
   reaffirmed. This is the normal home for a preference.
3. **Permanent** — graduated via `promote_override(id)`; no expiry, written into `frame/SOUL.md`.
   Do this deliberately, when a preference has proven durable (often `promotion_candidate: true`).
   Workspace rules are written directly; a change to a *shipped plugin skill* is proposed as a
   PR instead, never auto-applied.

## Discipline
- **Expiry is a feature.** If a rule no longer applies, let it lapse — don't reaffirm it. Use
  `retire_override(id)` to drop one immediately.
- **Reaffirm honestly.** Only reaffirm when the rule actually held up again, so the promotion
  signal stays meaningful.
- **Don't pre-empt the user.** Record what they actually asked for, not an inflated version.
