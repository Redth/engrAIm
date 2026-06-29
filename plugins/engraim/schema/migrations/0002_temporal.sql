-- EngrAIm schema v2 — temporal + corroboration layer (documentary; store.mjs reconciles
-- these additively at runtime via PRAGMA table_info, so upgrades are self-healing).
--
-- Additive columns on facts:
ALTER TABLE facts ADD COLUMN previous_id INTEGER;   -- supersede chain: new fact -> the one it replaced
ALTER TABLE facts ADD COLUMN last_seen_at TEXT;     -- most recent corroboration (recorded_at stays = first seen)
--
-- Behavior introduced in v2 (in code, not schema):
--   * remember() dedupes: an identical current fact is CORROBORATED (corroboration_count++,
--     confidence rises on a diminishing-returns curve) instead of duplicated.
--   * same subject+predicate / different object surfaces `siblings` (possible update vs.
--     multi-valued predicate) rather than guessing.
--   * whats_true(entity, asOf) does transaction-time travel: facts believed as of a moment
--     (recorded_at <= asOf AND (invalidated_at IS NULL OR invalidated_at > asOf)).
--   * history(subject[,predicate]) returns the full versioned timeline + status.
--   * recall flags superseded facts so stale values read as historical.
