// VolleyPrompt minimal ZIP writer (todo B2 L88 web fallback) — STORE method only.
//
// Scaffolds are small text files; compression is unnecessary complexity, so this emits
// plain stored entries with a proper central directory — a real, standard zip every
// OS unzipper accepts, in ~120 dependency-free lines that run in node AND the browser
// (UMD like pairing.js/scaffold.js).
//
// buildZip(files, { now }) -> Uint8Array   files: [{ path, content }] (text only)
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VPZip = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const enc = (typeof TextEncoder !== 'undefined')
    ? new TextEncoder()
    : { encode: (s) => Buffer.from(s, 'utf8') };
  const dosDateTime = (d) => ({
    time: ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F),
    date: (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F),
  });
  const u16 = (arr, v) => { arr.push(v & 0xFF, (v >>> 8) & 0xFF); };
  const u32 = (arr, v) => { arr.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); };

  function buildZip(files, opts = {}) {
    const when = dosDateTime(opts.now || new Date());
    const out = [];
    const central = [];
    let offset = 0;
    const clean = (p) => String(p).replace(/\\/g, '/').replace(/^\/+/, '');
    for (const file of files) {
      const name = clean(file.path);
      if (!name || name.split('/').includes('..')) throw new Error(`Unsafe zip entry: ${name}`);
      const nameBytes = enc.encode(name);
      const data = enc.encode(String(file.content));
      const crc = crc32(data);
      u32(out, 0x04034b50);      // local file header signature
      u16(out, 20);              // version needed
      u16(out, 0x0800);          // flags: UTF-8 names
      u16(out, 0);               // method: store
      u16(out, when.time);
      u16(out, when.date);
      u32(out, crc);
      u32(out, data.length);     // compressed size
      u32(out, data.length);     // uncompressed size
      u16(out, nameBytes.length);
      u16(out, 0);               // extra field length
      for (const b of nameBytes) out.push(b);
      for (const b of data) out.push(b);
      // Central directory record for the same entry.
      u32(central, 0x02014b50);
      u16(central, 20);          // version made by
      u16(central, 20);          // version needed
      u16(central, 0x0800);
      u16(central, 0);
      u16(central, when.time);
      u16(central, when.date);
      u32(central, crc);
      u32(central, data.length);
      u32(central, data.length);
      u16(central, nameBytes.length);
      u16(central, 0);           // extra
      u16(central, 0);           // comment
      u16(central, 0);           // disk number
      u16(central, 0);           // internal attrs
      u32(central, 0);           // external attrs
      u32(central, offset);      // local header offset
      for (const b of nameBytes) central.push(b);
      offset += 30 + nameBytes.length + data.length;
    }
    const centralStart = offset;
    const centralSize = central.length;
    const total = central.length + files.length;
    u32(central, 0x06054b50);    // end of central directory
    u16(central, 0);
    u16(central, 0);
    u16(central, files.length);
    u16(central, files.length);
    u32(central, centralSize);
    u32(central, centralStart);
    u16(central, 0);             // comment length
    // Everything (local parts + central directory incl. EOCD) is already in order.
    return new Uint8Array([...out, ...central]);
  }
  return { buildZip, crc32 };
});
