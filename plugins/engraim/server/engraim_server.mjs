#!/usr/bin/env node
// EngrAIm memory MCP server (stdio) — pure Node, ZERO dependencies. No SDK.
//
// Implements the MCP stdio transport directly: newline-delimited JSON-RPC 2.0,
// stdout = protocol only, stderr = logs only. Lifecycle:
//   initialize -> (echo protocolVersion, advertise tools) ->
//   notifications/initialized (no reply) -> tools/list -> tools/call -> ping
//
// Run by Claude Code via the plugin's .mcp.json:
//   node ${CLAUDE_PLUGIN_ROOT}/server/engraim_server.mjs
// Workspace resolves from $ENGRAIM_WORKSPACE, else nearest .engraim/ walking up
// from cwd, else $CLAUDE_PROJECT_DIR/.engraim.

import readline from 'node:readline';
import { Store, resolveWorkspace } from './store.mjs';

const SERVER_INFO = { name: 'engraim-memory', version: '0.1.0' };
const FALLBACK_PROTOCOL = '2025-06-18';

const log = (...a) => process.stderr.write('[engraim] ' + a.join(' ') + '\n');

import path from 'node:path';
import { makeSemantic } from './semantic.mjs';

// Cache the Store + semantic provider per workspace (one project per server process).
let _store = null, _ws = null, _sem;
function getStore() {
  const ws = resolveWorkspace();
  if (!_store || _ws !== ws) { _store = new Store(ws); _ws = ws; _sem = undefined; }
  return _store;
}
async function getSem() {
  if (_sem === undefined) {
    getStore();
    try { _sem = await makeSemantic(_store.db, { vendorDir: path.join(_ws, 'vendor') }); }
    catch (e) { _sem = { enabled: false, reason: e.message, async upsert() {}, async search() { return []; } }; }
  }
  return _sem;
}
const EMBED_CAP = 2000;   // chars sent to the embedder

// Keep the vector index in step with a written fact/wiki row.
async function semUpsert(ref, text) {
  const sem = await getSem();
  if (sem.enabled) { try { await sem.upsert(ref, String(text).slice(0, EMBED_CAP)); } catch (e) { log('sem upsert', e.message); } }
}

function hydrate(ref) {
  const db = getStore().db;
  if (ref.startsWith('fact:')) {
    const r = db.prepare('SELECT subject,predicate,object,invalidated_at FROM facts WHERE id=?').get(Number(ref.slice(5)));
    if (r) return { kind: 'fact', ref: ref.slice(5), snippet: `${r.subject} ${r.predicate} ${r.object}`, superseded: !!r.invalidated_at };
  } else if (ref.startsWith('wiki:')) {
    return { kind: 'wiki', ref: ref.slice(5), snippet: ref.slice(5) };
  }
  return null;
}

// Hybrid recall: FTS (always) + vector (if semantic enabled), merged + deduped, tagged via.
async function hybridRecall(query, k) {
  const fts = getStore().recall(query, k).map(r => ({ ...r, via: 'fts' }));
  const sem = await getSem();
  if (!sem.enabled) return fts;
  const vec = await sem.search(query, k);
  const byKey = new Map(fts.map(r => [`${r.kind}:${r.ref}`, r]));
  for (const v of vec) {
    const h = hydrate(v.ref);
    if (!h) continue;
    const key = `${h.kind}:${h.ref}`;
    if (byKey.has(key)) { byKey.get(key).via = 'both'; byKey.get(key).distance = v.distance; }
    else byKey.set(key, { ...h, via: 'semantic', distance: v.distance });
  }
  return [...byKey.values()];
}

// ---- tool definitions (name, description, JSON Schema, handler) ------------
const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description) => ({ type: 'string', description });

const TOOLS = [
  {
    name: 'recall',
    description: 'Search the workspace knowledge base (wiki + facts + sources) for anything relevant to `query`. Use BEFORE researching the web or asking the user to re-explain context. Hybrid: keyword (FTS) always, plus semantic (meaning-based) recall when enabled — results are tagged via: fts | semantic | both. Single-source facts are flagged low_confidence.',
    inputSchema: S({ query: str('natural-language search, use distinctive nouns'), k: { type: 'integer', description: 'max results (default 8)' } }, ['query']),
    handler: (a) => hybridRecall(a.query, a.k || 8),
  },
  {
    name: 'remember',
    description: 'Store a durable atomic fact about this workspace (a decision, convention, inventory item, environment quirk, or verified research finding). Provide subject/predicate/object for a structured fact, or just `observation`. Re-stating a fact you already know STRENGTHENS it (corroboration_count + confidence rise) rather than duplicating. If the result includes `siblings`, a current fact shares this subject+predicate with a different value — call supersede if this replaces it.',
    inputSchema: S({ observation: str('the fact in plain language'), subject: str(''), predicate: str(''), object: str(''), source_url: str(''), source_tier: str('first-party|reputable|community|unverified'), session_id: str('') }, ['observation']),
    handler: async (a) => {
      const r = getStore().remember(a.observation, { subject: a.subject || null, predicate: a.predicate || null, object: a.object || null, sourceUrl: a.source_url || null, sourceTier: a.source_tier || null, sessionId: a.session_id || null });
      if (r.fact_id) await semUpsert(`fact:${r.fact_id}`, a.object || a.observation);
      return r;
    },
  },
  {
    name: 'whats_true',
    description: 'Return the facts about a specific entity (host, service, tool, component). By default returns current facts. Pass `as_of` (ISO timestamp) to time-travel: get the facts we BELIEVED as of that moment — useful for "what did we think was true last month".',
    inputSchema: S({ entity: str('the entity/subject to look up'), as_of: str('optional ISO timestamp for a historical snapshot') }, ['entity']),
    handler: (a) => getStore().whatsTrue(a.entity, a.as_of || null),
  },
  {
    name: 'history',
    description: 'Return the full timeline of facts for a subject (optionally one predicate): every version with its temporal fields and status (current|superseded), oldest first. Use to see how a belief changed over time and trace a supersede chain.',
    inputSchema: S({ subject: str('the entity/subject'), predicate: str('optional predicate to narrow to') }, ['subject']),
    handler: (a) => getStore().history(a.subject, a.predicate || null),
  },
  {
    name: 'supersede',
    description: 'Invalidate a fact that has changed and record its replacement (never hard-delete). Preserves history so you can still ask what was true before.',
    inputSchema: S({ fact_id: { type: 'integer', description: 'id of the fact to supersede' }, new_object: str('the corrected value') }, ['fact_id', 'new_object']),
    handler: (a) => getStore().supersede(a.fact_id, a.new_object),
  },
  {
    name: 'wiki_get',
    description: 'Read a wiki knowledge page in full by its title.',
    inputSchema: S({ page: str('page title') }, ['page']),
    handler: (a) => getStore().wikiGet(a.page) || `No wiki page named ${JSON.stringify(a.page)}.`,
  },
  {
    name: 'wiki_upsert',
    description: 'Create or update a wiki knowledge page (narrative/procedural: how-tos, troubleshooting, concept explainers). One page per entity/concept. `links` are other page titles to cross-reference as [[wikilinks]] — the links form the knowledge graph. Fuzzy-check for an existing page before creating a near-duplicate.',
    inputSchema: S({ page: str('page title'), content: str('markdown body'), links: { type: 'array', items: { type: 'string' }, description: 'related page titles' } }, ['page', 'content']),
    handler: async (a) => {
      const r = getStore().wikiUpsert(a.page, a.content, a.links || []);
      await semUpsert(`wiki:${a.page}`, `${a.page}\n${a.content}`);
      return r;
    },
  },
  {
    name: 'intake',
    description: 'Capture a researched finding into memory: stores it as an immutable source and a fact with provenance. Use after solving a problem via web research. Prefer canonical sources.',
    inputSchema: S({ text: str('the finding'), source_url: str(''), trust_tier: str('first-party|reputable|community|unverified') }, ['text']),
    handler: async (a) => {
      const r = getStore().remember(a.text, { sourceUrl: a.source_url || null, sourceTier: a.trust_tier || 'unverified' });
      if (r.fact_id) await semUpsert(`fact:${r.fact_id}`, a.text);
      return r;
    },
  },
  {
    name: 'ingest_session',
    description: 'Mechanical first pass over a Claude Code session transcript JSONL: registers it as an immutable source and returns a digest (first prompt, commands run, files touched, error signals). After calling this, YOU distill the real knowledge into wiki_upsert / remember — do not just store the digest. Transcripts live under ~/.claude/projects/.',
    inputSchema: S({ transcript_path: str('path to the session .jsonl') }, ['transcript_path']),
    handler: (a) => getStore().ingestSession(a.transcript_path),
  },
  {
    name: 'list_pending',
    description: 'List sessions staged for curation by the Stop hook (from .engraim/pending/).',
    inputSchema: S({}),
    handler: () => getStore().listPending(),
  },
  {
    name: 'calibrate',
    description: 'Record a correction or preference for how to behave in THIS workspace (tone, conventions, do/don\'t rules) — distinct from facts about the world. Call this when the user corrects you, states a preference, or a verdict comes back negative. Re-stating an existing override REAFFIRMS it (refreshes its expiry and counts toward permanent promotion). Standing overrides expire (default 90 days) unless reaffirmed.',
    inputSchema: S({ rule: str('the behavior rule, imperative voice e.g. "run tests before committing"'), scope: str('optional tag e.g. git, testing, tone'), reason: str('why'), ttl_days: { type: 'integer', description: 'days until expiry (default 90)' } }, ['rule']),
    handler: (a) => getStore().calibrate(a.rule, { scope: a.scope || null, reason: a.reason || null, source: a.session_id || 'user', ttlDays: a.ttl_days || undefined }),
  },
  {
    name: 'list_overrides',
    description: 'List active calibration overrides for this workspace, annotated with days-until-expiry, expiring_soon, and promotion_candidate flags. These are also injected at session start.',
    inputSchema: S({}),
    handler: () => getStore().activeOverrides(),
  },
  {
    name: 'promote_override',
    description: 'Graduate a standing override to PERMANENT: removes its expiry and writes it into frame/SOUL.md. Deliberate top rung of the promotion ladder — do this when a preference has proven durable (often reaffirmed). Workspace rules are written directly; changes to shipped plugin skills should instead be proposed as a PR.',
    inputSchema: S({ id: { type: 'integer', description: 'override id from list_overrides' } }, ['id']),
    handler: (a) => getStore().promoteOverride(a.id),
  },
  {
    name: 'retire_override',
    description: 'Retire an active override that no longer applies (does not delete history).',
    inputSchema: S({ id: { type: 'integer', description: 'override id' } }, ['id']),
    handler: (a) => getStore().retireOverride(a.id),
  },
  {
    name: 'pending_verdicts',
    description: 'Scan workspace markdown for `verdict:` annotations (verdict-annotation feedback). Returns resolved verdicts (signals to recalibrate — a negative verdict should become a calibrate rule) and unresolved/pending ones (work for the retrospective).',
    inputSchema: S({}),
    handler: () => getStore().scanVerdicts(),
  },
  {
    name: 'draft_skill',
    description: 'Draft a new workspace skill into the staging area (.engraim/pending/skills/). Use when a multi-step procedure recurs across sessions or the user says "make this a skill". The draft is INERT until promoted. If Anthropic\'s skill-creator skill is available, prefer authoring/evaluating there first, then draft the result here to enter the gate. Body is the SKILL.md markdown (without frontmatter); scripts is an optional map of relative-path -> file contents.',
    inputSchema: S({ name: str('kebab-case skill name'), description: str('third-person trigger description with the phrases users say'), body: str('SKILL.md markdown body (no frontmatter)'), scripts: { type: 'object', description: 'optional { "scripts/foo.sh": "..." } bundled files' } }, ['name', 'description', 'body']),
    handler: (a) => getStore().draftSkill(a.name, { description: a.description, body: a.body, scripts: a.scripts || {}, source: a.session_id || 'user' }),
  },
  {
    name: 'list_skills',
    description: 'List workspace skills tracked by EngrAIm (pending drafts and promoted/active), reconciled with what is on disk in .engraim/pending/skills/ and the project .claude/skills/.',
    inputSchema: S({}),
    handler: () => getStore().listSkills(),
  },
  {
    name: 'review_skill',
    description: 'Run the gatekeeper on a pending skill WITHOUT promoting it: structural checks (frontmatter, kebab-case name, no duplicate) plus a safety scan of bundled scripts. Returns a verdict with per-check results and any safety warnings.',
    inputSchema: S({ name: str('pending skill name') }, ['name']),
    handler: (a) => getStore().reviewSkill(a.name),
  },
  {
    name: 'promote_skill',
    description: 'Gate + activate a pending skill: if structural checks pass and no safety warnings, copy it from .engraim/pending/skills/ to the project .claude/skills/ so Claude Code loads it. Safety warnings block promotion unless force=true (use deliberately, after reviewing). This is the gated middle rung of the skill ladder.',
    inputSchema: S({ name: str('pending skill name'), force: { type: 'boolean', description: 'override safety warnings (review first)' } }, ['name']),
    handler: (a) => getStore().promoteSkill(a.name, { force: !!a.force }),
  },
  {
    name: 'retire_skill',
    description: 'Deactivate an active workspace skill (remove it from .claude/skills/); the draft and history are kept.',
    inputSchema: S({ name: str('skill name') }, ['name']),
    handler: (a) => getStore().retireSkill(a.name),
  },
  {
    name: 'lint_wiki',
    description: 'Scan the wiki knowledge graph for gaps and write a prioritized research agenda to wiki/_gaps.md: dangling [[links]] (concepts referenced but never written — the highest-value gaps), stub pages, orphans (nothing links in), and under-linked pages. Pair with research-as-intake: turn the top gaps into pages. Use on a cadence or during a retrospective.',
    inputSchema: S({}),
    handler: () => getStore().writeAgenda(),
  },
  {
    name: 'semantic_status',
    description: 'Report whether semantic (meaning-based) recall is enabled, and if not, exactly why (which optional piece is missing). Semantic recall is OPTIONAL: it needs the tiny sqlite-vec package plus an embedder (an Ollama/OpenAI HTTP endpoint via ENGRAIM_EMBED_URL, or @huggingface/transformers). Recall always works via keyword search regardless.',
    inputSchema: S({}),
    handler: async () => {
      const sem = await getSem();
      const db = getStore().db;
      let embedded = 0;
      try { embedded = db.prepare('SELECT COUNT(*) c FROM vec_items').get().c; } catch {}
      return { enabled: sem.enabled, reason: sem.reason, embedder: sem.label || null, dim: sem.dim || null, embedded_items: embedded };
    },
  },
  {
    name: 'reindex_semantic',
    description: 'Backfill vector embeddings for all existing facts and wiki pages. Run once after enabling semantic recall (so prior knowledge becomes semantically searchable), or after changing the embedder/model. No-op if semantic is not enabled.',
    inputSchema: S({}),
    handler: async () => {
      const sem = await getSem();
      if (!sem.enabled) return { reindexed: 0, reason: sem.reason };
      const db = getStore().db;
      let n = 0;
      for (const f of db.prepare('SELECT id,subject,predicate,object FROM facts WHERE invalidated_at IS NULL').all()) {
        await semUpsert(`fact:${f.id}`, `${f.subject} ${f.predicate} ${f.object}`); n++;
      }
      for (const w of db.prepare('SELECT page,content FROM wiki').all()) {
        await semUpsert(`wiki:${w.page}`, `${w.page}\n${w.content}`); n++;
      }
      return { reindexed: n, embedder: sem.label };
    },
  },
  {
    name: 'scan_project',
    description: 'Deterministically inspect the project root (languages, build tooling, package scripts, git remotes, top-level layout) to seed onboarding. Read-only. Use during /engraim:onboard to draft frame/ENV.md.',
    inputSchema: S({}),
    handler: () => getStore().scanProject(),
  },
  {
    name: 'mark_onboarded',
    description: 'Mark this workspace as onboarded so the first-run nudge stops. Call at the end of /engraim:onboard once the frame (ENV/USER/SOUL) has been seeded.',
    inputSchema: S({}),
    handler: () => getStore().markOnboarded(),
  },
  {
    name: 'status',
    description: 'Report workspace memory status: fact/wiki/episode counts, pending sessions, schema version, and workspace path.',
    inputSchema: S({}),
    handler: () => getStore().status(),
  },
];
const TOOL_MAP = Object.fromEntries(TOOLS.map(t => [t.name, t]));

// ---- JSON-RPC plumbing -----------------------------------------------------
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function error(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

function handle(req) {
  const { id, method, params } = req;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const clientProto = params && params.protocolVersion;
      reply(id, {
        protocolVersion: clientProto || FALLBACK_PROTOCOL,   // echo client's version
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
      return;
    }
    case 'notifications/initialized':
    case 'initialized':
      return; // notification, no response
    case 'ping':
      if (!isNotification) reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      return;
    case 'prompts/list':
      reply(id, { prompts: [] });
      return;
    case 'resources/list':
      reply(id, { resources: [] });
      return;
    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const tool = TOOL_MAP[name];
      if (!tool) { error(id, -32602, `Unknown tool: ${name}`); return; }
      const p = Promise.resolve()
        .then(() => tool.handler(args))
        .then((out) => {
          const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
          reply(id, { content: [{ type: 'text', text }], isError: false });
        })
        .catch((e) => {
          log('tool error', name, e && e.message);
          reply(id, { content: [{ type: 'text', text: `Error in ${name}: ${e && e.message}` }], isError: true });
        })
        .finally(() => pending.delete(p));
      pending.add(p);
      return;
    }
    default:
      if (!isNotification) error(id, -32601, `Method not found: ${method}`);
      return;
  }
}

// ---- read loop: one JSON object per line -----------------------------------
const pending = new Set();   // in-flight async tool handlers (drain before exit)
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let req;
  try { req = JSON.parse(t); } catch { log('parse error:', t.slice(0, 120)); return; }
  try { handle(req); } catch (e) { log('handler crash:', e && e.message); }
});
rl.on('close', () => {
  // let any in-flight handlers (e.g. semantic embeds) finish before exiting
  Promise.allSettled([...pending]).then(() => process.exit(0));
});
log('engraim-memory server ready');
