const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};


function toast(msg, ms = 6000) {
  const t = $('toast'); t.textContent = msg; show('toast');
  clearTimeout(toast.t); toast.t = setTimeout(() => show('toast', false), ms);
}

// ---- Collapsible sidebar — applied immediately (before the async model fetch below)
// so a remembered collapsed state doesn't flash open on load. ----
const sidebarEl = document.querySelector('.sidebar');
function setSidebarCollapsed(collapsed) {
  sidebarEl.classList.toggle('sidebar-collapsed', collapsed);
  $('btnSidebarToggle').setAttribute('aria-expanded', String(!collapsed));
  store.set('sidebarCollapsed', collapsed ? '1' : '0');
}
setSidebarCollapsed(store.get('sidebarCollapsed', '0') === '1');
$('btnSidebarToggle').onclick = () => setSidebarCollapsed(!sidebarEl.classList.contains('sidebar-collapsed'));

// ---- Theme (hue/saturation/contrast) — shifts the actual accent CSS vars via HSL math,
// so body text stays crisp and only the neon palette moves. Applied immediately to avoid
// a flash of the default palette before the user's saved preference kicks in. ----
const THEME_BASE_HSL = {
  '--neon-cyan': [183, 100, 50],
  '--neon-magenta': [344, 100, 59],
  '--neon-green': [156, 100, 51],
  '--neon-purple': [275, 100, 59],
};
function applyTheme({ hue, sat, contrast }) {
  const root = document.documentElement.style;
  for (const [name, [h, s, l]] of Object.entries(THEME_BASE_HSL)) {
    const newH = ((h + hue) % 360 + 360) % 360;
    const newS = Math.min(100, Math.max(0, s * (sat / 100)));
    const newL = Math.min(100, Math.max(0, 50 + (l - 50) * (contrast / 100)));
    root.setProperty(name, `hsl(${newH.toFixed(0)}, ${newS.toFixed(0)}%, ${newL.toFixed(0)}%)`);
  }
  // Keep the purple-tinted borders/glow in step with the shifted purple instead of
  // staying frozen at the original hue.
  const [ph, ps] = THEME_BASE_HSL['--neon-purple'];
  const h2 = ((ph + hue) % 360 + 360) % 360;
  const s2 = Math.min(100, Math.max(0, ps * (sat / 100)));
  root.setProperty('--line', `hsla(${h2.toFixed(0)}, ${s2.toFixed(0)}%, 50%, 0.3)`);
  root.setProperty('--line-glow', `hsla(${h2.toFixed(0)}, ${s2.toFixed(0)}%, 50%, 0.8)`);
}
const hueInput = $('themeHue'), satInput = $('themeSat'), contrastInput = $('themeContrast');
hueInput.value = store.get('themeHue', '0');
satInput.value = store.get('themeSat', '100');
contrastInput.value = store.get('themeContrast', '100');
function currentThemeValues() { return { hue: +hueInput.value, sat: +satInput.value, contrast: +contrastInput.value }; }
applyTheme(currentThemeValues());
function persistAndApplyTheme() {
  const v = currentThemeValues();
  applyTheme(v);
  store.set('themeHue', v.hue); store.set('themeSat', v.sat); store.set('themeContrast', v.contrast);
}
[hueInput, satInput, contrastInput].forEach((el) => el.addEventListener('input', persistAndApplyTheme));
$('btnThemeReset').onclick = () => { hueInput.value = 0; satInput.value = 100; contrastInput.value = 100; persistAndApplyTheme(); };

const themeBtn = $('btnTheme'), themePanel = $('themePanel');
function closeThemePanel() { themePanel.classList.add('hidden'); themeBtn.setAttribute('aria-expanded', 'false'); }
themeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willShow = themePanel.classList.contains('hidden');
  themePanel.classList.toggle('hidden', !willShow);
  themeBtn.setAttribute('aria-expanded', String(willShow));
});
themePanel.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', (e) => { if (!themePanel.classList.contains('hidden') && e.target !== themeBtn) closeThemePanel(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !themePanel.classList.contains('hidden')) closeThemePanel(); });

(async () => {
  $('author').value = store.get('author', 'deepseek/deepseek-chat-v3.1:free');
  $('critic').value = store.get('critic', 'meta-llama/llama-3.3-70b-instruct:free');
  $('rounds').value = store.get('rounds', '3');
  $('idea').value = store.get('idea', '');
  $('auto').checked = store.get('auto', '0') === '1';
  if (!(await pv.hasKey())) openModal(true);
  const ids = await pv.models();
  $('modelList').innerHTML = ids.map((m) => `<option value="${m}">`).join('');
})();

function openModal(first) {
  $('modalTitle').textContent = first ? 'Welcome! One-time setup' : 'Settings';
  $('keyMsg').textContent = ''; $('keyInput').value = '';
  show('modal'); $('keyInput').focus();
}
$('btnSettings').onclick = () => openModal(false);
$('btnCloseModal').onclick = () => show('modal', false);
$('btnFolder').onclick = () => pv.openFolder();
document.querySelectorAll('[data-url]').forEach((a) => a.onclick = (e) => { e.preventDefault(); pv.openUrl(a.dataset.url); });
$('btnSaveKey').onclick = async () => {
  const k = $('keyInput').value.trim(), msg = $('keyMsg');
  if (!k) { msg.className = 'msg bad'; msg.textContent = 'Paste your key first.'; return; }
  msg.className = 'msg'; msg.textContent = 'Checking…';
  const r = await pv.testKey(k);
  msg.className = 'msg ' + (r.ok ? 'ok' : 'bad'); msg.textContent = r.message;
  if (r.ok) { await pv.saveKey(k); setTimeout(() => show('modal', false), 700); }
};

$('btnStart').onclick = async () => {
  const idea = $('idea').value.trim();
  if (!idea) { toast('Type your idea first 🙂'); $('idea').focus(); return; }
  if (!(await pv.hasKey())) { openModal(true); return; }
  const cfg = { idea, author: $('author').value.trim(), critic: $('critic').value.trim(), rounds: +$('rounds').value || 3, auto: $('auto').checked };
  if (!cfg.author || !cfg.critic) { toast('Pick a model for both AIs.'); return; }
  for (const k of ['author', 'critic', 'rounds', 'idea']) store.set(k, cfg[k]);
  store.set('auto', cfg.auto ? '1' : '0');

  if (pendingAttachments.length || pendingFolders.some((f) => f.status === 'ready')) {
    const btnStart = $('btnStart');
    const originalLabel = btnStart.textContent;
    btnStart.disabled = true; btnStart.textContent = 'Processing files…';
    try {
      cfg.attachments = await buildAttachmentPayload();
    } catch (e) {
      btnStart.disabled = false; btnStart.textContent = originalLabel;
      toast('⚠ ' + (e.message || 'Could not process attachments.'), 8000);
      return;
    }
    btnStart.disabled = false; btnStart.textContent = originalLabel;
  }

  $('aOut').textContent = $('cOut').textContent = '';
  $('aRound').textContent = $('cRound').textContent = '';
  show('setup', false); show('result', false); show('notesBox', false); show('run');
  $('statusText').textContent = 'Starting…';
  pv.start(cfg);
};
$('btnStop').onclick = () => pv.stop();
$('btnContinue').onclick = () => { const n = $('notes').value; $('notes').value = ''; show('notesBox', false); pv.sendNotes(n); };
$('btnFinish').onclick = () => { show('notesBox', false); pv.sendNotes(null); };
$('btnCopy').onclick = async () => { await pv.copy($('final').value); toast('Copied! Paste it into your coding AI.', 3000); };
$('btnBack').onclick = () => { show('result', false); show('run', false); show('setup'); $('idea').focus(); };
document.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => { await pv.copy($(b.dataset.copy).textContent); toast('Copied!', 1500); });
document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'Enter' && !$('setup').classList.contains('hidden')) $('btnStart').click(); });
$('btnAgain').onclick = () => { show('result', false); show('run', false); show('setup'); };

// ---- Attachment UI shell (Phase 2 — local-only, not wired into pv.start) ----
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.txt', '.md', '.markdown', '.json', '.csv', '.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.htm', '.css']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
let pendingAttachments = [];
let attachmentIdSeq = 0;

const extOf = (name) => { const i = name.lastIndexOf('.'); return i === -1 ? '' : name.slice(i).toLowerCase(); };
const formatSize = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const isDuplicateFile = (file) => pendingAttachments.some((a) => a.file.name === file.name && a.file.size === file.size && a.file.lastModified === file.lastModified);

function addAttachmentFiles(fileList) {
  const rejected = [];
  for (const file of Array.from(fileList)) {
    const ext = extOf(file.name);
    if (!ALLOWED_EXT.has(ext)) { rejected.push(`${file.name} (unsupported type)`); continue; }
    if (file.size > MAX_FILE_BYTES) { rejected.push(`${file.name} (over 25 MB)`); continue; }
    if (isDuplicateFile(file)) continue;
    if (pendingAttachments.length >= MAX_FILES) { rejected.push(`${file.name} (max ${MAX_FILES} attachments)`); continue; }
    let url = null;
    if (IMAGE_EXT.has(ext)) { try { url = URL.createObjectURL(file); } catch { url = null; } }
    pendingAttachments.push({ id: ++attachmentIdSeq, file, url });
  }
  if (rejected.length) toast('Skipped: ' + rejected.join(', '), 8000);
  renderAttachments();
}

function removeAttachment(id) {
  const idx = pendingAttachments.findIndex((a) => a.id === id);
  if (idx === -1) return;
  const [removed] = pendingAttachments.splice(idx, 1);
  if (removed.url) URL.revokeObjectURL(removed.url);
  renderAttachments();
}

function renderAttachments() {
  const tray = $('attachment-tray');
  if (!tray) return;
  tray.textContent = '';
  tray.classList.toggle('hidden', pendingAttachments.length === 0 && pendingFolders.length === 0);
  for (const f of pendingFolders) {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip folder-chip' + (f.status === 'processing' ? ' processing' : '');

    const thumb = document.createElement('div');
    thumb.className = 'chip-thumb';
    thumb.textContent = '📁';

    const info = document.createElement('div');
    info.className = 'chip-info';
    const name = document.createElement('span');
    name.className = 'chip-name'; name.title = f.name; name.textContent = f.name;
    const size = document.createElement('span');
    size.className = 'chip-size';
    size.textContent = f.status === 'processing' ? `Reading… (${f.files.length}/${f.fileCount})` : `${f.fileCount} file${f.fileCount === 1 ? '' : 's'}`;
    info.append(name, size);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.className = 'chip-remove'; removeBtn.title = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove ${f.name}`);
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => removeFolder(f.id));

    chip.append(thumb, info, removeBtn);
    tray.appendChild(chip);
  }
  for (const a of pendingAttachments) {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    const thumb = document.createElement('div');
    thumb.className = 'chip-thumb';
    if (a.url) {
      const img = document.createElement('img');
      img.src = a.url; img.alt = '';
      img.onerror = () => { thumb.textContent = '📄'; img.remove(); };
      thumb.appendChild(img);
    } else {
      thumb.textContent = extOf(a.file.name) === '.pdf' ? '📕' : '📄';
    }

    const info = document.createElement('div');
    info.className = 'chip-info';
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = a.file.name;
    name.title = a.file.name;
    const size = document.createElement('span');
    size.className = 'chip-size';
    size.textContent = formatSize(a.file.size);
    info.append(name, size);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'chip-remove';
    removeBtn.title = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove ${a.file.name}`);
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => removeAttachment(a.id));

    chip.append(thumb, info, removeBtn);
    tray.appendChild(chip);
  }
}

// ---- Phase 5: project-folder context (filtered, size-capped, read off the main thread's path) ----
const IGNORED_DIR_NAMES = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage', 'vendor', 'venv', '.venv', '__pycache__', '.idea', '.vscode']);
const IGNORED_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.env', '.env.local', '.env.production']);
const IGNORED_FILE_PATTERNS = [/^\.env(\..+)?$/i, /\.lock$/i, /^package-lock\.json$/i, /^yarn\.lock$/i, /^pnpm-lock\.yaml$/i, /\.map$/i, /\.min\.(js|css)$/i, /\.(pem|key|crt|pfx|p12)$/i];
// Allowlist, not a blocklist: images/binaries are simply never in this set, so they're
// skipped without needing a separate "ignored binary extensions" list to maintain.
const FOLDER_ALLOWED_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.html', '.css', '.scss', '.json', '.md', '.txt', '.yaml', '.yml', '.toml', '.xml', '.svg', '.sql', '.sh', '.bat', '.ps1', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.php', '.vue', '.svelte']);
const MAX_FOLDER_FILES = 50;
const MAX_FOLDER_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_FOLDER_FILE_BYTES = 512 * 1024;
const MAX_FOLDERS = 3;
const FOLDER_READ_BATCH = 8;

let pendingFolders = [];
let foldersProcessingCount = 0;

function isFolderPathIgnored(relPath) {
  const segs = relPath.split('/');
  const base = segs[segs.length - 1];
  if (segs.slice(0, -1).some((s) => IGNORED_DIR_NAMES.has(s))) return true;
  if (IGNORED_FILE_NAMES.has(base)) return true;
  return IGNORED_FILE_PATTERNS.some((rx) => rx.test(base));
}

function setProcessingLock(on) {
  const btn = $('btnStart');
  btn.disabled = on;
  if (on) { btn.dataset.prevLabel = btn.dataset.prevLabel || btn.textContent; btn.textContent = 'Reading project folder…'; }
  else if (btn.dataset.prevLabel) { btn.textContent = btn.dataset.prevLabel; delete btn.dataset.prevLabel; }
}
function beginFolderProcessing() { foldersProcessingCount++; setProcessingLock(true); }
function endFolderProcessing() { foldersProcessingCount = Math.max(0, foldersProcessingCount - 1); if (foldersProcessingCount === 0) setProcessingLock(false); }

function removeFolder(id) {
  const idx = pendingFolders.findIndex((f) => f.id === id);
  if (idx === -1) return;
  const [removed] = pendingFolders.splice(idx, 1);
  removed.aborted = true; // lets an in-flight read batch notice and stop applying results
  renderAttachments();
}

async function handleFolderSelection(fileList) {
  const all = Array.from(fileList);
  if (!all.length) return;
  const rootName = (all[0].webkitRelativePath || all[0].name).split('/')[0] || 'Project';
  if (pendingFolders.length >= MAX_FOLDERS) { toast(`You can attach up to ${MAX_FOLDERS} project folders.`, 6000); return; }

  // Metadata-only pass (sizes, paths, extensions) before any reading — so a folder that's
  // too big gets one clear rejection instead of a partial, silently-truncated import.
  const eligible = [];
  for (const file of all) {
    const rel = file.webkitRelativePath || file.name;
    const relInFolder = rel.split('/').slice(1).join('/');
    if (!relInFolder || isFolderPathIgnored(rel)) continue;
    if (!FOLDER_ALLOWED_EXT.has(extOf(file.name))) continue;
    eligible.push({ file, path: relInFolder });
  }

  if (!eligible.length) { toast(`No supported source files found in "${rootName}".`, 6000); return; }
  if (eligible.length > MAX_FOLDER_FILES) {
    toast(`"${rootName}" has ${eligible.length} eligible files — the limit is ${MAX_FOLDER_FILES}. Select a smaller subfolder.`, 10000); return;
  }
  const totalSize = eligible.reduce((s, e) => s + e.file.size, 0);
  if (totalSize > MAX_FOLDER_TOTAL_BYTES) {
    toast(`"${rootName}" is ${(totalSize / 1024 / 1024).toFixed(1)}MB of source — the limit is ${(MAX_FOLDER_TOTAL_BYTES / 1024 / 1024).toFixed(1)}MB. Select a smaller subfolder.`, 10000); return;
  }
  const tooBig = eligible.filter((e) => e.file.size > MAX_FOLDER_FILE_BYTES);
  if (tooBig.length) {
    toast(`"${rootName}" has files over ${Math.round(MAX_FOLDER_FILE_BYTES / 1024)}KB: ${tooBig.map((e) => e.path).join(', ')}. Remove or split them and try again.`, 12000); return;
  }

  const folder = { id: 'folder-' + (++attachmentIdSeq), kind: 'folder', name: rootName, status: 'processing', aborted: false, files: [], fileCount: eligible.length };
  pendingFolders.push(folder);
  renderAttachments();
  beginFolderProcessing();
  try {
    for (let i = 0; i < eligible.length; i += FOLDER_READ_BATCH) {
      if (folder.aborted) return;
      const batch = eligible.slice(i, i + FOLDER_READ_BATCH);
      const texts = await Promise.all(batch.map((e) => readFileAsText(e.file).catch(() => null)));
      if (folder.aborted) return;
      batch.forEach((e, idx) => { if (texts[idx] !== null) folder.files.push({ path: e.path, text: texts[idx] }); });
      renderAttachments();
    }
    if (folder.aborted) return;
    const skipped = eligible.length - folder.files.length;
    folder.status = 'ready'; folder.fileCount = folder.files.length;
    if (skipped) toast(`"${rootName}": ${skipped} file(s) couldn't be read and were skipped.`, 8000);
    renderAttachments();
  } catch (e) {
    if (!folder.aborted) {
      removeFolder(folder.id);
      toast(`Could not read "${rootName}": ${e.message || e}`, 8000);
    }
  } finally {
    endFolderProcessing();
  }
}

// ---- Phase 3: serialize attachments for the real request (renderer-side only; main.js re-validates) ----
const MAX_TOTAL_SERIALIZED_CHARS = 20 * 1024 * 1024; // ~20MB of base64/text, matches main.js's budget

const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error || new Error('Failed to read ' + file.name));
  r.readAsDataURL(file);
});
const readFileAsText = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error || new Error('Failed to read ' + file.name));
  r.readAsText(file);
});

async function buildAttachmentPayload() {
  const pdfs = pendingAttachments.filter((a) => extOf(a.file.name) === '.pdf');
  if (pdfs.length) toast(`PDF parsing is coming soon. Please use images or text files for now. (skipped: ${pdfs.map((p) => p.file.name).join(', ')})`, 10000);
  const sendable = pendingAttachments.filter((a) => extOf(a.file.name) !== '.pdf');
  const out = [];
  let totalChars = 0;
  for (const a of sendable) {
    const ext = extOf(a.file.name);
    if (IMAGE_EXT.has(ext)) {
      const dataUrl = await readFileAsDataURL(a.file);
      totalChars += dataUrl.length;
      out.push({ name: a.file.name, kind: 'image', dataUrl });
    } else {
      const text = await readFileAsText(a.file);
      totalChars += text.length;
      out.push({ name: a.file.name, kind: 'text', text });
    }
    if (totalChars > MAX_TOTAL_SERIALIZED_CHARS) {
      throw new Error(`Attachments are too large once encoded (${(totalChars / 1024 / 1024).toFixed(1)}MB). Remove a file or two and try again.`);
    }
  }
  for (const f of pendingFolders) {
    if (f.status !== 'ready' || !f.files.length) continue;
    const files = f.files.map((x) => ({ path: x.path, text: x.text }));
    totalChars += f.name.length + files.reduce((s, x) => s + x.text.length, 0);
    out.push({ name: f.name, kind: 'folder', files });
    if (totalChars > MAX_TOTAL_SERIALIZED_CHARS) {
      throw new Error(`Attachments are too large once encoded (${(totalChars / 1024 / 1024).toFixed(1)}MB). Remove a file or two and try again.`);
    }
  }
  return out;
}

// ---- Phase 4: speech-to-text dictation into #idea (renderer-only, Web Speech API) ----
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = $('mic-btn');
let recognition = null;

function setMicState(label, recording) {
  micBtn.title = label; micBtn.setAttribute('aria-label', label);
  micBtn.classList.toggle('recording', recording);
}

if (micBtn) {
  if (!SpeechRecognitionCtor) {
    micBtn.disabled = true;
    setMicState('Speech-to-text not supported in this environment.', false);
  } else {
    micBtn.disabled = false;
    setMicState('Voice input', false);
    micBtn.addEventListener('click', () => {
      if (recognition) { recognition.stop(); return; }
      startDictation();
    });
  }
}

function startDictation() {
  const idea = $('idea');
  // Insert at the cursor position as it was when dictation started; never clobber existing text.
  let cursor = idea.selectionStart ?? idea.value.length;
  recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = navigator.language || 'en-US';

  recognition.onstart = () => setMicState('Listening… click to stop', true);
  recognition.onresult = (e) => {
    let chunk = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) chunk += e.results[i][0].transcript;
    }
    if (!chunk) return;
    const before = idea.value.slice(0, cursor);
    const after = idea.value.slice(cursor);
    const sep = before && !/\s$/.test(before) ? ' ' : '';
    const insert = sep + chunk;
    idea.value = before + insert + after;
    cursor = before.length + insert.length;
    idea.selectionStart = idea.selectionEnd = cursor;
  };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'permission-denied' || e.error === 'service-not-allowed') {
      toast('🎤 Microphone access denied.', 6000);
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      toast('🎤 Voice input error: ' + e.error, 6000);
    }
  };
  recognition.onend = () => { recognition = null; setMicState('Voice input', false); };
  try { recognition.start(); } catch { recognition = null; toast('🎤 Could not start voice input.', 6000); }
}

const attachBtn = $('attach-btn'), fileInput = $('file-input'), editorWrapper = $('editorWrapper');
if (attachBtn && fileInput) {
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length) addAttachmentFiles(fileInput.files);
    fileInput.value = '';
  });
}
const folderBtn = $('folder-btn'), folderInput = $('folder-input');
if (folderBtn && folderInput) {
  folderBtn.addEventListener('click', () => {
    if (pendingFolders.length >= MAX_FOLDERS) { toast(`You can attach up to ${MAX_FOLDERS} project folders.`, 6000); return; }
    folderInput.click();
  });
  folderInput.addEventListener('change', () => {
    const files = folderInput.files;
    folderInput.value = '';
    if (files && files.length) handleFolderSelection(files);
  });
}
if (editorWrapper) {
  ['dragenter', 'dragover'].forEach((evt) => editorWrapper.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation(); editorWrapper.classList.add('drop-active');
  }));
  editorWrapper.addEventListener('dragleave', (e) => {
    if (!editorWrapper.contains(e.relatedTarget)) editorWrapper.classList.remove('drop-active');
  });
  editorWrapper.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    editorWrapper.classList.remove('drop-active');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addAttachmentFiles(e.dataTransfer.files);
  });
}
$('idea').addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const images = [];
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) images.push(f);
    }
  }
  if (images.length) addAttachmentFiles(images);
});

$('tbMin').onclick = () => pv.winMin();
$('tbMax').onclick = () => pv.winMax();
$('tbClose').onclick = () => pv.winClose();
$('btnNewChat').onclick = () => { show('result',false); show('run',false); show('setup'); $('idea').value=''; $('idea').focus(); };

async function loadHistory() {
  const items = await pv.runs();
  $('history').innerHTML = items.map((r) => `<div class="hist-item" data-path="${r.path}" title="${r.name.replace('-final.md','')}">${r.title || r.name.replace('-final.md','')}</div>`).join('');
  document.querySelectorAll('.hist-item').forEach((el) => el.onclick = async () => {
    const t = await (window.pv.copy && 0); // noop
  });
}
loadHistory();

// animated background
const c = $('bgCanvas'); const ctx = c.getContext('2d');
function resize(){ c.width=innerWidth; c.height=innerHeight; }
resize(); addEventListener('resize', resize);
let t=0;
function frame(){ t+=0.008; ctx.clearRect(0,0,c.width,c.height);
  for(let i=0;i<60;i++){
    const x=(Math.sin(t*0.7+i*1.3)*0.5+0.5)*c.width;
    const y=(Math.cos(t*0.5+i*0.9)*0.5+0.5)*c.height;
    const r=1+Math.sin(t+i)*1;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fillStyle=`rgba(${i%2?0:176},${i%2?240:38},${i%2?255:255},${0.25+Math.sin(t+i)*0.15})`;
    ctx.fill();
  }
  requestAnimationFrame(frame);
}
frame();
const panelOf = (role) => document.querySelector('.panel.' + role);
const streaming = (role, on) => panelOf(role).classList.toggle('streaming', on);

pv.onEvent((ev) => {
  switch (ev.type) {
    case 'round': $('statusText').textContent = `Round ${ev.r} of ${ev.rounds}`; $('dots').innerHTML = Array.from({ length: ev.rounds }, (_, i) => `<i class="${i < ev.r ? 'on' : ''}"></i>`).join(''); break;
    case 'panel': {
      const isA = ev.role === 'author';
      (isA ? $('aOut') : $('cOut')).textContent = '';
      (isA ? $('aRound') : $('cRound')).textContent = `· round ${ev.r}`;
      streaming('author', isA); streaming('critic', !isA);
      $('statusText').textContent = isA ? `✍ Writer is drafting (round ${ev.r})…` : `🔍 Reviewer is reading (round ${ev.r})…`;
      break;
    }
    case 'delta': {
      const o = ev.role === 'author' ? $('aOut') : $('cOut');
      o.textContent += ev.text; o.scrollTop = o.scrollHeight; break;
    }
    case 'verdict':
      streaming('critic', false);
      $('statusText').textContent = ev.verdict === 'APPROVE' ? '✅ Reviewer approved!' : '↻ Reviewer wants changes';
      break;
    case 'await-notes': show('notesBox'); $('notes').focus(); $('notesBox').scrollIntoView({ behavior: 'smooth' }); break;
    case 'notice': toast('ℹ ' + ev.message, 8000); break;
    case 'done':
      streaming('author', false); streaming('critic', false); show('notesBox', false);
      if (!ev.final) { show('run', false); show('setup'); toast('Stopped.'); break; }
      $('final').value = ev.final;
      $('savedAt').textContent = ev.file ? `Saved to ${ev.file}` : 'Stopped early — this is the latest draft.';
      show('run', false); show('result'); break;
    case 'error':
      streaming('author', false); streaming('critic', false); show('notesBox', false);
      show('run', false);
      if (ev.partial) { $('final').value = ev.partial; $('savedAt').textContent = 'Run failed — this is the latest draft.'; show('result'); }
      else show('setup');
      toast('⚠ ' + ev.message, 12000); break;
  }
});
