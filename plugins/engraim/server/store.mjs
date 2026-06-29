// EngrAIm storage core — pure Node, ZERO dependencies.
// Uses the built-in node:sqlite module (Node >= 24, FTS5 compiled in) with FTS5. No npm install.
//
// Single place that touches the workspace DB, shared by the MCP server
// (engraim_server.mjs) and the hook adapter (cli.mjs).
//
// Workspace layout (under <project>/.engraim/):
//   store.db   derived SQLite index (FTS5 + bitemporal facts) -- rebuildable
//   frame/SOUL.md ENV.md USER.md   always-injected hot tiers
//   wiki/*.md   canonical knowledge pages ([[wikilinks]])     -- source of truth
//   sources/    immutable raw captures
//   calibration/_log.md registry.md   learning + trust tiers
//   pending/sessions.jsonl   sessions staged by the Stop hook
//   manifest.json   { schema_version, workspace_id, ... }

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const SCHEMA_VERSION = 5;

// Patterns the skill gatekeeper flags in bundled scripts (blocking unless force-promoted).
const DANGEROUS_PATTERNS = [
  [/rm\s+-rf?\s+(\/(?:\s|$)|\/\*|~|\$HOME)/, 'recursive delete of a root/home path'],
  [/\bmkfs\b/, 'filesystem format (mkfs)'],
  [/\bdd\b[^\n]*of=\/dev\//, 'raw write to a block device (dd of=/dev/...)'],
  [/>\s*\/dev\/sd[a-z]/, 'redirect to a block device'],
  [/:\s*\(\s*\)\s*\{[^}]*\|\s*:\s*;\s*\}\s*;\s*:/, 'fork bomb'],
  [/(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(sh|bash)/, 'pipe remote script straight to a shell'],
  [/\bchmod\s+-R?\s*777\s+\//, 'world-writable chmod on an absolute path'],
];

const DEFAULT_TTL_DAYS = 90;        // standing overrides expire unless reaffirmed
const PROMOTION_THRESHOLD = 3;      // reaffirmations before suggesting permanent promotion
const EXPIRING_SOON_DAYS = 14;      // window for "reaffirm to keep" nudges

// Columns added after v1, reconciled additively against the live schema (SQLite has no
// ADD COLUMN IF NOT EXISTS, so we inspect PRAGMA table_info and add only what's missing).
// Additive-only by design: this makes upgrades self-healing without per-version scripts.
const EXTRA_COLUMNS = {
  facts: {
    previous_id: 'INTEGER',   // supersede chain: this fact replaced previous_id
    last_seen_at: 'TEXT',     // most recent corroboration time (recorded_at stays = first seen)
  },
};

const now = () => new Date().toISOString();

export function findWorkspace(start) {
  let cur = path.resolve(start || process.cwd());
  while (true) {
    const cand = path.join(cur, '.engraim');
    try { if (fs.statSync(cand).isDirectory()) return cand; } catch {}
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

export function resolveWorkspace(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.ENGRAIM_WORKSPACE) return path.resolve(process.env.ENGRAIM_WORKSPACE);
  const found = findWorkspace();
  if (found) return found;
  if (process.env.CLAUDE_PROJECT_DIR) return path.resolve(process.env.CLAUDE_PROJECT_DIR, '.engraim');
  return path.resolve(process.cwd(), '.engraim');
}

function ftsQuery(text) {
  const terms = (text.match(/[A-Za-z0-9_]+/g) || []).filter(t => t.length > 1).slice(0, 12);
  return terms.join(' OR ');
}

// Normalize for matching only (storage keeps original casing/spacing).
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// Starting confidence by source trust tier; corroboration raises it from there.
function tierBase(tier) {
  return ({ 'first-party': 0.7, reputable: 0.6, community: 0.5, unverified: 0.4 })[tier] ?? 0.5;
}

// Diminishing-returns curve: n=1 -> 0.5, 2 -> 0.75, 3 -> 0.833, 4 -> 0.875 ... caps below 1.
const confFromCorroboration = (n) => 1 - 0.5 / Math.max(1, n);

export class Store {
  constructor(workspace) {
    this.ws = path.resolve(workspace);
    for (const d of ['', 'wiki', 'sources', 'pending', 'frame']) {
      fs.mkdirSync(path.join(this.ws, d), { recursive: true });
    }
    this.dbPath = path.join(this.ws, 'store.db');
    // allowExtension lets the OPTIONAL semantic layer load sqlite-vec; extension loading
    // stays disabled until that layer explicitly calls enableLoadExtension(true).
    this.db = new DatabaseSync(this.dbPath, { allowExtension: true });
    this._initDb();
  }

  _initDb() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY, kind TEXT NOT NULL, content TEXT,
        source_url TEXT, source_tier TEXT, session_id TEXT,
        fetched_at TEXT, recorded_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT,
        valid_from TEXT, valid_until TEXT, recorded_at TEXT NOT NULL,
        invalidated_at TEXT, confidence REAL DEFAULT 0.5,
        corroboration_count INTEGER DEFAULT 1, source_episode_id INTEGER);
      CREATE TABLE IF NOT EXISTS wiki (
        page TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calibration_overrides (
        id INTEGER PRIMARY KEY, rule TEXT NOT NULL, scope TEXT,
        tier TEXT DEFAULT 'standing',     -- standing | permanent
        status TEXT DEFAULT 'active',     -- active | expired | retired
        set_at TEXT NOT NULL, expires_at TEXT,   -- expires_at NULL => permanent
        reaffirm_count INTEGER DEFAULT 1, reason TEXT, source TEXT);
      CREATE TABLE IF NOT EXISTS skills (
        name TEXT PRIMARY KEY,
        status TEXT DEFAULT 'pending',   -- pending | active | retired | proposed
        description TEXT, source TEXT,
        created_at TEXT NOT NULL, promoted_at TEXT, path TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(kind, ref, text);
    `);
    this._reconcileColumns();
    if (this.getMeta('schema_version') == null) this.setMeta('schema_version', String(SCHEMA_VERSION));
  }

  // Self-healing additive migration: add any columns in EXTRA_COLUMNS that the live
  // table is missing. Idempotent — safe to run on every startup.
  _reconcileColumns() {
    for (const [table, cols] of Object.entries(EXTRA_COLUMNS)) {
      const existing = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
      for (const [col, type] of Object.entries(cols)) {
        if (!existing.has(col)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      }
    }
  }

  // Forward-only, additive, idempotent migrations. New versions add guarded
  // CREATE/ALTER statements here so older workspaces upgrade safely in place.
  migrate(target = SCHEMA_VERSION) {
    this._initDb();
    this.setMeta('schema_version', String(target));
    return target;
  }

  getMeta(key) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);
    return row ? row.value : null;
  }
  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }

  ensureManifest() {
    const mpath = path.join(this.ws, 'manifest.json');
    let m = {};
    try { m = JSON.parse(fs.readFileSync(mpath, 'utf8')); } catch { m = { engraim: true }; }
    if (!m.workspace_id) m.workspace_id = randomUUID().replace(/-/g, '').slice(0, 12);
    if (!m.created_at) m.created_at = now();
    m.schema_version = Number(this.getMeta('schema_version') || SCHEMA_VERSION);
    fs.writeFileSync(mpath, JSON.stringify(m, null, 2) + '\n');
    return m;
  }

  _index(kind, ref, text) {
    if (text) this.db.prepare('INSERT INTO search_index(kind, ref, text) VALUES(?,?,?)').run(kind, String(ref), text);
  }

  addEpisode(kind, content, { sourceUrl = null, sourceTier = null, sessionId = null, fetchedAt = null } = {}) {
    const r = this.db.prepare(
      'INSERT INTO episodes(kind,content,source_url,source_tier,session_id,fetched_at,recorded_at) VALUES(?,?,?,?,?,?,?)'
    ).run(kind, content, sourceUrl, sourceTier, sessionId, fetchedAt, now());
    const eid = Number(r.lastInsertRowid);
    this._index('episode', eid, content || '');
    return eid;
  }

  // Store a durable fact. If an identical current fact (same subject/predicate/object,
  // normalized) already exists, CORROBORATE it (bump count + confidence + last_seen,
  // add a provenance episode) instead of inserting a duplicate. If a current fact shares
  // subject+predicate but has a DIFFERENT object, that's a possible update or a
  // multi-valued predicate — we don't guess: we insert the new fact and surface the
  // siblings so the caller can choose to supersede.
  remember(observation, { subject = null, predicate = null, object = null, sourceUrl = null, sourceTier = null, sessionId = null, validFrom = null } = {}) {
    const subj = subject || '_workspace';
    const pred = predicate || 'note';
    const obj = object || observation;

    const eid = this.addEpisode(sourceUrl ? 'research' : 'note', observation, { sourceUrl, sourceTier, sessionId, fetchedAt: sourceUrl ? now() : null });

    // 1) exact current match -> corroborate
    const match = this.db.prepare(
      `SELECT id, corroboration_count, confidence FROM facts
       WHERE lower(trim(subject))=? AND lower(trim(predicate))=? AND lower(trim(object))=?
         AND invalidated_at IS NULL ORDER BY id LIMIT 1`
    ).get(norm(subj), norm(pred), norm(obj));
    if (match) {
      const n = (match.corroboration_count || 1) + 1;
      const conf = Math.max(match.confidence || 0, confFromCorroboration(n));
      this.db.prepare('UPDATE facts SET corroboration_count=?, confidence=?, last_seen_at=? WHERE id=?')
        .run(n, conf, now(), match.id);
      return { corroborated: true, fact_id: match.id, subject: subj, predicate: pred, object: obj,
               corroboration_count: n, confidence: conf, low_confidence: n < 2 };
    }

    // 2) same subject+predicate, different object -> potential conflict; insert + surface
    const siblings = this.db.prepare(
      `SELECT id, object FROM facts
       WHERE lower(trim(subject))=? AND lower(trim(predicate))=? AND invalidated_at IS NULL`
    ).all(norm(subj), norm(pred));

    const conf = tierBase(sourceTier);
    const r = this.db.prepare(
      'INSERT INTO facts(subject,predicate,object,valid_from,recorded_at,last_seen_at,confidence,corroboration_count,source_episode_id) VALUES(?,?,?,?,?,?,?,1,?)'
    ).run(subj, pred, obj, validFrom || now(), now(), now(), conf, eid);
    const fid = Number(r.lastInsertRowid);
    this._index('fact', fid, `${subj} ${pred} ${obj}`);
    const out = { fact_id: fid, episode_id: eid, subject: subj, predicate: pred, object: obj,
                  confidence: conf, corroboration_count: 1, low_confidence: true };
    if (siblings.length) {
      out.siblings = siblings.map(s => ({ fact_id: s.id, object: s.object }));
      out.note = `Other current fact(s) share this subject+predicate. If this REPLACES one of them, call supersede(fact_id, new_object); if it's an additional value, leave as-is.`;
    }
    return out;
  }

  // Mark a fact as no longer believed and record its replacement. Never deletes — the
  // old version stays queryable via history() and as-of queries. Links new.previous_id->old.
  supersede(factId, newObject) {
    const row = this.db.prepare('SELECT subject,predicate FROM facts WHERE id=?').get(factId);
    if (!row) return { error: `fact ${factId} not found` };
    const t = now();
    this.db.prepare('UPDATE facts SET valid_until=?, invalidated_at=? WHERE id=? AND invalidated_at IS NULL').run(t, t, factId);
    const created = this.remember(newObject, { subject: row.subject, predicate: row.predicate });
    if (created.fact_id) this.db.prepare('UPDATE facts SET previous_id=? WHERE id=?').run(factId, created.fact_id);
    return { superseded_fact_id: factId, new_fact_id: created.fact_id, subject: row.subject, predicate: row.predicate, new_object: newObject };
  }

  // Current facts about an entity, or — if asOf (ISO time) is given — the facts we
  // BELIEVED as of that moment (transaction-time snapshot): recorded by then and not yet
  // invalidated by then. This is the "what did we know as of <date>" time-travel query.
  whatsTrue(entity, asOf = null) {
    let rows;
    if (asOf) {
      rows = this.db.prepare(
        `SELECT id,subject,predicate,object,recorded_at,confidence,corroboration_count
         FROM facts WHERE subject=? AND recorded_at<=?
           AND (invalidated_at IS NULL OR invalidated_at>?) ORDER BY recorded_at DESC`
      ).all(entity, asOf, asOf);
    } else {
      rows = this.db.prepare(
        `SELECT id,subject,predicate,object,recorded_at,confidence,corroboration_count
         FROM facts WHERE subject=? AND invalidated_at IS NULL ORDER BY recorded_at DESC`
      ).all(entity);
    }
    return rows.map(r => (r.corroboration_count < 2 ? { ...r, low_confidence: true } : r));
  }

  // Full timeline for a subject (optionally one predicate): every version with its
  // temporal fields and a derived status, oldest first — shows the supersede chain.
  history(subject, predicate = null) {
    const sql = `SELECT id,subject,predicate,object,recorded_at,valid_until,invalidated_at,
                 previous_id,corroboration_count,confidence FROM facts
                 WHERE subject=?${predicate ? ' AND predicate=?' : ''} ORDER BY recorded_at ASC`;
    const rows = predicate ? this.db.prepare(sql).all(subject, predicate) : this.db.prepare(sql).all(subject);
    return rows.map(r => ({ ...r, status: r.invalidated_at ? 'superseded' : 'current' }));
  }

  recall(query, k = 8) {
    const q = ftsQuery(query);
    if (!q) return [];
    let rows;
    try {
      rows = this.db.prepare(
        "SELECT kind, ref, snippet(search_index, 2, '[', ']', ' … ', 12) AS snip FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT ?"
      ).all(q, k);
    } catch { return []; }
    return rows.map(r => {
      const item = { kind: r.kind, ref: r.ref, snippet: r.snip };
      if (r.kind === 'fact') {
        const fr = this.db.prepare('SELECT corroboration_count, invalidated_at FROM facts WHERE id=?').get(Number(r.ref));
        if (fr && fr.corroboration_count < 2) item.low_confidence = true;
        if (fr && fr.invalidated_at) item.superseded = true;
      }
      return item;
    });
  }

  _wikiPath(page) {
    const safe = (page.replace(/[^A-Za-z0-9 _.-]/g, '').trim().replace(/ /g, '-')) || 'untitled';
    return path.join(this.ws, 'wiki', `${safe}.md`);
  }

  wikiUpsert(page, content, links = []) {
    let body = content.replace(/\s+$/, '') + '\n';
    if (links && links.length) body += '\n## Related\n' + links.map(l => `- [[${l}]]\n`).join('');
    const p = this._wikiPath(page);
    fs.writeFileSync(p, body);
    this.db.prepare('INSERT INTO wiki(page,content,updated_at) VALUES(?,?,?) ON CONFLICT(page) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at').run(page, body, now());
    this.db.prepare("DELETE FROM search_index WHERE kind='wiki' AND ref=?").run(page);
    this._index('wiki', page, `${page}\n${body}`);
    return { page, path: p, links };
  }

  wikiGet(page) {
    const p = this._wikiPath(page);
    if (fs.existsSync(p)) return { page, path: p, content: fs.readFileSync(p, 'utf8') };
    const row = this.db.prepare('SELECT content FROM wiki WHERE page=?').get(page);
    return row ? { page, content: row.content } : null;
  }

  stageSession(sessionId, transcriptPath, reason = 'stop') {
    const rec = { session_id: sessionId, transcript_path: transcriptPath, ended_at: now(), reason };
    fs.appendFileSync(path.join(this.ws, 'pending', 'sessions.jsonl'), JSON.stringify(rec) + '\n');
    return rec;
  }

  listPending() {
    const p = path.join(this.ws, 'pending', 'sessions.jsonl');
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  clearPending() {
    const p = path.join(this.ws, 'pending', 'sessions.jsonl');
    const n = this.listPending().length;
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return n;
  }

  // Mechanical first pass over a Claude Code session JSONL. Registers it as an
  // immutable source and returns a digest. Distillation is model-driven (the
  // engraim-curate skill); this only does deterministic scaffolding.
  ingestSession(transcriptPath) {
    const tp = transcriptPath.startsWith('~') ? path.join(process.env.HOME || '', transcriptPath.slice(1)) : transcriptPath;
    if (!fs.existsSync(tp)) return { error: `transcript not found: ${transcriptPath}` };
    let firstPrompt = null; const commands = []; const files = new Set(); let errors = 0; let n = 0;
    const sessionId = path.basename(tp, '.jsonl');
    for (const line of fs.readFileSync(tp, 'utf8').split('\n')) {
      const t = line.trim(); if (!t) continue;
      let rec; try { rec = JSON.parse(t); } catch { continue; }
      n++;
      const msg = rec.message || rec;
      const role = rec.type || msg.role;
      let blocks = [];
      if (Array.isArray(msg.content)) blocks = msg.content;
      else if (typeof msg.content === 'string') blocks = [{ type: 'text', text: msg.content }];
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text' && (role === 'user' || role === 'human') && firstPrompt == null) {
          firstPrompt = String(b.text || '').slice(0, 280);
        } else if (b.type === 'tool_use') {
          const inp = b.input || {};
          if (inp.command) commands.push(String(inp.command).slice(0, 200));
          for (const key of ['file_path', 'path', 'notebook_path']) if (inp[key]) files.add(String(inp[key]));
        } else if (b.type === 'tool_result') {
          const txt = JSON.stringify(b.content || '').slice(0, 4000).toLowerCase();
          if (txt.includes('error') || txt.includes('traceback') || txt.includes('failed')) errors++;
        }
      }
    }
    const digest = { session_id: sessionId, messages: n, first_prompt: firstPrompt, commands: commands.slice(0, 25), files_touched: [...files].sort().slice(0, 40), error_signals: errors };
    this.addEpisode('session', JSON.stringify(digest), { sessionId });
    return digest;
  }

  // ---- calibration: how Claude should behave in THIS workspace --------------
  // Distinct from facts (about the world). Standing overrides are active + expiring;
  // re-affirming refreshes expiry and counts toward promotion. The promotion ladder is
  // logged-correction -> standing (auto, expiring) -> permanent (deliberate, written to
  // frame/SOUL.md, no expiry).

  _daysFromNow(days) {
    return new Date(Date.now() + days * 86400000).toISOString();
  }

  // Mark active overrides whose expiry has passed as 'expired'. Returns count expired.
  expireOverrides() {
    const r = this.db.prepare(
      "UPDATE calibration_overrides SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at < ?"
    ).run(now());
    if (r.changes) this._projectCalibration();
    return r.changes;
  }

  // Record a correction/preference. Re-stating an active match REAFFIRMS it (count++,
  // expiry refreshed) instead of duplicating. New ones start as standing + expiring.
  calibrate(rule, { scope = null, reason = null, source = null, ttlDays = DEFAULT_TTL_DAYS, tier = 'standing' } = {}) {
    this.expireOverrides();
    const existing = this.db.prepare(
      "SELECT id, reaffirm_count, tier FROM calibration_overrides WHERE lower(trim(rule))=? AND status='active' LIMIT 1"
    ).get(norm(rule));
    if (existing) {
      const n = (existing.reaffirm_count || 1) + 1;
      const exp = existing.tier === 'permanent' ? null : this._daysFromNow(ttlDays);
      this.db.prepare('UPDATE calibration_overrides SET reaffirm_count=?, expires_at=?, reason=COALESCE(?,reason) WHERE id=?')
        .run(n, exp, reason, existing.id);
      this._projectCalibration();
      return { reaffirmed: true, id: existing.id, rule, tier: existing.tier, reaffirm_count: n,
               promotion_candidate: existing.tier === 'standing' && n >= PROMOTION_THRESHOLD };
    }
    const expires = tier === 'permanent' ? null : this._daysFromNow(ttlDays);
    const r = this.db.prepare(
      'INSERT INTO calibration_overrides(rule,scope,tier,status,set_at,expires_at,reaffirm_count,reason,source) VALUES(?,?,?,?,?,?,1,?,?)'
    ).run(rule, scope, tier, 'active', now(), expires, reason, source);
    if (tier === 'permanent') this._writePermanentToSoul();
    this._projectCalibration();
    return { id: Number(r.lastInsertRowid), rule, scope, tier, expires_at: expires, reaffirm_count: 1 };
  }

  // Active overrides (after sweeping expiries), annotated with expiry/promotion signals.
  activeOverrides() {
    this.expireOverrides();
    const rows = this.db.prepare(
      "SELECT id,rule,scope,tier,set_at,expires_at,reaffirm_count FROM calibration_overrides WHERE status='active' ORDER BY (tier='permanent') DESC, set_at"
    ).all();
    return rows.map(r => {
      const out = { ...r };
      if (r.expires_at) {
        const days = Math.round((Date.parse(r.expires_at) - Date.now()) / 86400000);
        out.days_until_expiry = days;
        if (days <= EXPIRING_SOON_DAYS) out.expiring_soon = true;
      }
      if (r.tier === 'standing' && r.reaffirm_count >= PROMOTION_THRESHOLD) out.promotion_candidate = true;
      return out;
    });
  }

  // Graduate a standing override to permanent: no expiry, written into frame/SOUL.md.
  promoteOverride(id) {
    const row = this.db.prepare("SELECT * FROM calibration_overrides WHERE id=? AND status='active'").get(id);
    if (!row) return { error: `active override ${id} not found` };
    this.db.prepare("UPDATE calibration_overrides SET tier='permanent', expires_at=NULL WHERE id=?").run(id);
    this._writePermanentToSoul();
    this._projectCalibration();
    return { promoted: id, tier: 'permanent', rule: row.rule };
  }

  retireOverride(id) {
    const r = this.db.prepare("UPDATE calibration_overrides SET status='retired' WHERE id=? AND status='active'").run(id);
    if (r.changes) { this._writePermanentToSoul(); this._projectCalibration(); }
    return { retired: id, changed: r.changes };
  }

  // Maintain a managed block of permanent rules inside frame/SOUL.md, leaving the rest
  // of the file (user-authored) untouched.
  _writePermanentToSoul() {
    const fp = path.join(this.ws, 'frame', 'SOUL.md');
    let txt = '';
    try { txt = fs.readFileSync(fp, 'utf8'); } catch {}
    const START = '<!-- engraim:permanent-rules:start -->';
    const END = '<!-- engraim:permanent-rules:end -->';
    const perms = this.db.prepare("SELECT rule FROM calibration_overrides WHERE tier='permanent' AND status='active' ORDER BY set_at").all();
    const block = `${START}\n## Permanent rules (managed by EngrAIm)\n${perms.map(p => `- ${p.rule}`).join('\n') || '- (none)'}\n${END}`;
    const re = new RegExp(`${START}[\\s\\S]*?${END}`);
    if (re.test(txt)) txt = txt.replace(re, block);
    else txt = txt.replace(/\s*$/, '') + `\n\n${block}\n`;
    fs.writeFileSync(fp, txt);
  }

  // Project active/expired overrides into calibration/overrides.md for human + git visibility.
  _projectCalibration() {
    const active = this.db.prepare("SELECT * FROM calibration_overrides WHERE status='active' ORDER BY (tier='permanent') DESC, set_at").all();
    const expired = this.db.prepare("SELECT rule,expires_at FROM calibration_overrides WHERE status='expired' ORDER BY expires_at DESC LIMIT 10").all();
    const row = o => `| ${o.rule.replace(/\|/g, '\\|')} | ${o.scope || ''} | ${o.tier} | ${o.expires_at ? o.expires_at.slice(0, 10) : 'permanent'} | ${o.reaffirm_count} |`;
    let md = `# Calibration — active overrides\n\n`;
    md += `How EngrAIm should behave in this workspace. Standing overrides expire unless reaffirmed; permanent rules also live in frame/SOUL.md. Managed by EngrAIm — edit via /engraim:calibrate.\n\n`;
    md += `| Rule | Scope | Tier | Expires | Reaffirms |\n|------|-------|------|---------|----------|\n`;
    md += (active.map(row).join('\n') || '| _(none yet)_ | | | | |') + '\n';
    if (expired.length) md += `\n## Recently expired\n` + expired.map(e => `- ${e.rule} (expired ${e.expires_at ? e.expires_at.slice(0, 10) : ''})`).join('\n') + '\n';
    fs.mkdirSync(path.join(this.ws, 'calibration'), { recursive: true });
    fs.writeFileSync(path.join(this.ws, 'calibration', 'overrides.md'), md);
  }

  // Verdict-annotation feedback: scan markdown for `verdict: <value>` tags. Unresolved
  // (pending/empty) verdicts are work for the retrospective; resolved ones are signals to
  // recalibrate (a 'bad' verdict on something becomes a calibration override).
  scanVerdicts() {
    const out = [];
    const dirs = ['wiki', 'calibration', 'frame'];
    for (const d of dirs) {
      const dir = path.join(this.ws, d);
      let entries = [];
      try { entries = fs.readdirSync(dir); } catch { continue; }
      for (const f of entries) {
        if (!f.endsWith('.md')) continue;
        const fp = path.join(dir, f);
        const lines = fs.readFileSync(fp, 'utf8').split('\n');
        lines.forEach((line, i) => {
          const m = line.match(/verdict:\s*([^\n]*)/i);
          if (m) {
            const value = m[1].trim();
            out.push({ file: `${d}/${f}`, line: i + 1, verdict: value || null,
                       resolved: !!value && !/^pending$/i.test(value), context: line.trim().slice(0, 160) });
          }
        });
      }
    }
    return out;
  }

  // ---- skill promotion: workspace grows its own capabilities ---------------
  // Ladder: draft -> .engraim/pending/skills/<name>/ (inert) -> gatekeeper review ->
  // .claude/skills/<name>/ (active for Claude Code in this project) -> (manual) PR to
  // the shipped plugin. Drafts under .engraim/ are NOT loaded by Claude Code; only the
  // promoted copy in .claude/skills/ is. Promotion is gated: structural + safety checks
  // must pass (safety warnings block unless force).

  _projectRoot() { return path.dirname(this.ws); }
  _pendingSkillsDir() { return path.join(this.ws, 'pending', 'skills'); }
  _activeSkillsDir() { return path.join(this._projectRoot(), '.claude', 'skills'); }

  // Ensure the project's .claude/skills/ exists so Claude Code watches it from session
  // start (a dir created mid-session isn't watched until restart). Call at SessionStart.
  ensureClaudeSkillsDir() {
    fs.mkdirSync(this._activeSkillsDir(), { recursive: true });
  }

  _frontmatter(text) {
    const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
    const fm = {};
    if (m) for (const line of m[1].split('\n')) {
      const mm = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (mm) fm[mm[1].trim()] = mm[2].trim();
    }
    return { fm, hasBlock: !!m };
  }

  // Gatekeeper: structural validity + duplicate check + script safety scan.
  _gateSkill(name, dir) {
    const checks = [];
    const warnings = [];
    const skillMd = path.join(dir, 'SKILL.md');
    const exists = fs.existsSync(skillMd);
    checks.push({ check: 'SKILL.md present', pass: exists });
    let fm = {}, hasBlock = false;
    if (exists) ({ fm, hasBlock } = this._frontmatter(fs.readFileSync(skillMd, 'utf8')));
    checks.push({ check: 'has frontmatter block', pass: hasBlock });
    checks.push({ check: 'has name', pass: !!fm.name, detail: fm.name || '(missing)' });
    checks.push({ check: 'has description', pass: !!fm.description, detail: fm.description ? 'ok' : '(missing)' });
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
    checks.push({ check: 'name is kebab-case', pass: kebab });
    checks.push({ check: 'frontmatter name matches dir', pass: !fm.name || fm.name === name, detail: fm.name && fm.name !== name ? `${fm.name} != ${name}` : 'ok' });

    // duplicate vs already-active or shipped (engraim:) skills
    const activeDup = fs.existsSync(path.join(this._activeSkillsDir(), name));
    const shippedDup = ['engraim-memory', 'engraim-research', 'engraim-curate', 'engraim-calibrate', 'engraim-retro', 'engraim-skillsmith'].includes(name);
    checks.push({ check: 'not a duplicate', pass: !activeDup && !shippedDup, detail: activeDup ? 'already active' : shippedDup ? 'shadows a shipped skill' : 'ok' });

    // safety scan over every text file in the skill dir
    if (exists) {
      const scan = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const fp = path.join(d, e.name);
          if (e.isDirectory()) { scan(fp); continue; }
          let txt = ''; try { txt = fs.readFileSync(fp, 'utf8'); } catch { continue; }
          for (const [re, why] of DANGEROUS_PATTERNS) if (re.test(txt)) warnings.push({ file: path.relative(dir, fp), risk: why });
        }
      };
      scan(dir);
    }
    const ok = checks.every(c => c.pass);
    return { ok, blocked_by_safety: warnings.length > 0, checks, warnings };
  }

  draftSkill(name, { description = '', body = '', scripts = {}, source = null } = {}) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return { error: `skill name must be kebab-case: got "${name}"` };
    const dir = path.join(this._pendingSkillsDir(), name);
    fs.mkdirSync(dir, { recursive: true });
    const fmDesc = description.replace(/\n/g, ' ').trim();
    const md = `---\nname: ${name}\ndescription: ${fmDesc}\n---\n\n${body.trim()}\n`;
    fs.writeFileSync(path.join(dir, 'SKILL.md'), md);
    for (const [rel, content] of Object.entries(scripts || {})) {
      const sp = path.join(dir, rel);
      fs.mkdirSync(path.dirname(sp), { recursive: true });
      fs.writeFileSync(sp, content);
    }
    this.db.prepare(
      `INSERT INTO skills(name,status,description,source,created_at,path) VALUES(?,?,?,?,?,?)
       ON CONFLICT(name) DO UPDATE SET description=excluded.description, status='pending', path=excluded.path`
    ).run(name, 'pending', fmDesc, source, now(), dir);
    return { drafted: name, path: dir, status: 'pending',
             note: 'Draft is staged and inert. Run review_skill then promote_skill (or /engraim:promote-skill) to activate it in .claude/skills/.' };
  }

  listSkills() {
    const rows = this.db.prepare('SELECT name,status,description,source,created_at,promoted_at,path FROM skills ORDER BY created_at').all();
    // reconcile with disk
    const pendingDisk = (() => { try { return fs.readdirSync(this._pendingSkillsDir()); } catch { return []; } })();
    const activeDisk = (() => { try { return fs.readdirSync(this._activeSkillsDir()); } catch { return []; } })();
    return { tracked: rows, pending_on_disk: pendingDisk.filter(n => !n.startsWith('.')), active_on_disk: activeDisk.filter(n => !n.startsWith('.')) };
  }

  reviewSkill(name) {
    const dir = path.join(this._pendingSkillsDir(), name);
    if (!fs.existsSync(dir)) return { error: `no pending skill named ${name}` };
    return { name, ...this._gateSkill(name, dir) };
  }

  promoteSkill(name, { force = false } = {}) {
    const src = path.join(this._pendingSkillsDir(), name);
    if (!fs.existsSync(src)) return { error: `no pending skill named ${name}` };
    const gate = this._gateSkill(name, src);
    if (!gate.ok) return { promoted: false, reason: 'failed structural checks', ...gate };
    if (gate.blocked_by_safety && !force) return { promoted: false, reason: 'safety warnings — review and re-run with force to override', ...gate };
    this.ensureClaudeSkillsDir();
    const dest = path.join(this._activeSkillsDir(), name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    this.db.prepare("UPDATE skills SET status='active', promoted_at=?, path=? WHERE name=?").run(now(), dest, name);
    return { promoted: true, name, path: dest, forced: force && gate.blocked_by_safety, checks: gate.checks, warnings: gate.warnings };
  }

  retireSkill(name) {
    const dest = path.join(this._activeSkillsDir(), name);
    const existed = fs.existsSync(dest);
    fs.rmSync(dest, { recursive: true, force: true });
    this.db.prepare("UPDATE skills SET status='retired' WHERE name=?").run(name);
    return { retired: name, removed_from_active: existed };
  }

  // ---- wiki-gap lint: turn the knowledge graph's holes into a research agenda -------
  // Karpathy's "LLM wiki" pattern: scan for dangling [[links]] (explicit "write me"
  // requests), stub pages, orphans (nothing links in), and under-linked pages. Meta pages
  // (names starting with "_") are excluded from analysis.
  lintWiki({ stubChars = 200 } = {}) {
    const dir = path.join(this.ws, 'wiki');
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_')); } catch {}
    const sanitize = (t) => (t.replace(/[^A-Za-z0-9 _.-]/g, '').trim().replace(/ /g, '-')) || 'untitled';
    const pages = {};
    for (const f of files) {
      const name = f.replace(/\.md$/, '');
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const links = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim());
      pages[name] = { links, len: text.trim().length };
    }
    const existing = new Set(Object.keys(pages));
    const incoming = Object.fromEntries(Object.keys(pages).map(n => [n, 0]));
    const dangling = [];
    for (const [name, p] of Object.entries(pages)) {
      for (const link of p.links) {
        const target = sanitize(link);
        if (existing.has(target)) incoming[target]++;
        else dangling.push({ from: name, link });
      }
    }
    const stubs = [], orphans = [], underlinked = [];
    for (const [name, p] of Object.entries(pages)) {
      if (p.len < stubChars) stubs.push({ page: name, chars: p.len });
      if (incoming[name] === 0) orphans.push(name);
      if (p.links.length === 0) underlinked.push(name);
    }
    return { pages: Object.keys(pages).length, dangling, stubs, orphans, underlinked };
  }

  // Write a prioritized research agenda to wiki/_gaps.md (dangling links first — those are
  // concepts something already references but nobody has written yet).
  writeAgenda() {
    const l = this.lintWiki();
    let md = `# Research agenda (wiki gaps)\n\nGenerated by EngrAIm's wiki-gap lint. Work top-down; prefer gaps that would change a future action. Turn each into a page via research-as-intake, then re-run /engraim:lint.\n\n`;
    md += `## Dangling links (referenced but unwritten) — ${l.dangling.length}\n`;
    md += (l.dangling.map(d => `- [[${d.link}]] — referenced from \`${d.from}\``).join('\n') || '- (none)') + '\n\n';
    md += `## Stub pages (thin, need fleshing out) — ${l.stubs.length}\n`;
    md += (l.stubs.map(s => `- \`${s.page}\` (${s.chars} chars)`).join('\n') || '- (none)') + '\n\n';
    md += `## Orphans (nothing links in) — ${l.orphans.length}\n`;
    md += (l.orphans.map(o => `- \`${o}\``).join('\n') || '- (none)') + '\n\n';
    md += `## Under-linked (no outgoing links) — ${l.underlinked.length}\n`;
    md += (l.underlinked.map(u => `- \`${u}\``).join('\n') || '- (none)') + '\n';
    fs.mkdirSync(path.join(this.ws, 'wiki'), { recursive: true });
    fs.writeFileSync(path.join(this.ws, 'wiki', '_gaps.md'), md);
    return { path: path.join(this.ws, 'wiki', '_gaps.md'), ...l };
  }

  // ---- onboarding: deterministic project scan + first-run flag --------------
  isOnboarded() { return this.getMeta('onboarded') === '1'; }
  markOnboarded() { this.setMeta('onboarded', '1'); return { onboarded: true }; }

  // Read-only inspection of the project root to seed the frame (ENV.md). Shallow + safe.
  scanProject() {
    const root = this._projectRoot();
    const has = (f) => { try { return fs.existsSync(path.join(root, f)); } catch { return false; } };
    let entries = []; try { entries = fs.readdirSync(root); } catch {}
    const langs = new Set(); const signals = [];
    if (has('package.json')) {
      langs.add('JavaScript/TypeScript');
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        signals.push(`package.json (${pkg.name || 'unnamed'})`);
        if (pkg.scripts) signals.push('npm scripts: ' + Object.keys(pkg.scripts).slice(0, 8).join(', '));
      } catch {}
      signals.push(has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('package-lock.json') ? 'npm' : 'node (no lockfile)');
    }
    if (entries.some(e => e.endsWith('.csproj') || e.endsWith('.sln'))) { langs.add('.NET / C#'); signals.push('.NET project'); }
    if (has('pyproject.toml') || has('requirements.txt')) { langs.add('Python'); signals.push('Python project'); }
    if (has('go.mod')) { langs.add('Go'); signals.push('go.mod'); }
    if (has('Cargo.toml')) { langs.add('Rust'); signals.push('Cargo.toml'); }
    if (has('Dockerfile') || has('docker-compose.yml') || has('compose.yaml')) signals.push('Docker');
    if (has('Makefile')) signals.push('Makefile');
    if (has('.github/workflows')) signals.push('GitHub Actions');
    let remotes = [];
    try {
      const cfg = fs.readFileSync(path.join(root, '.git', 'config'), 'utf8');
      remotes = [...cfg.matchAll(/url\s*=\s*(.+)/g)].map(m => m[1].trim());
    } catch {}
    return { root, languages: [...langs], signals, git_remotes: remotes,
             top_level: entries.filter(e => !e.startsWith('.')).slice(0, 40) };
  }

  snapshot(maxChars = 4000) {
    const parts = [];
    for (const name of ['SOUL.md', 'ENV.md', 'USER.md']) {
      const fp = path.join(this.ws, 'frame', name);
      try { const txt = fs.readFileSync(fp, 'utf8').trim(); if (txt) parts.push(txt); } catch {}
    }
    return parts.join('\n\n').slice(0, maxChars);
  }

  status() {
    const count = sql => this.db.prepare(sql).get().c;
    const overrides = this.activeOverrides();
    return {
      schema_version: Number(this.getMeta('schema_version') || SCHEMA_VERSION),
      facts: count('SELECT COUNT(*) c FROM facts WHERE valid_until IS NULL'),
      wiki_pages: count('SELECT COUNT(*) c FROM wiki'),
      episodes: count('SELECT COUNT(*) c FROM episodes'),
      pending_sessions: this.listPending().length,
      active_overrides: overrides.length,
      overrides_expiring_soon: overrides.filter(o => o.expiring_soon).length,
      promotion_candidates: overrides.filter(o => o.promotion_candidate).length,
      pending_skills: count("SELECT COUNT(*) c FROM skills WHERE status='pending'"),
      active_skills: count("SELECT COUNT(*) c FROM skills WHERE status='active'"),
      wiki_gaps: this.lintWiki().dangling.length,
      onboarded: this.isOnboarded(),
      workspace: this.ws,
    };
  }
}
