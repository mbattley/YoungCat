/* Shared helpers used by both the catalogue and the plots page. */
(function () {
  const C = window.YC_CONFIG;

  const KEYS = {
    selection: 'youngcat:selection',
    filters: 'youngcat:filters',
    search: 'youngcat:search',
    columns: 'youngcat:columns',
    plot: 'youngcat:plot',
    theme: 'youngcat:theme'
  };

  /* ---------- local storage (shares state between the two pages) ---------- */
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }
  function recall(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }

  /* ---------- parsing ---------- */
  function toNumber(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (s === '' || /^nan$/i.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  function toText(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  }

  function isExcluded(f) {
    return (C.excludeColumns || []).some(x => x instanceof RegExp ? x.test(f) : x === f);
  }

  function buildColumns(fields, rawRows) {
    const present = new Set(fields);
    const helperKeys = new Set();
    C.columns.forEach(c => { (c.err || []).forEach(k => helperKeys.add(k)); if (c.lim) helperKeys.add(c.lim); });

    // PapaParse renames repeated headers to name_1, name_2…; treat those as duplicates and drop them
    const duplicates = fields.filter(f => { const m = f.match(/^(.*)_(\d+)$/); return m && present.has(m[1]); });
    if (duplicates.length) console.warn('YoungCat: ignoring duplicate CSV columns:', duplicates.join(', '));

    const missing = C.columns.filter(c => !present.has(c.key)).map(c => c.key);
    if (missing.length) console.warn('YoungCat: columns in config.js but not in the CSV:', missing.join(', '));

    const cols = C.columns
      .filter(c => present.has(c.key))
      .map(c => ({
        visible: true, ...c,
        err: (c.err || []).every(k => present.has(k)) ? (c.err || []) : [],
        lim: c.lim && present.has(c.lim) ? c.lim : null
      }));

    const known = new Set(cols.map(c => c.key));
    fields.forEach(f => {
      if (!f || known.has(f) || helperKeys.has(f) || duplicates.includes(f) || isExcluded(f)) return;
      const vals = rawRows.map(r => r[f]).filter(v => toText(v) !== null);
      const numeric = vals.length > 0 && vals.every(v => toNumber(v) !== null);
      cols.push({ key: f, label: f, type: numeric ? 'number' : 'string', err: [], lim: null, visible: false, auto: true });
    });
    return cols;
  }

  // "<a refstr=X href=https://… target=ref>Smith et al. 2024</a>" -> text + safe link
  function parseRef(s) {
    const t = toText(s);
    if (t === null) return { text: null, href: null };
    const m = t.match(/href\s*=\s*["']?([^"'\s>]+)/i);
    const href = m && /^https?:\/\//i.test(m[1]) ? m[1] : null;
    const text = t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return { text: text || null, href };
  }

  function buildFromParse(fields, rawRows) {
    const required = (C.requiredColumns || []).filter(k => fields.includes(k));
    const kept = rawRows.filter(raw => required.every(k => toText(raw[k]) !== null));
    if (kept.length < rawRows.length) console.info(`YoungCat: skipped ${rawRows.length - kept.length} row(s) missing ${required.join(', ')}`);

    const columns = buildColumns(fields, kept);
    const seen = new Map();
    const rows = kept.map((raw, i) => {
      const v = {}, e = {}, lim = {}, link = {};
      columns.forEach(c => {
        if (c.type === 'number') v[c.key] = toNumber(raw[c.key]);
        else if (c.type === 'ref') { const r = parseRef(raw[c.key]); v[c.key] = r.text; link[c.key] = r.href; }
        else {
          let t = toText(raw[c.key]);
          if (t !== null && c.map) { const n = toNumber(t); const k = n !== null ? String(n) : t; if (k in c.map) t = c.map[k]; }
          v[c.key] = t;
        }
        if (c.err.length === 2) {
          const sc = c.errScale || 1;
          const up = toNumber(raw[c.err[0]]), lo = toNumber(raw[c.err[1]]);
          e[c.key] = [up === null ? null : Math.abs(up) * sc, lo === null ? null : Math.abs(lo) * sc];
        }
        if (c.lim) { const l = toNumber(raw[c.lim]); if (l === 1 || l === -1) lim[c.key] = l; }
      });
      let id = toText(raw[C.idColumn]) || `row-${i + 1}`;
      if (seen.has(id)) { seen.set(id, seen.get(id) + 1); id = `${id} (${seen.get(id)})`; } else seen.set(id, 1);
      return { id, raw, v, e, lim, link };
    });
    return { fields, columns, rows };
  }

  function loadCatalogue() {
    return new Promise((resolve, reject) => {
      Papa.parse(C.csvPath, {
        download: true,
        header: true,
        comments: '#',
        skipEmptyLines: 'greedy',
        transformHeader: h => h.trim(),
        complete: res => {
          const fields = (res.meta.fields || []).filter(Boolean);
          if (!fields.length) { reject(new Error(`${C.csvPath} has no header row.`)); return; }
          resolve(buildFromParse(fields, res.data));
        },
        error: err => reject(new Error(`Could not load ${C.csvPath}: ${err.message || err}`))
      });
    });
  }

  /* ---------- filtering ----------
     Numbers:  >10   <=3.5   =4   !=4   10..50   *  (has a value)   !*  (missing)
     Text:     contains (case-insensitive)   !text (does not contain)   *   !*            */
  const INVALID = 'invalid';

  function makePredicate(expr, type) {
    const e = (expr || '').trim();
    if (!e) return null;
    if (e === '*') return v => v !== null;
    if (e === '!*') return v => v === null;

    if (type === 'number') {
      const num = '(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?)';
      let m = e.match(new RegExp(`^${num}\\s*\\.\\.\\s*${num}$`, 'i'));
      if (m) {
        const lo = Math.min(+m[1], +m[2]), hi = Math.max(+m[1], +m[2]);
        return v => v !== null && v >= lo && v <= hi;
      }
      m = e.match(new RegExp(`^(>=|<=|!=|>|<|=)?\\s*${num}$`, 'i'));
      if (m) {
        const t = +m[2];
        switch (m[1] || '=') {
          case '>': return v => v !== null && v > t;
          case '<': return v => v !== null && v < t;
          case '>=': return v => v !== null && v >= t;
          case '<=': return v => v !== null && v <= t;
          case '!=': return v => v !== null && v !== t;
          default: return v => v !== null && v === t;
        }
      }
      return INVALID;
    }

    const negate = e.startsWith('!');
    const term = (negate ? e.slice(1) : e).toLowerCase();
    return v => {
      const hit = v !== null && v.toLowerCase().includes(term);
      return negate ? !hit : hit;
    };
  }

  function compileFilters(columns, filters) {
    const preds = [], invalid = [];
    columns.forEach(c => {
      const p = makePredicate(filters[c.key], c.type);
      if (p === INVALID) invalid.push(c.key);
      else if (p) preds.push([c.key, p]);
    });
    return { preds, invalid };
  }

  function filterRows(rows, columns, filters, search) {
    const { preds } = compileFilters(columns, filters || {});
    const q = (search || '').trim().toLowerCase();
    const textKeys = columns.filter(c => c.type !== 'number').map(c => c.key);
    return rows.filter(r => {
      for (const [k, p] of preds) if (!p(r.v[k])) return false;
      if (q && !textKeys.some(k => r.v[k] !== null && r.v[k].toLowerCase().includes(q))) return false;
      return true;
    });
  }

  /* ---------- formatting & export ---------- */
  function formatNumber(v, col) {
    if (v === null || v === undefined) return '';
    if (col && col.integer) return String(Math.round(v));
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
    return String(parseFloat(v.toPrecision(4)));
  }

  function formatValue(r, c) {
    const v = r.v[c.key];
    if (v === null) return '';
    if (c.type !== 'number') return v;
    const p = r.lim[c.key] === 1 ? '< ' : r.lim[c.key] === -1 ? '> ' : '';
    return p + formatNumber(v, c) + (c.unit ? ' ' + c.unit : '');
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function columnTitle(col) {
    return col.unit ? `${col.label} [${col.unit}]` : col.label;
  }

  function downloadCSV(rows, fields, filename) {
    const out = fields.filter(f => !/^(.*)_(\d+)$/.test(f) || !fields.includes(f.replace(/_\d+$/, '')));
    const csv = Papa.unparse({ fields: out, data: rows.map(r => out.map(f => (r.raw[f] ?? ''))) });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- the age ruler in the header ----------
     Every planet is one mark on a log age axis. `active` = ids in the current sample,
     `selected` = ids in the user's selection. */
  function renderAgeRuler(host, rows, opts = {}) {
    if (!host) return;
    const key = C.ageColumn;
    const pts = rows.filter(r => r.v[key] !== null && r.v[key] > 0);
    if (!pts.length) { host.innerHTML = ''; return; }

    const ages = pts.map(r => r.v[key]);
    const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...ages))));
    const hi = Math.max(...ages) * 1.25;
    const W = Math.max(host.clientWidth, 280), H = 64, pad = 8;
    const x = a => pad + (Math.log10(a) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * (W - 2 * pad);
    const fmtAge = a => (C.ageUnit === 'Myr' && a >= 1000) ? `${a / 1000} Gyr` : `${a} ${C.ageUnit}`;

    const active = opts.active, selected = opts.selected || new Set();
    const marks = pts
      .slice()
      .sort((a, b) => (selected.has(a.id) ? 1 : 0) - (selected.has(b.id) ? 1 : 0))
      .map(r => {
        const cls = ['ruler-mark'];
        if (active && !active.has(r.id)) cls.push('is-out');
        if (selected.has(r.id)) cls.push('is-selected');
        const xi = x(r.v[key]).toFixed(1);
        return `<line class="${cls.join(' ')}" x1="${xi}" x2="${xi}" y1="6" y2="36"><title>${escapeHTML(r.id)}: ${formatNumber(r.v[key])} ${C.ageUnit}</title></line>`;
      }).join('');

    let ticks = '';
    for (let d = lo; d <= hi; d *= 10) {
      const xi = x(d).toFixed(1);
      const anchor = d === lo ? 'start' : (x(d) > W - 40 ? 'end' : 'middle');
      ticks += `<line class="ruler-tick" x1="${xi}" x2="${xi}" y1="40" y2="45"/><text class="ruler-label" x="${xi}" y="60" text-anchor="${anchor}">${fmtAge(Math.round(d * 1000) / 1000)}</text>`;
    }

    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Host star ages of ${pts.length} planets on a logarithmic axis">
      <line class="ruler-axis" x1="${pad}" x2="${W - pad}" y1="40" y2="40"/>${ticks}${marks}</svg>`;
  }

  /* ---------- light / dark toggle ---------- */
  function initTheme() {
    const btn = document.getElementById('theme-toggle');
    const apply = t => {
      if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
      else document.documentElement.removeAttribute('data-theme');
      if (btn) btn.textContent = t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'Auto';
      window.dispatchEvent(new Event('yc-theme'));
    };
    let current = recall(KEYS.theme, 'auto');
    apply(current);
    if (btn) btn.addEventListener('click', () => {
      current = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
      store(KEYS.theme, current);
      apply(current);
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => window.dispatchEvent(new Event('yc-theme')));
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  window.YC = {
    KEYS, store, recall, toNumber, buildFromParse, loadCatalogue, makePredicate, compileFilters,
    filterRows, formatNumber, formatValue, parseRef, escapeHTML, columnTitle, downloadCSV, renderAgeRuler, initTheme, debounce, INVALID
  };
})();
