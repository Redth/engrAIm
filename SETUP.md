# Setup & local development

## Requirements
- **Node ≥ 22.5** (for built-in `node:sqlite` with FTS5). No other dependencies — no pip,
  no npm install, no SDK.

## Try it without publishing (local dev)
Claude Code can load a marketplace from a local path:
```bash
/plugin marketplace add /path/to/engraim        # this repo root
/plugin install engraim@engraim
```
Then open a project and start a session. Verify:
- `.engraim/` appears in the project root (frame/, wiki/, sources/, calibration/, registry.md, store.db).
- The session start injects an "EngrAIm memory is active" note.
- After a session, `.engraim/pending/sessions.jsonl` gains an entry.
- `/engraim:status` reports counts.

## Smoke-test the store without Claude
```bash
cd plugins/engraim/server
node -e "import('./store.mjs').then(({Store})=>{const s=new Store('/tmp/ws/.engraim'); \
console.log(s.remember('Raypak P-R406A heat exchanger failed at 5 years',{subject:'pool-heater'})); \
console.log(s.recall('heat exchanger')); console.log(s.status());})"
```

## Test the MCP server on the wire
```bash
cd plugins/engraim/server
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | NODE_NO_WARNINGS=1 node engraim_server.mjs
```
You should see the initialize result, then the 10-tool list, on stdout; the "server ready"
log on stderr.

## Publish
Push this repo to `github.com/redth/engrAIm` (public), then anyone runs
`/plugin marketplace add redth/engrAIm`. Pin versions via `version` in plugin.json or a
commit SHA in the marketplace entry.

## One-command self-test
```bash
node scripts/selftest.mjs
```
Exercises the store, the hooks, and a live MCP handshake against throwaway temp workspaces. Exits non-zero on any failure.
