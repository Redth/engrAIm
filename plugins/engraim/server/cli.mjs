#!/usr/bin/env node
// EngrAIm hook adapter — pure Node, zero deps (imports store.mjs).
// Shell hooks pipe their stdin JSON to subcommands here so all fragile logic
// (JSON parsing, path resolution, workspace bootstrap) lives in JS, not bash.
//
// Subcommands:
//   session-start --plugin-root P     (SessionStart hook; reads hook JSON on stdin)
//   stage-session [--reason R]        (Stop / PreCompact hooks; reads hook JSON on stdin)
//   snapshot   --workspace P
//   status     --workspace P [--field NAME]
//   init       --workspace P [--schema-version N]
//   ingest-session --workspace P --transcript T

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, SCHEMA_VERSION } from './store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function readStdin() {
  try {
    const data = fs.readFileSync(0, 'utf8');
    return JSON.parse(data || '{}');
  } catch { return {}; }
}

function bootstrap(ws, pluginRoot) {
  if (fs.existsSync(ws)) return;
  const template = path.join(pluginRoot, 'templates', 'workspace');
  if (fs.existsSync(template)) fs.cpSync(template, ws, { recursive: true });
  else fs.mkdirSync(ws, { recursive: true });
}

const cmds = {
  'session-start'(args) {
    const data = readStdin();
    const cwd = data.cwd || process.cwd();
    const ws = path.join(cwd, '.engraim');
    const pluginRoot = args['plugin-root'] || path.resolve(__dirname, '..');
    let target = SCHEMA_VERSION;
    try { target = Number(fs.readFileSync(path.join(pluginRoot, 'schema', 'VERSION'), 'utf8').trim()); } catch {}

    bootstrap(ws, pluginRoot);
    const store = new Store(ws);
    store.migrate(target);          // version handshake / self-heal
    store.ensureManifest();
    store.ensureClaudeSkillsDir();   // create .claude/skills/ now so promotions are watched live
    const snap = store.snapshot();
    const st = store.status();
    const overrides = store.activeOverrides();

    const ctx = [`EngrAIm memory is active for this workspace (\`${ws}\`).`];
    ctx.push(snap || '(No environment notes yet — memory will fill in as you work.)');
    if (overrides.length) {
      const lines = overrides.map(o => {
        let s = `- ${o.rule}`;
        if (o.tier === 'permanent') s += ' (permanent)';
        else if (o.expiring_soon) s += ` (expires in ${o.days_until_expiry}d — reaffirm to keep)`;
        if (o.promotion_candidate) s += ' (reaffirmed often — consider /engraim:calibrate to make permanent)';
        return s;
      });
      ctx.push('Workspace calibration — active overrides (how to behave here):\n' + lines.join('\n'));
    }
    if (st.pending_sessions) ctx.push(`[${st.pending_sessions} session(s) staged for curation — run /engraim:curate to distill them into memory.]`);
    if (st.pending_skills) ctx.push(`[${st.pending_skills} skill(s) drafted and awaiting review — run /engraim:promote-skill to gate + activate them.]`);
    if (!st.onboarded) {
      ctx.push("[New EngrAIm workspace — run /engraim:onboard to scan this project and seed the memory. "
        + "Optional: /engraim:enable-semantic adds meaning-based recall (works with a local Ollama endpoint or transformers.js; not required).]");
    } else if (st.wiki_gaps) {
      ctx.push(`[${st.wiki_gaps} unwritten concept(s) referenced in the wiki — /engraim:lint builds a research agenda.]`);
    }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx.join('\n\n') },
    }));
  },

  'stage-session'(args) {
    const data = readStdin();
    const cwd = data.cwd || process.cwd();
    const ws = path.join(cwd, '.engraim');
    if (!fs.existsSync(ws)) return;
    new Store(ws).stageSession(data.session_id || 'unknown', data.transcript_path || '', args.reason || 'stop');
  },

  snapshot(args) { process.stdout.write(new Store(args.workspace).snapshot()); },

  status(args) {
    const st = new Store(args.workspace).status();
    if (args.field) {
      const key = ({ pending: 'pending_sessions' })[args.field] || args.field;
      process.stdout.write(String(st[key] ?? ''));
    } else process.stdout.write(JSON.stringify(st, null, 2));
  },

  init(args) {
    const store = new Store(args.workspace);
    store.migrate(args['schema-version'] ? Number(args['schema-version']) : SCHEMA_VERSION);
    store.ensureManifest();
    process.stdout.write(JSON.stringify(store.status()));
  },

  'ingest-session'(args) {
    process.stdout.write(JSON.stringify(new Store(args.workspace).ingestSession(args.transcript), null, 2));
  },
};

const [cmd, ...rest] = process.argv.slice(2);
const fn = cmds[cmd];
if (!fn) { process.stderr.write(`unknown command: ${cmd}\n`); process.exit(1); }
fn(parseArgs(rest));
