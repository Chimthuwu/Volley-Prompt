// Pairing-crypto checks (todo A3): secret shape/entropy, blobId derivation, and a full
// encrypt -> decrypt roundtrip, plus tamper and wrong-key rejection.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const pairing = require('../lib/pairing.js');

test('generatePairSecret returns 22 URL-safe base64 chars and never repeats', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const s = pairing.generatePairSecret();
    assert.ok(pairing.isPairSecret(s), `shape: ${s}`);
    seen.add(s);
  }
  assert.equal(seen.size, 50, 'secrets must be unique');
});

test('blobIdFor matches sha256 of the namespaced secret and is stable', async () => {
  const secret = pairing.generatePairSecret();
  const expected = crypto.createHash('sha256').update(`volleyprompt-sync-v1:${secret}`).digest('hex');
  const id = await pairing.blobIdFor(secret);
  assert.equal(id, expected);
  assert.equal(id, await pairing.blobIdFor(secret));
  assert.notEqual(id, await pairing.blobIdFor(pairing.generatePairSecret()));
});

test('encrypt -> decrypt roundtrips the profile object', async () => {
  const secret = pairing.generatePairSecret();
  const key = await pairing.deriveProfileKey(secret);
  const profile = { settings: { hue: 300 }, presets: [{ name: 'Game prompt' }], history: [{ round: 1, score: 90 }] };
  const blob = await pairing.encryptProfile(key, profile);
  assert.ok(/^[0-9a-f]{24}$/.test(blob.nonce));
  assert.ok(blob.text.length > 0);
  const out = await pairing.decryptProfile(await pairing.deriveProfileKey(secret), blob);
  assert.deepEqual(out, profile);
});

test('a tampered blob or wrong key fails to decrypt', async () => {
  const key = await pairing.deriveProfileKey(pairing.generatePairSecret());
  const blob = await pairing.encryptProfile(key, { a: 1 });
  await assert.rejects(() => pairing.decryptProfile(key, { ...blob, nonce: '0'.repeat(24) }));
  await assert.rejects(async () => pairing.decryptProfile(await pairing.deriveProfileKey(pairing.generatePairSecret()), blob));
  await assert.rejects(() => pairing.decryptProfile(key, { nonce: 'nope', text: blob.text }));
});

test('ciphertext does not leak the plaintext or the secret', async () => {
  const secret = pairing.generatePairSecret();
  const key = await pairing.deriveProfileKey(secret);
  const blob = await pairing.encryptProfile(key, { marker: 'TOPSECRET-MARKER' });
  assert.ok(!blob.text.includes('TOPSECRET-MARKER'));
  assert.ok(!JSON.stringify(blob).includes(secret));
});
