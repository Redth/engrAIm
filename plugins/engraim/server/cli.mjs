#!/usr/bin/env node
// EngrAIm hook adapter — pure Node, zero deps (imports store.mjs).
// Shell hooks pipe their stdin JSON to subcommands here so all fragile logic
// (JSON parsing, path resolution, workspace bootstrap) lives in JS, not bash.
//
// Subcommands:
//   session-start --plugin-root P     (SessionStart hook; reads hook JSON on stdin)
//   stage-session [--reason R]        (Stop / PreCompact hooks; reads hook JSON on stdin)
//   user-prompt                       (UserPromptSubmit hook; reads hook JSON on stdin)
//   post-tool                         (PostToolUse hook; reads hook JSON on stdin)
//   snapshot   --workspace P
//   status     --workspace P [--field NAME]
//   init       --workspace P [--schema-version N]
//   ingest-session --workspace P --transcript T

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, SCHEMA_VERSION } from './store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tunable thresholds for the proactive nudges (kept here so they're easy to find).
const RETRO_PENDING = 6;            // staged sessions that, alone, warrant a retro pass
const CURATE_AFTER_CALIBRATE = 3;   // staged sessions that justify a curate cross-nudge
const PROMPT_NUDGE_THROTTLE_MS = 6 * 3600 * 1000;  // at most one in-session backlog nudge / 6h

// Deterministic phrase detection for the calibrate reflex. High-precision cues that a
// message is durable, project-wide feedback (not a one-off for the current task). The
// model is the final gate — these only surface a suggestion. Returns the matched cue or null.
const FEEDBACK_PATTERNS = [
  /\bfrom now on\b/i,
  /\bgoing forward\b/i,
  /\balways remember\b/i,
  /\bremember (that|to)\b/i,
  /\bas a rule\b/i,
  /\bevery time\b/i,
  /\b(in|for|across) (this|the) (project|repo|repository|workspace|codebase)\b/i,
  /\bthe (whole|entire) (project|repo|repository|codebase)\b/i,
  /\bwe should (always|never|do it|do this)\b/i,
  /\bdo it (like this|this way)\b/i,
  /\b(always|never) (use|do|run|prefer|avoid|commit|push|test|name|write|put)\b/i,
  /\bprefer\b[^.\n]{0,30}\bover\b/i,
  /\bmake sure (to |you )?(always|never)\b/i,
  /\bdon'?t ever\b/i,
];

function feedbackSignal(prompt) {
  for (const re of FEEDBACK_PATTERNS) {
    const m = re.exec(prompt);
    if (m) return m[0].toLowerCase().trim();
  }
  return null;
}

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
    // Retro is the consolidation pass; surface it when its inputs have accumulated so the
    // user never has to remember to tighten the memory themselves.
    if (st.onboarded) {
      const retroSignals = [];
      if (st.overrides_expiring_soon) retroSignals.push(`${st.overrides_expiring_soon} override(s) expiring soon`);
      if (st.promotion_candidates) retroSignals.push(`${st.promotion_candidates} override(s) worn-in (promotion candidates)`);
      if (st.pending_sessions >= RETRO_PENDING) retroSignals.push(`${st.pending_sessions} sessions staged`);
      if (retroSignals.length) {
        ctx.push(`[Memory is due for a tightening pass — ${retroSignals.join(', ')}. `
          + `Ask the user whether to run /engraim:retro (consolidate, resolve verdicts, prune stale overrides).]`);
      }
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

  // UserPromptSubmit: two proactive nudges on every prompt.
  //  1) Calibrate reflex — durable, project-wide feedback in the message → suggest capturing it.
  //  2) Throttled backlog reminder — so a long session (no fresh SessionStart) still resurfaces
  //     curate/retro/skill upkeep without the user having to remember it.
  'user-prompt'() {
    const data = readStdin();
    const cwd = data.cwd || process.cwd();
    const ws = path.join(cwd, '.engraim');
    if (!fs.existsSync(ws)) return;
    const out = [];

    const cue = feedbackSignal(String(data.prompt || ''));
    if (cue) {
      out.push(`This reads like durable, project-wide feedback (matched "${cue}"). If it's a standing `
        + `rule for how to work in this workspace — not a one-off for this task — capture it now with the `
        + `engraim-calibrate skill (call calibrate(rule, scope?)), then briefly confirm what you recorded. `
        + `If it's only situational, ignore this.`);
    }

    try {
      const store = new Store(ws);
      const now = Date.now();
      const last = Number(store.getMeta('last_prompt_nudge_at') || 0);
      if (now - last > PROMPT_NUDGE_THROTTLE_MS) {
        const st = store.status();
        const items = [];
        if (st.pending_sessions) items.push(`${st.pending_sessions} session(s) staged → /engraim:curate`);
        if (st.overrides_expiring_soon || st.promotion_candidates || st.pending_sessions >= RETRO_PENDING)
          items.push(`memory tightening due → /engraim:retro`);
        if (st.pending_skills) items.push(`${st.pending_skills} skill draft(s) awaiting review → /engraim:promote-skill`);
        if (items.length) {
          out.push(`Workspace upkeep waiting: ${items.join('; ')}. Offer to run the relevant one at a natural pause.`);
          store.setMeta('last_prompt_nudge_at', String(now));
        }
      }
    } catch {}

    if (!out.length) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '[EngrAIm] ' + out.join(' ') },
    }));
  },

  // PostToolUse: after a milestone memory action, surface the natural next step. The hook
  // matcher restricts which tools fire this; we re-check tool_name so follow-ups stay targeted.
  'post-tool'() {
    const data = readStdin();
    const name = data.tool_name || '';
    const cwd = data.cwd || process.cwd();
    const ws = path.join(cwd, '.engraim');
    if (!fs.existsSync(ws)) return;
    const has = t => name.includes(t);
    const st = new Store(ws).status();
    const nudges = [];

    if (has('calibrate')) {
      if (st.pending_sessions >= CURATE_AFTER_CALIBRATE)
        nudges.push(`${st.pending_sessions} session(s) are also staged — ask whether to run /engraim:curate while you're tidying memory.`);
      if (st.promotion_candidates)
        nudges.push(`${st.promotion_candidates} standing override(s) are worn-in — consider promoting one to permanent (writes into frame/SOUL.md).`);
    }
    if (has('draft_skill'))
      nudges.push(`The drafted skill is inert until gated — ask whether to run /engraim:promote-skill to review + activate it.`);
    if (has('ingest_session')) {
      const reasons = [];
      if (st.overrides_expiring_soon) reasons.push(`${st.overrides_expiring_soon} override(s) expiring`);
      if (st.promotion_candidates) reasons.push(`${st.promotion_candidates} promotion candidate(s)`);
      if (reasons.length) nudges.push(`Memory could use a tightening pass (${reasons.join(', ')}) — ask whether to run /engraim:retro.`);
    }
    if (has('mark_onboarded'))
      nudges.push(`Workspace just onboarded — ask whether to run /engraim:backfill to seed memory from past Claude Code sessions.`);

    if (!nudges.length) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: '[EngrAIm follow-up] ' + nudges.join(' ') },
    }));
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
