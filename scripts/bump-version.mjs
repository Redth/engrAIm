#!/usr/bin/env node
// EngrAIm version bump — pure Node, zero deps.
//   node scripts/bump-version.mjs 0.6.0        # explicit version
//   node scripts/bump-version.mjs minor        # bump major | minor | patch
//
// Keeps the TWO release-version sources in lockstep and flips the CHANGELOG heading:
//   - .claude-plugin/marketplace.json   (plugins[].version — what the marketplace surfaces)
//   - plugins/engraim/.claude-plugin/plugin.json (the plugin manifest version)
//   - CHANGELOG.md  '## Unreleased' -> '## <version>'
// It does NOT touch plugins/engraim/schema/VERSION — that's the workspace schema axis and
// only moves when a migration changes the on-disk shape.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKETPLACE = path.join(root, '.claude-plugin', 'marketplace.json');
const PLUGIN = path.join(root, 'plugins', 'engraim', '.claude-plugin', 'plugin.json');
const CHANGELOG = path.join(root, 'CHANGELOG.md');

const arg = process.argv[2];
if (!arg) { console.error('usage: bump-version.mjs <version|major|minor|patch>'); process.exit(2); }

const current = JSON.parse(fs.readFileSync(PLUGIN, 'utf8')).version;
const semver = /^(\d+)\.(\d+)\.(\d+)$/;

function nextVersion(cur, spec) {
  if (semver.test(spec)) return spec;
  const m = semver.exec(cur);
  if (!m) { console.error(`current version "${cur}" is not x.y.z`); process.exit(1); }
  let [maj, min, pat] = m.slice(1).map(Number);
  if (spec === 'major') { maj++; min = 0; pat = 0; }
  else if (spec === 'minor') { min++; pat = 0; }
  else if (spec === 'patch') { pat++; }
  else { console.error(`unknown bump "${spec}" — use x.y.z or major|minor|patch`); process.exit(2); }
  return `${maj}.${min}.${pat}`;
}

const next = nextVersion(current, arg);
if (next === current) { console.error(`version already ${current}`); process.exit(1); }

// Replace only the first "version": "..." in each JSON file — minimal, format-preserving diff.
const setVersion = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${next}"`);
  if (out === src) { console.error(`no "version" field found in ${file}`); process.exit(1); }
  fs.writeFileSync(file, out);
};
setVersion(MARKETPLACE);
setVersion(PLUGIN);

// Flip the changelog heading if an Unreleased section is staged.
const cl = fs.readFileSync(CHANGELOG, 'utf8');
if (/^## Unreleased\b/m.test(cl)) {
  fs.writeFileSync(CHANGELOG, cl.replace(/^## Unreleased\b.*$/m, `## ${next}`));
} else {
  console.warn(`note: no "## Unreleased" heading in CHANGELOG.md — add a "## ${next}" section by hand.`);
}

console.log(`bumped ${current} -> ${next} (marketplace.json, plugin.json${/^## Unreleased\b/m.test(cl) ? ', CHANGELOG.md' : ''})`);
