-- EngrAIm schema v1 (documentary; store.py builds this in code and is the source of truth).
-- Bitemporal fact store + unified FTS index + wiki + episodes/sources.
-- Migrations are forward-only and additive so older workspaces upgrade safely in place.

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,              -- session | research | note
  content TEXT,
  source_url TEXT,
  source_tier TEXT,               -- first-party | reputable | community | unverified
  session_id TEXT,
  fetched_at TEXT,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY,
  subject TEXT, predicate TEXT, object TEXT,
  valid_from TEXT, valid_until TEXT,            -- truth in the world
  recorded_at TEXT NOT NULL, invalidated_at TEXT,-- when we learned/superseded it
  confidence REAL DEFAULT 0.5,
  corroboration_count INTEGER DEFAULT 1,
  source_episode_id INTEGER REFERENCES episodes(id)
);

CREATE TABLE IF NOT EXISTS wiki (
  page TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Unified full-text index across facts, wiki, and episodes (hybrid recall; vec added later).
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(kind, ref, text);
