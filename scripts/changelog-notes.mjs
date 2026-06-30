#!/usr/bin/env node
// Print the CHANGELOG.md body for one version — used by the release workflow as release notes.
//   node scripts/changelog-notes.mjs 0.6.0
// Emits the lines under "## <version>" up to the next "## " heading. Exits 1 if not found.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version) { console.error('usage: changelog-notes.mjs <version>'); process.exit(2); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split('\n');

const start = lines.findIndex(l => l.trim() === `## ${version}`);
if (start === -1) { console.error(`no "## ${version}" section in CHANGELOG.md`); process.exit(1); }
let end = lines.slice(start + 1).findIndex(l => /^## /.test(l));
end = end === -1 ? lines.length : start + 1 + end;

console.log(lines.slice(start + 1, end).join('\n').trim());
