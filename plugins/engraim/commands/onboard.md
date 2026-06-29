---
description: Set up a new workspace — scan the project, seed the memory frame, and explain the workflow.
---
Onboard this workspace. Follow the `engraim-onboard` skill. In short:
1. Run `scan_project` and summarize what this project is (languages, tooling, scripts, git remotes).
2. Seed the frame by editing the files in `.engraim/frame/`: put the durable environment facts in `ENV.md` (concise, bounded), any obvious conventions in `SOUL.md`, and ask the user briefly about communication/working preferences for `USER.md` (one question, not an interrogation).
3. Offer `/engraim:backfill` to bootstrap memory from past sessions, and mention `/engraim:enable-semantic` as an optional upgrade.
4. Call `mark_onboarded` and give a two-line tour: work normally; sessions are captured and distilled via `/engraim:curate`; corrections become calibration via `/engraim:calibrate`; recurring procedures can become skills via `/engraim:draft-skill`.
