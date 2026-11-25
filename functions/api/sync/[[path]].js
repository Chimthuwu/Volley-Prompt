// VolleyPrompt sync API (todo A2) — Cloudflare Pages Function.
//
// Stores ONE opaque, client-encrypted profile blob per account. The server can never
// read the data: the client derives the key from its pairing secret (todo A3) and
// addresses the blob by blobId = sha256(secret). This module only enforces shape,
// size and rate limits — it is deliberately dumb storage.
//
// Endpoints (all same-origin; the desktop client calls them from Node, so no CORS):
//   GET  /api/sync/<blobId>   -> 200 { blob, updatedAt } | 404
//   PUT  /api/sync/<blobId>   -> 200 { updatedAt } | 413 | 400 | 429
//   DELETE /api/sync/<blobId> -> 200 (unpair: the client cleared its secret; orphaned
//                                blobs are acceptable per todo A3, this just allows it)
//
// Binding: KV namespace `SYNC_KV` (see wrangler.jsonc for the one-time setup command).

const MAX_BLOB_BYTES = 1_000_000;   // KV value cap is 25 MiB; 1 MB is the todo A4 budget
const PUTS_PER_MINUTE = 30;         // per blobId, best-effort (KV is eventually consistent)
const HEX_64 = /^[0-9a-f]{64}$/;    // blobId must be sha256 hex, lowercase

const json = (body, status, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...extra },
});

// Best-effort rate limiter: one counter per blobId+minute. KV's eventual consistency
// means bursts can exceed the limit slightly; that is fine — this is abuse damping
// (the todo: "rate-limit /api/sync per blobId (the only 'auth')"), not a security wall.
async function rateLimited(env, blobId) {
  if (!env.SYNC_KV) return false; // no binding configured (local dev without KV) — don't block
  const bucket = new Date().toISOString().slice(0, 16); // UTC minute
  const key = `rl:${blobId}:${bucket}`;
  const current = Number(await env.SYNC_KV.get(key)) || 0;
  await env.SYNC_KV.put(key, String(current + 1), { expirationTtl: 120 });
  return current >= PUTS_PER_MINUTE;
}

function blobIdFrom(url) {
  const id = url.pathname.split('/').pop() || '';
  if (!HEX_64.test(id)) return null; // never echo an invalid id back into storage keys
  return id;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const blobId = blobIdFrom(new URL(request.url));
  if (!blobId) return json({ error: 'blobId must be 64 hex chars (sha256 of the pairing secret)' }, 400);
  if (!env.SYNC_KV) return json({ error: 'sync storage is not configured yet' }, 503);
  const stored = await env.SYNC_KV.get(`blob:${blobId}`, 'json');
  if (!stored) return json({ error: 'no profile for that blobId' }, 404);
  return json({ blob: stored.blob, updatedAt: stored.updatedAt });
}

export async function onRequestPut(context) {
  const { env, request } = context;
  const blobId = blobIdFrom(new URL(request.url));
  if (!blobId) return json({ error: 'blobId must be 64 hex chars (sha256 of the pairing secret)' }, 400);
  if (!env.SYNC_KV) return json({ error: 'sync storage is not configured yet' }, 503);
  if (await rateLimited(env, blobId)) return json({ error: 'too many syncs — slow down' }, 429);

  const bodyText = await request.text();
  if (!bodyText.length || bodyText.length > MAX_BLOB_BYTES) {
    return json({ error: `body must be 1..${MAX_BLOB_BYTES} bytes` }, 413);
  }
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch { return json({ error: 'body must be a JSON object' }, 400); }
  // Shape, not content: the blob is ciphertext+profile as far as this server is concerned.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return json({ error: 'body must be a JSON object' }, 400);
  }
  const updatedAt = new Date().toISOString();
  await env.SYNC_KV.put(`blob:${blobId}`, JSON.stringify({ blob: parsed, updatedAt }));
  return json({ updatedAt });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const blobId = blobIdFrom(new URL(request.url));
  if (!blobId) return json({ error: 'blobId must be 64 hex chars (sha256 of the pairing secret)' }, 400);
  if (!env.SYNC_KV) return json({ error: 'sync storage is not configured yet' }, 503);
  await env.SYNC_KV.delete(`blob:${blobId}`);
  return json({ deleted: true });
}
