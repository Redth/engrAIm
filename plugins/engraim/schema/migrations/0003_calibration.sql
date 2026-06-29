-- EngrAIm schema v3 — self-improvement / calibration layer (documentary; store.mjs
-- creates this table with CREATE TABLE IF NOT EXISTS at runtime, so it's self-healing).
CREATE TABLE IF NOT EXISTS calibration_overrides (
  id INTEGER PRIMARY KEY,
  rule TEXT NOT NULL,
  scope TEXT,
  tier TEXT DEFAULT 'standing',     -- standing | permanent
  status TEXT DEFAULT 'active',     -- active | expired | retired
  set_at TEXT NOT NULL,
  expires_at TEXT,                  -- NULL => permanent (no expiry)
  reaffirm_count INTEGER DEFAULT 1,
  reason TEXT,
  source TEXT);
-- Behavior (in code):
--   * calibrate() records a behavior rule; re-stating an active match reaffirms it
--     (reaffirm_count++, expiry refreshed) instead of duplicating.
--   * standing overrides expire after ~90d unless reaffirmed; sweeps run at SessionStart.
--   * promotion ladder: logged correction -> standing (auto, expiring) ->
--     permanent (deliberate; written into frame/SOUL.md managed block, no expiry).
--   * active overrides are injected into the session frame at SessionStart and projected
--     to calibration/overrides.md for human/git visibility.
--   * verdict-annotation feedback: scanVerdicts() reads `verdict:` tags from markdown;
--     a negative resolved verdict should become a calibrate() rule.
