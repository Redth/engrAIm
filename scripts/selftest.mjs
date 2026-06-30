#!/usr/bin/env node
// EngrAIm self-test — pure Node, zero deps. Verifies a fresh clone works end to end.
//   node scripts/selftest.mjs
// Exits non-zero on the first failure. Does NOT touch your real workspaces (uses a tmpdir).

import { Store } from '../plugins/engraim/server/store.mjs';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '..', 'plugins', 'engraim', 'server', 'engraim_server.mjs');
const PLUGIN_ROOT = path.join(here, '..', 'plugins', 'engraim');
const CLI = path.join(PLUGIN_ROOT, 'server', 'cli.mjs');

let failures = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
};

// ---- 1) store: the zero-dep core ------------------------------------------
{
  const ws = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'engraim-')), '.engraim');
  const s = new Store(ws);
  const r1 = s.remember('Raypak pool heater failed at five years', { subject: 'pool-heater', predicate: 'failure', object: 'heat exchanger at 5y' });
  ok('remember inserts a fact', !!r1.fact_id);
  const r2 = s.remember('raypak  pool heater FAILED at five years', { subject: 'Pool-Heater', predicate: 'failure', object: 'heat exchanger at 5y' });
  ok('re-stating corroborates (no duplicate)', r2.corroborated === true && r2.corroboration_count === 2, `count=${r2.corroboration_count}`);
  ok('recall finds it via FTS', s.recall('pool heater').some(x => x.kind === 'fact'));
  const a = s.remember('Pool heater is Raypak P-R406A', { subject: 'ph', predicate: 'model', object: 'P-R406A' });
  s.supersede(a.fact_id, 'Raypak Avia');
  ok('supersede updates current truth', s.whatsTrue('ph').map(f => f.object).join() === 'Raypak Avia');
  ok('history shows the chain', s.history('ph').length === 2);
  s.wikiUpsert('Pool Heater', 'See [[Gas Lines]].', []);
  ok('wiki lint finds dangling link', s.lintWiki().dangling.some(d => d.link === 'Gas Lines'));
  const c = s.calibrate('keep answers terse', { scope: 'tone' });
  ok('calibrate records an override', !!c.id && s.activeOverrides().length === 1);
  const d = s.draftSkill('demo-fix', { description: 'demo', body: '# Demo' });
  ok('draft_skill stages an inert skill', d.status === 'pending');
  const bad = s.draftSkill('danger-skill', { description: 'x', body: '# x', scripts: { 'scripts/x.sh': 'rm -rf /\n' } });
  ok('gate flags a dangerous script', s.reviewSkill('danger-skill').warnings.length > 0);
  const prom = s.promoteSkill('demo-fix');
  ok('promote_skill activates into .claude/skills', prom.promoted && fs.existsSync(path.join(path.dirname(ws), '.claude', 'skills', 'demo-fix', 'SKILL.md')));
  const st = s.status();
  ok('status reports schema 5 + counts', st.schema_version === 5 && st.active_skills === 1);
}

// ---- 2) hooks: bootstrap + capture ----------------------------------------
{
  const proj = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'engraim-proj-')), 'p');
  fs.mkdirSync(proj, { recursive: true });
  const run = (args, input) => new Promise((res) => {
    const c = spawn('node', [CLI, ...args], { env: { ...process.env, NODE_NO_WARNINGS: '1' }, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = ''; c.stdout.on('data', d => out += d);
    c.on('close', () => res(out));
    if (input !== undefined) c.stdin.end(input);
  });
  const ctx = await run(['session-start', '--plugin-root', PLUGIN_ROOT], JSON.stringify({ cwd: proj }));
  ok('SessionStart bootstraps .engraim/', fs.existsSync(path.join(proj, '.engraim', 'manifest.json')));
  ok('SessionStart pre-creates .claude/skills/', fs.existsSync(path.join(proj, '.claude', 'skills')));
  ok('SessionStart emits onboarding nudge', /engraim:onboard/.test(ctx));
  await run(['stage-session'], JSON.stringify({ cwd: proj, session_id: 's1', transcript_path: '/tmp/none.jsonl' }));
  ok('Stop hook stages a session', fs.existsSync(path.join(proj, '.engraim', 'pending', 'sessions.jsonl')));

  // proactive nudges -------------------------------------------------------
  const fb = await run(['user-prompt'], JSON.stringify({ cwd: proj, prompt: 'From now on always run the tests before committing' }));
  ok('UserPromptSubmit nudges calibrate on durable feedback', /engraim:calibrate|calibrate\(/.test(fb));
  const quiet = await run(['user-prompt'], JSON.stringify({ cwd: proj, prompt: 'what does this function do?' }));
  ok('UserPromptSubmit stays silent on a plain question', quiet.trim() === '');
  // back up the curation queue, then a calibration should cross-nudge toward curate.
  for (const i of [2, 3]) await run(['stage-session'], JSON.stringify({ cwd: proj, session_id: 's' + i, transcript_path: '/tmp/none.jsonl' }));
  const pt = await run(['post-tool'], JSON.stringify({ cwd: proj, tool_name: 'mcp__engraim__calibrate' }));
  ok('PostToolUse(calibrate) cross-nudges curate when sessions pile up', /engraim:curate/.test(pt));
  const ds = await run(['post-tool'], JSON.stringify({ cwd: proj, tool_name: 'mcp__engraim__draft_skill' }));
  ok('PostToolUse(draft_skill) nudges promote-skill', /engraim:promote-skill/.test(ds));
  // onboarded + enough backlog → SessionStart surfaces a retro pass.
  new Store(path.join(proj, '.engraim')).markOnboarded();
  for (const i of [4, 5, 6]) await run(['stage-session'], JSON.stringify({ cwd: proj, session_id: 's' + i, transcript_path: '/tmp/none.jsonl' }));
  const ss2 = await run(['session-start', '--plugin-root', PLUGIN_ROOT], JSON.stringify({ cwd: proj }));
  ok('SessionStart surfaces a retro pass when inputs accumulate', /engraim:retro/.test(ss2));
}

// ---- 3) MCP server: handshake + a tool round-trip (sequential client) ------
{
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'engraim-mcp-'));
  const child = spawn('node', [SERVER], { env: { ...process.env, ENGRAIM_WORKSPACE: path.join(ws, '.engraim'), NODE_NO_WARNINGS: '1' }, stdio: ['pipe', 'pipe', 'ignore'] });
  const rl = readline.createInterface({ input: child.stdout });
  const waiters = new Map();
  rl.on('line', l => { if (!l.trim()) return; const m = JSON.parse(l); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } });
  const send = (id, method, params) => new Promise(r => { waiters.set(id, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const init = await send(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } });
  ok('initialize echoes protocolVersion', init.result?.protocolVersion === '2025-06-18');
  const list = await send(2, 'tools/list', {});
  ok('tools/list returns the toolset', (list.result?.tools?.length || 0) >= 20, `${list.result?.tools?.length} tools`);
  await send(3, 'tools/call', { name: 'remember', arguments: { observation: 'Synology runs Jellyfin', subject: 'synology' } });
  const rec = await send(4, 'tools/call', { name: 'recall', arguments: { query: 'jellyfin' } });
  const hits = JSON.parse(rec.result.content[0].text);
  ok('remember + recall round-trip over MCP', Array.isArray(hits) && hits.length > 0);
  child.stdin.end();
}

// ---- 4) release hygiene: the two version sources must agree -----------------
{
  const read = p => JSON.parse(fs.readFileSync(path.join(here, '..', p), 'utf8'));
  const mkt = read('.claude-plugin/marketplace.json').plugins[0].version;
  const plg = read('plugins/engraim/.claude-plugin/plugin.json').version;
  ok('marketplace.json and plugin.json versions match', mkt === plg, `${mkt} vs ${plg}`);
  ok('version is semver x.y.z', /^\d+\.\d+\.\d+$/.test(plg), plg);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
