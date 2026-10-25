const { app, BrowserWindow, ipcMain, safeStorage, shell, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

const API = 'https://openrouter.ai/api/v1';
const keyFile = () => path.join(app.getPath('userData'), 'key.bin');
const runsDir = () => path.join(app.getPath('documents'), 'VolleyPrompt');

const AUTHOR_SYSTEM = `You are an expert prompt engineer. The user wants a prompt they can give to an AI coding assistant to build a game or app. Write a clear, complete, well-structured prompt: goal, tech stack, core features, constraints, scope/milestones, and what 'done' looks like. Make reasonable assumptions explicit instead of leaving gaps. When given critic feedback, revise accordingly and keep what already works. Output ONLY the prompt itself, no preamble or commentary.`;

const CRITIC_SYSTEM = `You are a harsh but fair reviewer of AI prompts. Review the prompt against this rubric:
1. Clarity - could anything be read two ways?
2. Missing details - tech stack, platforms, controls, art/audio, data, edge cases.
3. Contradictions between sections.
4. Scope creep - is it too big for a first build? Is there a sensible milestone order?
5. Testability - is it clear what 'done' means?

List issues ranked by severity (HIGH / MED / LOW) with a concrete fix for each. Do not rewrite the whole prompt. Do not praise for the sake of it. End with exactly one final line: 'VERDICT: APPROVE' if there are no HIGH issues left, otherwise 'VERDICT: REVISE'.`;

let win, current = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: '#0b0820', title: 'VolleyPrompt',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ---- key storage (encrypted with the OS when possible) ----
function loadKey() {
  try {
    const buf = fs.readFileSync(keyFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch { return ''; }
}
function saveKey(k) {
  fs.mkdirSync(path.dirname(keyFile()), { recursive: true });
  if (!k) { try { fs.unlinkSync(keyFile()); } catch {} return; }
  fs.writeFileSync(keyFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(k) : Buffer.from(k));
}

function friendly(status, body = '') {
  if (status === 401 || status === 403) return 'OpenRouter rejected your API key. Re-check it in Settings.';
  if (status === 402) return 'Out of OpenRouter credits. Add a few dollars at openrouter.ai/credits.';
  if (status === 404) return "That model name wasn't found. Pick one from the list.";
  if (status === 429) return 'Rate limited. Wait a moment and try again.';
  return `Request failed (${status}). ${body.slice(0, 200)}`;
}

ipcMain.handle('key:has', () => !!loadKey());
ipcMain.handle('key:save', (_e, k) => { saveKey((k || '').trim()); return true; });
ipcMain.handle('key:test', async (_e, k) => {
  const key = (k || '').trim() || loadKey();
  if (!key) return { ok: false, message: 'Paste your key first.' };
  try {
    const r = await fetch(`${API}/auth/key`, { headers: { Authorization: `Bearer ${key}` } });
    if (r.ok) return { ok: true, message: 'Key works!' };
    return { ok: false, message: friendly(r.status) };
  } catch { return { ok: false, message: "Can't reach OpenRouter. Check your internet." }; }
});
const CHEAP_PER_M_TOKENS = 2; // $2 per million tokens (prompt+completion combined) or cheaper
ipcMain.handle('models:list', async () => {
  try {
    const r = await fetch(`${API}/models`);
    const j = await r.json();
    const rows = j.data.map((m) => {
      const prompt = parseFloat(m.pricing?.prompt || '0') || 0;
      const completion = parseFloat(m.pricing?.completion || '0') || 0;
      const perM = (prompt + completion) * 1e6;
      const isFree = perM === 0 || /:free$/i.test(m.id);
      const isStealth = /stealth|cloak/i.test(m.id) || /stealth|cloak/i.test(m.name || '');
      return { id: m.id, perM, isFree, isStealth };
    }).filter((m) => m.isFree || m.isStealth || m.perM <= CHEAP_PER_M_TOKENS);
    const rank = (m) => (m.isFree ? 0 : m.isStealth ? 1 : 2);
    rows.sort((a, b) => rank(a) - rank(b) || a.perM - b.perM || a.id.localeCompare(b.id));
    return rows.map((m) => m.id);
  } catch { return []; }
});
ipcMain.handle('clipboard:write', (_e, t) => { clipboard.writeText(t); return true; });
ipcMain.handle('folder:open', () => { fs.mkdirSync(runsDir(), { recursive: true }); shell.openPath(runsDir()); });
ipcMain.handle('url:open', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });

async function stream(key, model, system, messages, signal, onDelta) {
  const req = () => fetch(`${API}/chat/completions`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'VolleyPrompt' },
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
  });
  let res;
  for (let attempt = 0; ; attempt++) {
    try { res = await req(); } catch (e) {
      if (signal.aborted) throw e;
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      throw new Error("Can't reach OpenRouter. Check your internet.");
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    break;
  }
  if (!res.ok) throw new Error(friendly(res.status, await res.text().catch(() => '')));
  const dec = new TextDecoder();
  let buf = '', text = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(j.error.message || 'Model error');
      const d = j.choices?.[0]?.delta?.content;
      if (d) { text += d; onDelta(d); }
    }
  }
  if (!text.trim()) throw new Error('The model returned nothing. Try a different model.');
  return text;
}

const verdictOf = (t) => {
  const m = [...t.matchAll(/VERDICT:\s*\**\s*(APPROVE|REVISE)/gi)];
  return m.length ? m[m.length - 1][1].toUpperCase() : 'REVISE';
};

ipcMain.handle('run:start', async (_e, cfg) => {
  if (current) return;
  const key = loadKey();
  const send = (ev) => win && !win.isDestroyed() && win.webContents.send('run:event', ev);
  if (!key) return send({ type: 'error', message: 'No API key yet. Open Settings and paste it.' });
  const ctl = new AbortController();
  current = { ctl, resolveNotes: null };
  const { idea, author, critic } = cfg;
  const rounds = Math.max(1, Math.min(8, cfg.rounds | 0 || 3));
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  fs.mkdirSync(runsDir(), { recursive: true });
  const logPath = path.join(runsDir(), `${stamp}.md`);
  const log = [`# VolleyPrompt ${stamp}\n`, `Author: ${author}  \nCritic: ${critic}\n`, `## Idea\n\n${idea}\n`];
  const history = [{ role: 'user', content: `Write the prompt for this idea:\n\n${idea}` }];
  let draft = '';
  try {
    for (let r = 1; r <= rounds; r++) {
      send({ type: 'round', r, rounds });
      send({ type: 'panel', role: 'author', r });
      draft = await stream(key, author, AUTHOR_SYSTEM, history, ctl.signal, (d) => send({ type: 'delta', role: 'author', text: d }));
      history.push({ role: 'assistant', content: draft });

      send({ type: 'panel', role: 'critic', r });
      const review = await stream(key, critic, CRITIC_SYSTEM,
        [{ role: 'user', content: `Original idea:\n${idea}\n\nPrompt to review:\n\n${draft}` }],
        ctl.signal, (d) => send({ type: 'delta', role: 'critic', text: d }));
      log.push(`## Round ${r}\n`, `### Draft\n\n${draft}\n`, `### Review\n\n${review}\n`);
      fs.writeFileSync(logPath, log.join('\n'));

      const verdict = verdictOf(review);
      send({ type: 'verdict', verdict });
      if (verdict === 'APPROVE' || r === rounds) break;

      let notes = '';
      if (!cfg.auto) {
        send({ type: 'await-notes' });
        const reply = await new Promise((res) => { current.resolveNotes = res; });
        if (reply === null) break; // user chose "finish here"
        notes = reply.trim();
      }
      let follow = `Critic feedback:\n\n${review}\n\n`;
      if (notes) follow += `My own notes (these take priority):\n${notes}\n\n`;
      follow += 'Revise the prompt. Output ONLY the full revised prompt.';
      history.push({ role: 'user', content: follow });
      log.push(`### Your notes\n\n${notes || '(none)'}\n`);
    }
    const finalPath = path.join(runsDir(), `${stamp}-final.md`);
    fs.writeFileSync(finalPath, draft);
    log.push('## Final prompt\n', draft);
    fs.writeFileSync(logPath, log.join('\n'));
    send({ type: 'done', final: draft, file: finalPath });
  } catch (e) {
    if (ctl.signal.aborted) send({ type: 'done', final: draft, file: '', stopped: true });
    else send({ type: 'error', message: e.message || String(e), partial: draft });
  } finally { current = null; }
});

ipcMain.handle('run:notes', (_e, notes) => { current?.resolveNotes?.(notes); });
ipcMain.handle('run:stop', () => { if (current) { current.ctl.abort(); current.resolveNotes?.(null); } });
