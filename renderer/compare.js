// Side-by-side comparison of two saved volleys. Loaded after app.js and uses its globals
// ($, show, toast, pv, renderLineDiff) plus the pure helpers in helpers.js (window.VPH).
(function () {
  const { parseStamp, formatMoney } = window.VPH;
  let cmp = null; // { a, b } loaded runs

  const rounds = (m) => (Array.isArray(m.snapshots) ? m.snapshots.length : m.rounds) || null;

  function metaRow(el, r, other, which) {
    el.textContent = '';
    const m = r.meta || {};
    const pair = m.modelPair || {};
    const better = (mine, theirs, lowerIsBetter) => mine != null && theirs != null && mine !== theirs && (lowerIsBetter ? mine < theirs : mine > theirs);
    const items = [
      ['Fitness', m.score != null ? `${m.score}/100` : '—', better(m.score, other.meta?.score, false)],
      ['Rounds', rounds(m) ?? '—', false],
      ['Cost', m.cost != null ? formatMoney(Number(m.cost)) : '—', better(Number(m.cost), Number(other.meta?.cost), true) && m.cost != null],
      ['Writer', pair.author || '—', false],
      ['Reviewer', pair.critic || '—', false],
      ['Mode', m.outputMode === 'deep-plan' ? 'Code plan' : 'Prompt', false],
      ['Outcome', m.outcome || 'not rated', false],
    ];
    for (const [k, v, good] of items) {
      const span = document.createElement('span');
      if (good) span.className = 'better';
      span.textContent = `${k}: ${v}${good ? ' ★' : ''}`;
      el.appendChild(span);
    }
  }

  function render() {
    if (!cmp) return;
    const { a, b } = cmp;
    $('compareHeadA').textContent = a.title; $('compareHeadA').title = a.title;
    $('compareHeadB').textContent = b.title; $('compareHeadB').title = b.title;
    metaRow($('compareMetaA'), a, b, 'a');
    metaRow($('compareMetaB'), b, a, 'b');
    $('compareTextA').textContent = a.final;
    if ($('compareDiff').checked) renderLineDiff($('compareTextB'), a.final, b.final);
    else $('compareTextB').textContent = b.final;
    const sa = a.meta?.score, sb = b.meta?.score;
    const sameIdea = a.idea && b.idea && a.idea.trim() === b.idea.trim();
    const delta = sa != null && sb != null ? ` Fitness ${sb >= sa ? '+' : ''}${sb - sa} for the right volley.` : '';
    $('compareSummary').textContent = (sameIdea ? 'Same original idea — a direct model/setup comparison.' : 'Different original ideas.') + delta;
  }

  async function load(name, items) {
    const got = await pv.openRun(name).catch(() => null);
    if (!got) return null;
    const row = items.find((x) => x.name === name);
    const d = parseStamp(name);
    return { ...got, title: `${(row && row.title) || name}${d ? ` · ${d.toLocaleDateString()}` : ''}` };
  }

  window.openCompare = async function (nameA, nameB) {
    const items = (await pv.runs().catch(() => [])) || [];
    const [a, b] = await Promise.all([load(nameA, items), load(nameB, items)]);
    if (!a || !b) { toast('Could not load one of those volleys.', 5000); return; }
    cmp = { a, b };
    show('compareModal');
    render();
  };

  $('compareDiff').addEventListener('change', render);
  $('compareClose').onclick = () => show('compareModal', false);
  $('compareModal').addEventListener('click', (e) => { if (e.target === $('compareModal')) show('compareModal', false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('compareModal').classList.contains('hidden')) show('compareModal', false); });
})();
