// Pure helpers shared by the renderer (as window.VPH) and the unit tests (via require).
// Nothing in here touches the DOM, Electron, or the disk, so it can be tested with plain node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VPH = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const extOf = (name) => { const i = name.lastIndexOf('.'); return i === -1 ? '' : name.slice(i).toLowerCase(); };
  const formatSize = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  // Line diff via LCS. Returns null for absurdly large inputs so callers can fall back to plain text.
  function diffOps(A, B) {
    if (A.length * B.length > 160000) return null;
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { ops.push({ type: 'same', text: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: A[i++] }); }
      else { ops.push({ type: 'ins', text: B[j++] }); }
    }
    while (i < n) ops.push({ type: 'del', text: A[i++] });
    while (j < m) ops.push({ type: 'ins', text: B[j++] });
    return ops;
  }

  // Relevance ranking for oversized folder selections: entry points and configs first, then
  // source, then docs/styles, then the rest; shallower paths win ties.
  const CONTEXT_KEY_FILE_RX = /(^|\/)(readme[^/]*|package\.json|pyproject\.toml|cargo\.toml|go\.mod|requirements[^/]*|composer\.json|gemfile|makefile|dockerfile[^/]*|tsconfig[^/]*|vite\.config\.[^/]*|webpack\.config\.[^/]*|tailwind\.config\.[^/]*|main\.[a-z]+|index\.[a-z]+|app\.[a-z]+|server\.[a-z]+|routes?\.[a-z]+|config\.[a-z]+)$/i;
  const CONTEXT_EXT_RANK = { '.ts': 0, '.tsx': 0, '.js': 0, '.jsx': 0, '.mjs': 0, '.cjs': 0, '.py': 0, '.cs': 1, '.go': 1, '.rs': 1, '.java': 1, '.c': 1, '.cpp': 1, '.h': 1, '.hpp': 1, '.php': 1, '.vue': 1, '.svelte': 1, '.md': 2, '.html': 2, '.css': 2, '.scss': 2, '.sql': 2, '.sh': 2, '.bat': 2, '.ps1': 2, '.json': 2, '.yaml': 2, '.yml': 2, '.toml': 2, '.xml': 2, '.svg': 3, '.txt': 3 };
  function rankContextFiles(entries) {
    return entries.map((e) => {
      const path = e.path || e.name || '';
      const depth = path.split('/').length;
      const tier = CONTEXT_KEY_FILE_RX.test(path) ? 0 : (CONTEXT_EXT_RANK[extOf(path)] ?? 4);
      return { e, score: tier * 1000 + depth * 10 + path.length / 100 };
    }).sort((a, b) => a.score - b.score).map((x) => x.e);
  }

  // Run stamps ("2026-01-02-03-04-05") are written in UTC, so they must be parsed as UTC.
  function parseStamp(name) {
    const stamp = String(name).replace(/-(final|draft)\.md$/, '');
    const m = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(stamp);
    if (!m) return null;
    const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
    return isNaN(d) ? null : d;
  }

  // Sidebar search: every whitespace-separated word must appear in the title, project,
  // outcome, or either model of the run.
  function filterRuns(items, query) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return items;
    return items.filter((r) => {
      const mp = (r.meta && r.meta.modelPair) || {};
      const hay = [r.title, r.name, r.meta && r.meta.project, r.meta && r.meta.outcome, mp.author, mp.critic, r.incomplete ? 'stopped draft' : '']
        .filter(Boolean).join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  // Rough pre-run cost range. Each side is { inPerM, outPerM } in dollars per million tokens,
  // { free: true }, or null when the price is unknown (subscription / unlisted model).
  // low = the Reviewer approves after round 1, high = every allowed round runs.
  function estimateRunCost({ ideaChars = 0, attachChars = 0, rounds = 3, writer, reviewer }) {
    if (!writer || !reviewer) return null;
    const price = (side, tin, tout) => side.free ? 0 : ((tin * (side.inPerM || 0)) + (tout * (side.outPerM || 0))) / 1e6;
    const base = (ideaChars + attachChars) / 4 + 450; // idea + context + system prompt, in tokens
    const W_OUT = 1100, R_OUT = 800;
    let low = 0, high = 0;
    for (let r = 1; r <= Math.max(1, rounds); r++) {
      const writerIn = base + (r - 1) * (W_OUT + R_OUT + 250);
      const reviewerIn = base + W_OUT + 350;
      const c = price(writer, writerIn, W_OUT) + price(reviewer, reviewerIn, R_OUT);
      if (r === 1) low = c;
      high += c;
    }
    return { low, high };
  }
  function formatMoney(v) {
    if (v === 0) return '$0';
    if (v < 0.01) return '<$0.01';
    return '$' + v.toFixed(v < 1 ? 3 : 2).replace(/0$/, '');
  }

  return { escapeHtml, extOf, formatSize, diffOps, rankContextFiles, parseStamp, filterRuns, estimateRunCost, formatMoney };
});
