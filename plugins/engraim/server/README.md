# EngrAIm memory server

Pure Node, **zero dependencies** — nothing to `npm install`. Needs only Node >= 22.13
(for the built-in `node:sqlite` module, which ships SQLite with FTS5).

- `store.mjs` — storage core (sqlite + FTS5 via `node:sqlite`). Shared by hooks and server.
- `cli.mjs` — thin adapter the shell hooks pipe their stdin JSON into.
- `engraim_server.mjs` — the MCP (stdio) server Claude talks to. JSON-RPC 2.0 over
  stdin/stdout, hand-rolled (no SDK).

`node:sqlite` is still flagged experimental, so the launcher sets `NODE_NO_WARNINGS=1`
to keep the experimental notice off the wire (it would otherwise go to stderr, which is
harmless, but this keeps logs clean).

## Smoke-test without Claude
```bash
cd plugins/engraim/server
node -e "import('./store.mjs').then(({Store})=>{const s=new Store('/tmp/ws/.engraim'); \
console.log(s.remember('Raypak P-R406A heat exchanger failed at 5 years',{subject:'pool-heater'})); \
console.log(s.recall('heat exchanger')); console.log(s.status());})"
```

## Test the MCP handshake on the wire
```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | NODE_NO_WARNINGS=1 node engraim_server.mjs
```

## v0 scope
Roadmap steps 1-2: workspace bootstrap, session-transcript staging, and an FTS5 memory
store with `recall / remember / whats_true / supersede / wiki_get / wiki_upsert / intake /
ingest_session / list_pending / status`. **Not yet:** `sqlite-vec` embeddings (semantic
recall — loadable as a Node extension later), the retrospective/lint cadence, skill
promotion, and bitemporal time-travel queries (columns exist; query surface lands with
the temporal step). See the plan, §8.
