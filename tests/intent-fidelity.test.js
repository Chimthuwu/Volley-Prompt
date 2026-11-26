const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

for (const f of ['main.js', 'site/pv.js']) {
  test(`${f}: writer/critic carry intent-fidelity + ambition prompts`, () => {
    const s = read(f);
    assert.match(s, /INTENT FIDELITY/);
    assert.match(s, /7\. Intent fidelity/);
    assert.match(s, /AMBITION_WRITER/);
    assert.match(s, /AMBITION_CRITIC/);
    assert.doesNotMatch(s, /too big for a first build/);
  });
}
test('ambition selector exists in both UIs', () => {
  for (const f of ['renderer/index.html', 'site/index.html']) assert.match(read(f), /id="ambition"/);
});

