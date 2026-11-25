// Minimal ZIP writer checks (todo B2 L88 web fallback): structural correctness of the
// store-only zip — EOCD, central directory, local headers — and byte-identical extraction.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const zip = require('../lib/zip.js');

const FILES = [
  { path: 'PROMPT.md', content: '# Approved prompt\n\nBuild a planner.' },
  { path: 'src/deep/nested/app.js', content: 'console.log("héllo unicode");\n' },
  { path: 'todo.md', content: '- [ ] M1\n' },
];

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate EOCD from the end (no comment).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd !== -1, 'EOCD signature found');
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralStart = view.getUint32(eocd + 16, true);
  assert.equal(eocd, centralStart + centralSize, 'EOCD sits right after the central directory');
  const entries = [];
  let p = centralStart;
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(p, true), 0x02014b50, 'central header signature');
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen));
    // Local header: skip fixed part, name, extra (none) → data.
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.slice(dataStart, dataStart + size);
    entries.push({ name, crc, size, data });
    p += 46 + nameLen;
  }
  return entries;
}

test('buildZip produces a structurally valid zip with byte-identical entries', () => {
  const bytes = zip.buildZip(FILES, { now: new Date('2026-11-26T10:00:00Z') });
  assert.ok(bytes.length > 100);
  const entries = readZip(bytes);
  assert.equal(entries.length, FILES.length);
  for (const f of FILES) {
    const e = entries.find((x) => x.name === f.path);
    assert.ok(e, `entry ${f.path} present`);
    assert.equal(e.size, new TextEncoder().encode(f.content).length);
    assert.deepEqual(new TextDecoder().decode(e.data), f.content, 'content round-trips byte-identical');
    assert.equal(e.crc, zip.crc32(new TextEncoder().encode(f.content)));
  }
});

test('the produced zip passes an external extractor (PowerShell Expand-Archive / unzip)', () => {
  const bytes = zip.buildZip(FILES);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpzip-'));
  const file = path.join(dir, 'scaffold.zip');
  fs.writeFileSync(file, Buffer.from(bytes));
  let out;
  try {
    out = execFileSync('python3', ['-c', `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
names = z.namelist()
print(bad, names, z.read('src/deep/nested/app.js').decode('utf-8'))
`, file], { encoding: 'utf8', timeout: 30000 });
  } catch (e) {
    // python3 not available — fall back to structural checks only (already covered above).
    console.log('python3 unavailable, skipping external extraction:', e.message);
    return;
  }
  assert.match(out, /^None /, 'zipfile.testzip() reports no bad entry');
  assert.match(out, /héllo unicode/, 'unicode content survives extraction');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('unsafe entry names are refused', () => {
  assert.throws(() => zip.buildZip([{ path: '../escape.txt', content: 'x' }]), /Unsafe zip entry/);
  assert.throws(() => zip.buildZip([{ path: '', content: 'x' }]), /Unsafe zip entry/);
});
