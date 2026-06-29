---
description: Review (gate) and activate a drafted workspace skill into .claude/skills/.
---
Promote a pending workspace skill through the gatekeeper. Follow the `engraim-skillsmith` skill. In short:
1. If no skill name is given, run `list_skills` and ask which pending draft to promote.
2. Run `review_skill <name>` and show the user the gate verdict: structural checks (frontmatter, kebab-case name, no duplicate) and any **safety warnings** from the script scan.
3. If structural checks fail, fix the draft (edit the SKILL.md in `.engraim/pending/skills/<name>/`) and re-review — don't force past structural failures.
4. If there are safety warnings, show them to the user and get explicit confirmation before promoting with `force: true`. Never silently override a safety flag.
5. On a clean gate, call `promote_skill <name>` — it copies the skill into the project `.claude/skills/<name>/`, where Claude Code loads it (live, since SessionStart pre-creates the dir). Confirm what was activated.
