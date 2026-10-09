(async function () {
  const C = window.YC_CONFIG, Y = window.YC;
  const $ = id => document.getElementById(id);
  Y.initTheme();

  const state = {
    rows: [], columns: [], fields: [],
    filters: Y.recall(Y.KEYS.filters, {}),
    search: Y.recall(Y.KEYS.search, ''),
    selected: new Set(Y.recall(Y.KEYS.selection, [])),
    sort: (C.defaultSort || []).map(s => ({ ...s })),
    page: 0,
    pageSize: 50,
    selectedOnly: false,
    visible: null,
    current: []        // filtered + sorted rows
  };

  let data;
  try {
    data = await Y.loadCatalogue();
  } catch (err) {
    $('status').innerHTML = `<p class="error">${Y.escapeHTML(err.message)} If you opened this file directly from disk, run a local server instead (see README).</p>`;
    return;
  }
  Object.assign(state, { rows: data.rows, columns: data.columns, fields: data.fields });
  state.sort = state.sort.filter(s => state.columns.some(c => c.key === s.key));

  // Drop selections for planets no longer in the CSV
  const ids = new Set(state.rows.map(r => r.id));
  state.selected = new Set([...state.selected].filter(id => ids.has(id)));

  const storedVisible = Y.recall(Y.KEYS.columns, null);
  state.visible = new Set(storedVisible
    ? storedVisible.filter(k => state.columns.some(c => c.key === k))
    : state.columns.filter(c => c.visible).map(c => c.key));

  const visibleCols = () => state.columns.filter(c => state.visible.has(c.key));
  const save = () => {
    Y.store(Y.KEYS.filters, state.filters);
    Y.store(Y.KEYS.search, state.search);
    Y.store(Y.KEYS.selection, [...state.selected]);
    Y.store(Y.KEYS.columns, [...state.visible]);
  };

  /* ---------- column picker ---------- */
  function buildColumnPicker() {
    $('column-list').innerHTML = state.columns.map(c => `
      <label class="check"><input type="checkbox" value="${Y.escapeHTML(c.key)}" ${state.visible.has(c.key) ? 'checked' : ''}>
      <span>${Y.escapeHTML(Y.columnTitle(c))}</span></label>`).join('');
    $('column-list').addEventListener('change', e => {
      if (e.target.type !== 'checkbox') return;
      e.target.checked ? state.visible.add(e.target.value) : state.visible.delete(e.target.value);
      if (!state.visible.size) { state.visible.add(e.target.value); e.target.checked = true; }
      save(); buildHeader(); update();
    });
  }

  /* ---------- table header with sort buttons and filter boxes ---------- */
  function buildHeader() {
    const cols = visibleCols();
    $('thead').innerHTML = `
      <tr class="head-labels">
        <th class="col-select" scope="col"><input type="checkbox" id="select-all" aria-label="Select every planet that matches the filters"></th>
        ${cols.map(c => `<th scope="col" class="${c.type === 'number' ? 'num' : ''}">
          <button type="button" class="sort-btn" data-key="${Y.escapeHTML(c.key)}" title="Sort. Shift-click to add a secondary sort.">
            <span>${Y.escapeHTML(c.label)}</span>${c.unit ? `<span class="unit">${Y.escapeHTML(c.unit)}</span>` : ''}<span class="sort-ind" aria-hidden="true"></span>
          </button></th>`).join('')}
      </tr>
      <tr class="head-filters">
        <th class="col-select"></th>
        ${cols.map(c => `<th><input type="text" class="filter" data-key="${Y.escapeHTML(c.key)}"
          value="${Y.escapeHTML(state.filters[c.key] || '')}" placeholder="${c.type === 'number' ? 'e.g. <50' : 'contains'}"
          aria-label="Filter ${Y.escapeHTML(c.label)}" spellcheck="false" autocomplete="off"></th>`).join('')}
      </tr>`;
  }

  $('thead').addEventListener('click', e => {
    const btn = e.target.closest('.sort-btn');
    if (!btn) return;
    toggleSort(btn.dataset.key, e.shiftKey);
    state.page = 0;
    update();
  });

  $('thead').addEventListener('input', Y.debounce(e => {
    if (!e.target.classList.contains('filter')) return;
    const v = e.target.value.trim();
    if (v) state.filters[e.target.dataset.key] = v; else delete state.filters[e.target.dataset.key];
    state.page = 0;
    save(); update();
  }, 200));

  $('thead').addEventListener('change', e => {
    if (e.target.id !== 'select-all') return;
    const all = state.current.every(r => state.selected.has(r.id));
    state.current.forEach(r => all ? state.selected.delete(r.id) : state.selected.add(r.id));
    save(); update();
  });

  function toggleSort(key, additive) {
    const i = state.sort.findIndex(s => s.key === key);
    if (!additive) {
      if (i === 0) {
        if (state.sort[0].dir === 'asc') state.sort[0].dir = 'desc';
        else state.sort = [];
      } else state.sort = [{ key, dir: 'asc' }];
    } else if (i < 0) state.sort.push({ key, dir: 'asc' });
    else if (state.sort[i].dir === 'asc') state.sort[i].dir = 'desc';
    else state.sort.splice(i, 1);
  }

  function sortRows(rows) {
    if (!state.sort.length) return rows;
    return rows.slice().sort((a, b) => {
      for (const s of state.sort) {
        const va = a.v[s.key], vb = b.v[s.key];
        if (va === null && vb === null) continue;
        if (va === null) return 1;          // missing values always sink to the bottom
        if (vb === null) return -1;
        const c = typeof va === 'number' ? va - vb : va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
        if (c) return s.dir === 'asc' ? c : -c;
      }
      return 0;
    });
  }

  /* ---------- body ---------- */
  function cellHTML(r, c) {
    const v = r.v[c.key];
    if (v === null) return '<span class="missing" aria-label="no value">–</span>';
    if (c.type === 'ref') {
      const href = r.link[c.key];
      return href ? `<a href="${Y.escapeHTML(href)}" target="_blank" rel="noopener">${Y.escapeHTML(v)}</a>` : Y.escapeHTML(v);
    }
    if (c.type !== 'number') return Y.escapeHTML(v);
    const l = r.lim[c.key];
    let html = (l === 1 ? '<span class="limit" title="Upper limit">&lt;&thinsp;</span>' : l === -1 ? '<span class="limit" title="Lower limit">&gt;&thinsp;</span>' : '') + Y.formatNumber(v, c);
    const e = r.e[c.key];
    if (e && !l) {
      const [up, lo] = e;
      if (up !== null && lo !== null && up === lo) {
        if (up > 0) html += `<span class="err">&thinsp;±${Y.formatNumber(up)}</span>`;
      } else if (up !== null || lo !== null) {
        html += `<span class="err err-asym"><span>+${up !== null ? Y.formatNumber(up) : '?'}</span><span>−${lo !== null ? Y.formatNumber(lo) : '?'}</span></span>`;
      }
    }
    return html;
  }

  function renderBody() {
    const cols = visibleCols();
    const n = state.current.length;
    const size = state.pageSize === 0 ? n || 1 : state.pageSize;
    const pages = Math.max(1, Math.ceil(n / size));
    state.page = Math.min(state.page, pages - 1);
    const pageRows = state.current.slice(state.page * size, state.page * size + size);

    if (!n) {
      $('tbody').innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty">
        No planets match these filters. Loosen a filter or <button type="button" class="link" data-action="clear-filters">clear all filters</button>.</td></tr>`;
    } else {
      $('tbody').innerHTML = pageRows.map(r => {
        const sel = state.selected.has(r.id);
        return `<tr class="${sel ? 'is-selected' : ''}" data-id="${Y.escapeHTML(r.id)}">
          <td class="col-select"><input type="checkbox" ${sel ? 'checked' : ''} aria-label="Select ${Y.escapeHTML(r.id)}"></td>
          ${cols.map(c => `<td class="${c.type === 'number' ? 'num' : ''}">${cellHTML(r, c)}</td>`).join('')}</tr>`;
      }).join('');
    }

    $('page-info').textContent = `Page ${state.page + 1} of ${pages}`;
    $('prev-page').disabled = state.page === 0;
    $('next-page').disabled = state.page >= pages - 1;
  }

  $('tbody').addEventListener('change', e => {
    if (e.target.type !== 'checkbox') return;
    const tr = e.target.closest('tr');
    const id = tr.dataset.id;
    e.target.checked ? state.selected.add(id) : state.selected.delete(id);
    tr.classList.toggle('is-selected', e.target.checked);
    save(); updateMeta();
    if (state.selectedOnly) update();
  });

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action="clear-filters"]');
    if (a) clearFilters();
  });

  /* ---------- toolbar ---------- */
  $('search').value = state.search;
  $('search').addEventListener('input', Y.debounce(e => { state.search = e.target.value; state.page = 0; save(); update(); }, 200));
  $('selected-only').addEventListener('change', e => { state.selectedOnly = e.target.checked; state.page = 0; update(); });
  $('clear-filters').addEventListener('click', clearFilters);
  $('clear-selection').addEventListener('click', () => { state.selected.clear(); save(); update(); });
  $('page-size').addEventListener('change', e => { state.pageSize = +e.target.value; state.page = 0; renderBody(); });
  $('prev-page').addEventListener('click', () => { state.page--; renderBody(); });
  $('next-page').addEventListener('click', () => { state.page++; renderBody(); });
  $('download-matching').addEventListener('click', () => Y.downloadCSV(state.current, state.fields, 'youngcat_matching.csv'));
  $('download-selected').addEventListener('click', () =>
    Y.downloadCSV(sortRows(state.rows.filter(r => state.selected.has(r.id))), state.fields, 'youngcat_selection.csv'));

  function clearFilters() {
    state.filters = {}; state.search = ''; $('search').value = '';
    document.querySelectorAll('.filter').forEach(i => { i.value = ''; });
    state.page = 0; save(); update();
  }

  /* ---------- update cycle ---------- */
  function updateMeta() {
    const nSel = state.selected.size;
    const nMatch = state.current.length;
    $('count').textContent = `${nMatch} of ${state.rows.length} planets shown. ${nSel} selected.`;
    $('download-matching').textContent = `Download shown (${nMatch})`;
    $('download-selected').textContent = `Download selected (${nSel})`;
    $('download-selected').disabled = nSel === 0;
    $('download-matching').disabled = nMatch === 0;
    $('clear-selection').disabled = nSel === 0;

    const all = $('select-all');
    if (all) {
      const inSel = state.current.filter(r => state.selected.has(r.id)).length;
      all.checked = nMatch > 0 && inSel === nMatch;
      all.indeterminate = inSel > 0 && inSel < nMatch;
    }
    Y.renderAgeRuler($('age-ruler'), state.rows, { active: new Set(state.current.map(r => r.id)), selected: state.selected });
  }

  function update() {
    const { invalid } = Y.compileFilters(state.columns, state.filters);
    document.querySelectorAll('.filter').forEach(i => {
      const bad = invalid.includes(i.dataset.key);
      i.classList.toggle('is-invalid', bad);
      i.setAttribute('aria-invalid', bad);
      i.title = bad ? 'Not a valid number filter. Try >10, <=3, 10..50 or *' : '';
    });

    let rows = Y.filterRows(state.rows, state.columns, state.filters, state.search);
    if (state.selectedOnly) rows = rows.filter(r => state.selected.has(r.id));
    state.current = sortRows(rows);

    document.querySelectorAll('.sort-btn').forEach(b => {
      const i = state.sort.findIndex(s => s.key === b.dataset.key);
      const th = b.closest('th');
      const ind = b.querySelector('.sort-ind');
      if (i < 0) { th.removeAttribute('aria-sort'); ind.textContent = ''; return; }
      const dir = state.sort[i].dir;
      th.setAttribute('aria-sort', i === 0 ? (dir === 'asc' ? 'ascending' : 'descending') : 'other');
      ind.textContent = (dir === 'asc' ? '▲' : '▼') + (state.sort.length > 1 ? i + 1 : '');
    });

    renderBody();
    updateMeta();
  }

  buildColumnPicker();
  buildHeader();
  update();
  $('status').hidden = true;
  $('catalogue').hidden = false;
  window.addEventListener('resize', Y.debounce(updateMeta, 150));
})();
