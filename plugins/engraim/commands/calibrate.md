---
description: Record a correction or behavior preference for this workspace (the self-improving frame).
---
Capture how EngrAIm should behave in this workspace — distinct from facts about the world.

Use the `engraim-calibrate` skill. In short:
1. Phrase the correction as a short imperative rule (e.g. "run the unit tests before proposing a commit", "prefer pnpm over npm here", "keep explanations terse"). Add a `scope` tag if it's domain-specific.
2. Call the `engraim-memory` server tool `calibrate` with the rule (and scope/reason). If a matching override already exists it will be REAFFIRMED — that's expected and strengthens it.
3. If the user signals this is a durable, non-negotiable rule (or `list_overrides` shows it as a promotion_candidate), offer to `promote_override` it to permanent, which writes it into `frame/SOUL.md`.
4. Confirm what was recorded and when it expires (standing overrides lapse in ~90 days unless reaffirmed).
