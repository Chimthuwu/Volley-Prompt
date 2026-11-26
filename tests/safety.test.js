// Safety checks: Stop really stops, pictures aren't silently dropped, the window can't be
// taken over, and the Scaffold writer can't be steered somewhere it shouldn't write.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const providers = require('../lib/providers.js');
const scaffold = require('../lib/scaffold.js');
const { writeScaffold } = require('../lib/scaffold-writer.js');
const { createWindowGuard } = require('../lib/window-guard.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-safety-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
}

// A stand-in AI program: records what it was given, waits, then leaves a mark and replies.
function fakeProgram(dir, { delay = 0 } = {}) {
  const script = path.join(dir, 'program.js');
  const files = { started: path.join(dir, 'started'), mark: path.join(dir, 'mark'), seen: path.join(dir, 'seen.json') };
  fs.writeFileSync(script, `
    const fs = require('fs');
    fs.writeFileSync(${JSON.stringify(files.started)}, 'x');
    let input = '';
    process.stdin.on('data', (d) => { input += d; });
    process.stdin.on('end', () => {
      fs.writeFileSync(${JSON.stringify(files.seen)}, JSON.stringify({ args: process.argv.slice(2), input }));
      setTimeout(() => {
        fs.writeFileSync(${JSON.stringify(files.mark)}, 'still running');
        process.stdout.write(JSON.stringify({ type: 'result', result: 'done' }) + '\\n');
      }, ${delay});
    });
  `);
  return { script, ...files };
}

function cli(program, extra = {}) {
  providers.init({ IDLE_MS: 30000 });
  const p = new providers.CliProvider('fake', 'Fake CLI', { binaries: ['node'], models: [], ...extra });
  p.script = program.script;
  return p;
}
const ask = (content = 'hi') => [{ role: 'user', content }];

async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error('timed out waiting'); await sleep(25); }
}

test('Stop ends the AI program at once', async (t) => {
  const program = fakeProgram(tmp(t), { delay: 1500 });
  const ctl = new AbortController();
  const call = cli(program).chat({ messages: ask(), signal: ctl.signal });
  await until(() => fs.existsSync(program.seen));
  const at = Date.now();
  ctl.abort();
  await assert.rejects(call, (e) => e.cancelled === true);
  assert.ok(Date.now() - at < 1200, 'reports back without waiting for the program');
  await sleep(1900);
  assert.equal(fs.existsSync(program.mark), false, 'the program must not keep running');
});

test('after Stop, no further program is launched', async (t) => {
  const program = fakeProgram(tmp(t));
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(cli(program).chat({ messages: ask(), signal: ctl.signal }), (e) => e.cancelled === true);
  await sleep(400);
  assert.equal(fs.existsSync(program.started), false);
});

test('"retry this round" can interrupt the program too', async (t) => {
  const program = fakeProgram(tmp(t), { delay: 1500 });
  let interrupt;
  const call = cli(program).chat({ messages: ask(), onCtl: (fn) => { interrupt = fn; } });
  await until(() => fs.existsSync(program.seen));
  interrupt();
  await assert.rejects(call, (e) => e.cancelled === true);
  await sleep(1900);
  assert.equal(fs.existsSync(program.mark), false);
});

test('Stop reaches the real program behind a Windows .cmd shim', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = tmp(t);
  const program = fakeProgram(dir, { delay: 1500 });
  const shim = path.join(dir, 'tool.cmd');
  fs.writeFileSync(shim, '@node "%~dp0program.js" %*\r\n');
  const p = cli(program);
  p.script = null;
  p._binCache = { at: Date.now(), bin: shim };
  const ctl = new AbortController();
  const call = p.chat({ messages: ask(), signal: ctl.signal });
  await until(() => fs.existsSync(program.seen));
  ctl.abort();
  await assert.rejects(call, (e) => e.cancelled === true);
  await sleep(1900);
  assert.equal(fs.existsSync(program.mark), false, 'the program under cmd.exe must be gone');
});

test('Claude is sent the picture itself', async (t) => {
  const claude = providers.getProvider('anthropic');
  assert.equal(claude.getCapabilities('sonnet').supportsVision, true);
  const program = fakeProgram(tmp(t));
  const p = cli(program, { imageInput: claude.imageInput });
  const content = [{ type: 'text', text: 'look at this' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/AAAA' } }];
  await p.chat({ messages: ask(content) });
  const seen = JSON.parse(fs.readFileSync(program.seen, 'utf8'));
  assert.equal(seen.args[seen.args.indexOf('--input-format') + 1], 'stream-json');
  const sent = JSON.parse(seen.input);
  assert.deepEqual(sent.message.content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/AAAA' } });
  assert.deepEqual(sent.message.content[1], { type: 'text', text: 'look at this' });
});

test('a text-only request still goes in as plain text', async (t) => {
  const program = fakeProgram(tmp(t));
  await cli(program, { imageInput: 'stream-json' }).chat({ messages: ask('just words') });
  const seen = JSON.parse(fs.readFileSync(program.seen, 'utf8'));
  assert.equal(seen.args[seen.args.indexOf('--input-format') + 1], 'text');
  assert.equal(seen.input, 'just words');
});

test('a CLI that cannot be sent pictures says so instead of dropping them', async (t) => {
  const google = providers.getProvider('google');
  assert.equal(google.getCapabilities('gemini-3-pro').supportsVision, false);
  assert.ok((await google.getModels()).every((m) => m.supportsVision === false));
  const program = fakeProgram(tmp(t));
  const content = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }];
  await assert.rejects(cli(program).chat({ messages: ask(content) }), /can't send pictures/);
  await sleep(300);
  assert.equal(fs.existsSync(program.started), false, 'nothing is launched');
});

test('only the app page counts as the app', () => {
  const page = path.join(ROOT, 'renderer', 'index.html');
  const guard = createWindowGuard(page);
  const own = pathToFileURL(page).href;
  assert.equal(guard.isAppUrl(own), true);
  assert.equal(guard.isAppUrl(`${own}#settings`), true);
  for (const other of [pathToFileURL(path.join(ROOT, 'site', 'index.html')).href, 'https://example.com/renderer/index.html', 'data:text/html,x', 'about:blank', '']) {
    assert.equal(guard.isAppUrl(other), false, other);
  }
});

test('the window cannot leave the app, and outsiders cannot use the bridge', () => {
  const page = path.join(ROOT, 'renderer', 'index.html');
  const guard = createWindowGuard(page);
  const hooks = {}; let openHandler; const opened = [];
  guard.guardWindow({ webContents: { on: (n, fn) => { hooks[n] = fn; }, setWindowOpenHandler: (fn) => { openHandler = fn; } } }, { openExternal: (u) => opened.push(u) });
  for (const name of ['will-navigate', 'will-redirect']) {
    let blocked = false;
    hooks[name]({ preventDefault: () => { blocked = true; } }, pathToFileURL(path.join(ROOT, 'dropped.html')).href);
    assert.equal(blocked, true, name);
  }
  for (const url of ['https://openrouter.ai', 'file:///C:/x.exe', 'ms-settings:about']) assert.equal(openHandler({ url }).action, 'deny');
  assert.deepEqual(opened, ['https://openrouter.ai']);

  const handlers = {};
  const ipc = { handle: (channel, fn) => { handlers[channel] = fn; } };
  guard.guardIpc(ipc);
  ipc.handle('demo', () => 'ran');
  assert.equal(handlers.demo({ senderFrame: { url: pathToFileURL(page).href } }), 'ran');
  assert.throws(() => handlers.demo({ senderFrame: { url: 'file:///C:/other.html' } }), /did not come from VolleyPrompt/);
  assert.throws(() => handlers.demo({}), /did not come from VolleyPrompt/);
});

test('main.js guards the bridge before registering anything, and guards the window', () => {
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const first = main.search(/^ipcMain\.handle\(/m);
  assert.ok(main.indexOf('windowGuard.guardIpc(ipcMain)') > -1 && main.indexOf('windowGuard.guardIpc(ipcMain)') < first);
  assert.ok(main.includes('windowGuard.guardWindow(win, shell)'));
  assert.ok(main.includes('pickedScaffoldDirs.has(dir)'), 'scaffold:write only accepts a picked folder');
});

test('AI-made paths cannot reach .git, climb out or use Windows tricks', () => {
  const bad = ['.git/hooks/pre-commit', '.GIT/config', '.git./config', '.git /config', 'GIT~1/config', 'sub/.git/config', '.git',
    'node_modules/x/index.js', 'NODE_M~1/x.js', '../x', 'a/../../x', '/etc/x', 'C:/x', 'a.txt:stream', 'con', 'src/NUL.txt', 'a//b', 'bad. /x'];
  for (const p of bad) assert.equal(scaffold.parseManifest(JSON.stringify([{ path: p, content: 'x' }])).ok, false, p);
  for (const p of ['.gitignore', '.github/workflows/ci.yml', '.env.example', 'src/app.js', 'console.js']) {
    assert.equal(scaffold.parseManifest(JSON.stringify([{ path: p, content: 'x' }])).ok, true, p);
  }
  assert.equal(scaffold.parseManifest(JSON.stringify([{ path: './src/a.js', content: 'x' }])).manifest[0].path, 'src/a.js');
  const both = (a, b) => scaffold.parseManifest(JSON.stringify([{ path: a, content: '1' }, { path: b, content: '2' }])).ok;
  assert.equal(both('A.txt', 'a.txt'), false, 'one file on Windows');
  assert.equal(both('lib', 'lib/x.js'), false, 'file and folder at once');
});

test('nothing is written through a link, not even the safe files', (t) => {
  const base = tmp(t);
  const dest = path.join(base, 'project'); const outside = path.join(base, 'outside');
  fs.mkdirSync(dest); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(dest, 'linked'), 'junction');
  const r = writeScaffold({ dir: dest, overwrite: true, backupRoot: path.join(base, 'backups'),
    manifest: [{ path: 'ok.txt', content: 'x' }, { path: 'linked/escaped.txt', content: 'x' }] });
  assert.equal(r.ok, false);
  assert.match(r.message, /is a link/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(path.join(dest, 'ok.txt')), false);
});

test('replacing files asks first, names them, and keeps the old versions', (t) => {
  const base = tmp(t);
  const dest = path.join(base, 'project'); const backups = path.join(base, 'backups');
  fs.mkdirSync(path.join(dest, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'src', 'app.js'), 'my own work');
  fs.writeFileSync(path.join(dest, 'same.txt'), 'unchanged');
  const manifest = [{ path: 'src/app.js', content: 'new' }, { path: 'same.txt', content: 'unchanged' }, { path: 'added.md', content: 'hi' }];

  const asked = writeScaffold({ dir: dest, manifest, backupRoot: backups });
  assert.equal(asked.needsMergePrompt, true);
  assert.deepEqual(asked.replaces, ['src/app.js']);
  assert.equal(fs.existsSync(path.join(dest, 'added.md')), false);

  const done = writeScaffold({ dir: dest, manifest, overwrite: true, backupRoot: backups });
  assert.equal(done.ok, true);
  assert.equal(done.written, 3);
  assert.deepEqual(done.replaced, ['src/app.js']);
  assert.equal(fs.readFileSync(path.join(dest, 'src', 'app.js'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(done.backupDir, 'src', 'app.js'), 'utf8'), 'my own work');
  assert.deepEqual(fs.readdirSync(dest).filter((f) => f.endsWith('.tmp')), []);
});

test('if the old version cannot be saved, nothing is changed', (t) => {
  const base = tmp(t);
  const dest = path.join(base, 'project'); fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'a.txt'), 'keep me');
  const blocked = path.join(base, 'not-a-folder'); fs.writeFileSync(blocked, 'x');
  const r = writeScaffold({ dir: dest, overwrite: true, backupRoot: blocked,
    manifest: [{ path: 'first.txt', content: 'x' }, { path: 'a.txt', content: 'new' }] });
  assert.equal(r.ok, false);
  assert.match(r.message, /nothing was written/);
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'keep me');
  assert.equal(fs.existsSync(path.join(dest, 'first.txt')), false);
});

test('a file that is also linked elsewhere is not changed there', (t) => {
  const base = tmp(t);
  const dest = path.join(base, 'project'); fs.mkdirSync(dest);
  const original = path.join(base, 'elsewhere.txt'); fs.writeFileSync(original, 'original');
  fs.linkSync(original, path.join(dest, 'a.txt'));
  const r = writeScaffold({ dir: dest, overwrite: true, backupRoot: path.join(base, 'backups'), manifest: [{ path: 'a.txt', content: 'new' }] });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(original, 'utf8'), 'original');
});
