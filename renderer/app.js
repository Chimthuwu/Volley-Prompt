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

const live = (role, on) => document.querySelector('.panel.' + role).classList.toggle('live', on);

pv.onEvent((ev) => {
  switch (ev.type) {
    case 'round': $('statusText').textContent = `Round ${ev.r} of ${ev.rounds}`; $('dots').innerHTML = Array.from({ length: ev.rounds }, (_, i) => `<i class="${i < ev.r ? 'on' : ''}"></i>`).join(''); break;
    case 'panel': {
      const isA = ev.role === 'author';
      (isA ? $('aOut') : $('cOut')).textContent = '';
      (isA ? $('aRound') : $('cRound')).textContent = `· round ${ev.r}`;
      live('author', isA); live('critic', !isA);
      $('statusText').textContent = isA ? `✍ Writer is drafting (round ${ev.r})…` : `🔍 Reviewer is reading (round ${ev.r})…`;
      break;
    }
    case 'delta': {
      const o = ev.role === 'author' ? $('aOut') : $('cOut');
      o.textContent += ev.text; o.scrollTop = o.scrollHeight; break;
    }
    case 'verdict':
      live('critic', false);
      $('statusText').textContent = ev.verdict === 'APPROVE' ? '✅ Reviewer approved!' : '↻ Reviewer wants changes';
      break;
    case 'await-notes': show('notesBox'); $('notes').focus(); $('notesBox').scrollIntoView({ behavior: 'smooth' }); break;
    case 'done':
      live('author', false); live('critic', false); show('notesBox', false);
      if (!ev.final) { show('run', false); show('setup'); toast('Stopped.'); break; }
      $('final').value = ev.final;
      $('savedAt').textContent = ev.file ? `Saved to ${ev.file}` : 'Stopped early — this is the latest draft.';
      show('run', false); show('result'); break;
    case 'error':
      live('author', false); live('critic', false); show('notesBox', false);
      show('run', false);
      if (ev.partial) { $('final').value = ev.partial; $('savedAt').textContent = 'Run failed — this is the latest draft.'; show('result'); }
      else show('setup');
      toast('⚠ ' + ev.message, 12000); break;
  }
});
