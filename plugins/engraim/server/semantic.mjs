// EngrAIm semantic layer — OPTIONAL. Everything here degrades to "disabled" if the
// optional pieces aren't present; the core (FTS5) never depends on this file.
//
// Two optional pieces, both probed at runtime:
//   1. sqlite-vec  — the vector index (tiny, ~200K npm package; loaded as a SQLite ext).
//   2. an embedder — turns text into vectors. Resolved in this order:
//        a. an HTTP endpoint (Ollama at 127.0.0.1:11434, or any OpenAI-style
//           /v1/embeddings) via ENGRAIM_EMBED_URL — ZERO npm deps, just fetch.
//        b. @huggingface/transformers (transformers.js) if installed — fully local.
//      If neither resolves, semantic stays off and recall falls back to FTS only.
//
// Resolution of sqlite-vec / transformers tries normal import first, then a workspace
// vendor dir (.engraim/vendor/node_modules) so installs survive plugin updates.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const OLLAMA_DEFAULT = 'http://127.0.0.1:11434/api/embeddings';
const OLLAMA_MODEL_DEFAULT = 'nomic-embed-text';

async function tryImport(spec, vendorDir) {
  try { return await import(spec); } catch {}
  if (vendorDir) {
    try {
      const req = createRequire(path.join(vendorDir, 'noop.cjs'));
      return await import(pathToFileURL(req.resolve(spec)).href);
    } catch {}
  }
  return null;
}

// ---- embedders -------------------------------------------------------------
function httpEmbedder() {
  const url = process.env.ENGRAIM_EMBED_URL || OLLAMA_DEFAULT;
  const model = process.env.ENGRAIM_EMBED_MODEL || OLLAMA_MODEL_DEFAULT;
  const isOpenAI = /\/v1\/embeddings/.test(url);
  return {
    kind: 'http', label: `${isOpenAI ? 'openai-style' : 'ollama'}:${model} @ ${url}`,
    async probe() {
      try {
        const v = await this.embed('ping');
        return Array.isArray(v) && v.length > 0;
      } catch { return false; }
    },
    async embed(text) {
      const body = isOpenAI ? { model, input: text } : { model, prompt: text };
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`embed endpoint ${res.status}`);
      const j = await res.json();
      if (isOpenAI) return j.data?.[0]?.embedding;
      return j.embedding || j.embeddings?.[0];
    },
  };
}

async function transformersEmbedder(vendorDir) {
  const mod = await tryImport('@huggingface/transformers', vendorDir);
  if (!mod) return null;
  const model = process.env.ENGRAIM_EMBED_MODEL || 'Xenova/all-MiniLM-L6-v2';
  let pipe = null;
  return {
    kind: 'transformers', label: `transformers.js:${model}`,
    async probe() { try { await this.embed('ping'); return true; } catch { return false; } },
    async embed(text) {
      if (!pipe) pipe = await mod.pipeline('feature-extraction', model);
      const out = await pipe(text, { pooling: 'mean', normalize: true });
      return Array.from(out.data);
    },
  };
}

// Pick an embedder without making network calls unless asked (probe is explicit).
async function resolveEmbedder(vendorDir) {
  // HTTP is preferred when explicitly configured; otherwise we still offer Ollama default
  // but it's only "available" if it probes true.
  const http = httpEmbedder();
  if (await http.probe()) return http;
  const tf = await transformersEmbedder(vendorDir);
  if (tf && await tf.probe()) return tf;
  return null;
}

// ---- public: build a semantic provider bound to a DB ----------------------
// Returns { enabled, reason, label, dim, embed, ensureTable, upsert, search } or a
// disabled stub. Never throws on absence.
export async function makeSemantic(db, { vendorDir = null } = {}) {
  const disabled = (reason) => ({ enabled: false, reason, label: null, dim: null,
    async embed() { return null; }, async upsert() {}, async search() { return []; } });

  const vec = await tryImport('sqlite-vec', vendorDir);
  if (!vec || typeof vec.getLoadablePath !== 'function') return disabled('sqlite-vec not installed');

  try {
    db.enableLoadExtension(true);
    db.loadExtension(vec.getLoadablePath());
  } catch (e) {
    return disabled(`could not load sqlite-vec extension: ${e.message}`);
  }

  const embedder = await resolveEmbedder(vendorDir);
  if (!embedder) return disabled('no embedder (set ENGRAIM_EMBED_URL to an Ollama/OpenAI endpoint, or install @huggingface/transformers)');

  let dim = null;
  const provider = {
    enabled: true, reason: 'ready', label: embedder.label, get dim() { return dim; },
    async embed(text) { return embedder.embed(text); },
    _ensureTable(d) {
      if (dim) return;
      dim = d;
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(ref TEXT, emb float[${d}])`);
    },
    async upsert(ref, text) {
      const v = await embedder.embed(text);
      if (!v || !v.length) return;
      this._ensureTable(v.length);
      if (v.length !== dim) return; // dimension mismatch -> needs reindex; skip silently
      const buf = new Uint8Array(new Float32Array(v).buffer);
      db.prepare('DELETE FROM vec_items WHERE ref=?').run(String(ref));
      db.prepare('INSERT INTO vec_items(ref, emb) VALUES (?, ?)').run(String(ref), buf);
    },
    async search(text, k = 8) {
      const v = await embedder.embed(text);
      if (!v || !v.length) return [];
      try {
        const buf = new Uint8Array(new Float32Array(v).buffer);
        return db.prepare('SELECT ref, distance FROM vec_items WHERE emb MATCH ? ORDER BY distance LIMIT ?').all(buf, k);
      } catch { return []; }   // table may not exist yet (nothing embedded)
    },
  };
  return provider;
}
