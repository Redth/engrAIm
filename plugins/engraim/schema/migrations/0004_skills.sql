-- EngrAIm schema v4 — skill promotion (documentary; store.mjs creates this table with
-- CREATE TABLE IF NOT EXISTS at runtime, so it's self-healing).
CREATE TABLE IF NOT EXISTS skills (
  name TEXT PRIMARY KEY,
  status TEXT DEFAULT 'pending',   -- pending | active | retired | proposed
  description TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  promoted_at TEXT,
  path TEXT);
-- Ladder (in code): draft -> .engraim/pending/skills/<name>/ (inert) ->
--   gatekeeper review (structural checks + script safety scan) ->
--   .claude/skills/<name>/ (active for Claude Code in this project) ->
--   (manual, gated) PR to the shipped plugin's skills/.
-- SessionStart pre-creates .claude/skills/ so promotions are watched without a restart.
