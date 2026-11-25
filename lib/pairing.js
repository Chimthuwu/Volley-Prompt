// VolleyPrompt pairing crypto (todo A3).
//
// One high-entropy secret identifies an account on every device:
//   secret   = 128 random bits -> URL-safe base64 (22 chars, no padding)
//   blobId   = sha256(secret), hex — the ONLY thing the sync server sees as a key
//   key      = PBKDF2-SHA256(secret, fixed app salt) -> AES-GCM key for the profile blob
// The server stores ciphertext it cannot read. The fixed salt is acceptable because the
// secret itself is 128-bit random (a salt defends low-entropy passwords, not this).
// Pure WebCrypto — runs in Electron, browsers and node (tests) unchanged.

const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 guidance for PBKDF2-SHA256
const encoder = new TextEncoder();

function subtle() {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto unavailable in this environment');
  return globalThis.crypto.subtle;
}

export function generatePairSecret() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isPairSecret(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value);
}

async function sha256Hex(text) {
  const digest = await subtle().digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function blobIdFor(secret) {
  return sha256Hex(`volleyprompt-sync-v1:${secret}`);
}

// Fixed application salt for PBKDF2 (see header comment).
const KEY_SALT = encoder.encode('volleyprompt-sync-v1:salt');

async function deriveRawBits(secret) {
  const base = await subtle().importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return subtle().deriveBits(
    { name: 'PBKDF2', salt: KEY_SALT, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    256,
  );
}

export async function deriveProfileKey(secret) {
  const bits = await deriveRawBits(secret);
  return subtle().importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Profile = one JSON-serialisable object. Returns { nonce, text } — both strings travel
// together inside the synced blob; the nonce is NOT secret, the key never leaves the device.
export async function encryptProfile(key, profile) {
  const nonceBytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(nonceBytes);
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv: nonceBytes },
    key,
    encoder.encode(JSON.stringify(profile)),
  );
  const bytes = new Uint8Array(ciphertext);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const nonce = [...nonceBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const text = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return { nonce, text };
}

export async function decryptProfile(key, { nonce, text }) {
  if (typeof nonce !== 'string' || !/^[0-9a-f]{24}$/.test(nonce) || typeof text !== 'string') {
    throw new Error('malformed profile blob');
  }
  const nonceBytes = new Uint8Array(12);
  for (let i = 0; i < 12; i++) nonceBytes[i] = parseInt(nonce.slice(i * 2, i * 2 + 2), 16);
  if (typeof atob === 'function') {
    const bin = atob(text);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: nonceBytes }, key, bytes);
    return JSON.parse(new TextDecoder().decode(plain));
  }
  const bytes = new Uint8Array(Buffer.from(text, 'base64'));
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: nonceBytes }, key, bytes);
  return JSON.parse(new TextDecoder().decode(plain));
}
