---
description: Turn on meaning-based (semantic) recall — optional, never required.
---
Help the user enable semantic recall. It is OPTIONAL; keyword recall always works.

1. Run `semantic_status` and report the current state (enabled, and if not, exactly which piece is missing).
2. Explain the two pieces and the lightest path:
   - **Vector index:** the `sqlite-vec` package (tiny, ~200K). Install it into the workspace vendor dir: `mkdir -p .engraim/vendor && (cd .engraim/vendor && npm init -y >/dev/null && npm install sqlite-vec)`. (Add `.engraim/vendor/` to .gitignore.)
   - **Embedder (pick one):**
     - *Ollama / local HTTP (recommended for a homelab — no npm dep):* run an embedding model (e.g. `ollama pull nomic-embed-text`) and set `ENGRAIM_EMBED_URL=http://127.0.0.1:11434/api/embeddings` (and optionally `ENGRAIM_EMBED_MODEL`). Any OpenAI-style `/v1/embeddings` endpoint also works.
     - *transformers.js (fully local, heavier):* `(cd .engraim/vendor && npm install @huggingface/transformers)` — first use downloads a small model.
   - These env vars belong in the MCP server config (the plugin's `.mcp.json` `env`) or your shell; the server reads them at startup.
3. After enabling, restart the session (so the server picks up the new packages/env), run `semantic_status` to confirm, then `reindex_semantic` to embed existing facts and wiki pages.
4. Be honest about the tradeoff: it adds a dependency and (for transformers.js) a model download. If the user prefers zero dependencies, keyword recall is fully functional on its own.
