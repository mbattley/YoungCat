(async function () {
  const C = window.YC_CONFIG, Y = window.YC;
  const $ = id => document.getElementById(id);
  Y.initTheme();

  if (!window.Plotly) {
    $('status').innerHTML = '<p class="error">The plotting library (Plotly) could not be loaded, so plots cannot be drawn. Check your connection or any content blocker, then reload the page.</p>';
    return;
  }

  let data;
  try {
    data = await Y.loadCatalogue();
  } catch (err) {
    $('status').innerHTML = `<p class="error">${Y.escapeHTML(err.message)} If you opened this file directly from disk, run a local server instead (see README).</p>`;
    return;
  }
  const { rows, columns, fields } = data;
  const numCols = columns.filter(c => c.type === 'number');
  const colBy = Object.fromEntries(columns.map(c => [c.key, c]));
  const selected = new Set(Y.recall(Y.KEYS.selection, []));
  const presets = C.plotPresets.filter(p => colBy[p.x] && colBy[p.y]);

  const first = presets[0] || { x: numCols[0]?.key, y: numCols[1]?.key };
  const defaults = {
    sample: 'all', x: first.x, y: first.y,
    logx: !!colBy[first.x]?.log, logy: !!colBy[first.y]?.log,
    color: '', errors: true, highlight: true, own: true
  };
  const state = { ...defaults, ...Y.recall(Y.KEYS.plot, {}) };
  if (!colBy[state.x]) state.x = defaults.x;
  if (!colBy[state.y]) state.y = defaults.y;
  if (state.color && !colBy[state.color]) state.color = '';

  /* ---------- controls ---------- */
  const options = numCols.map(c => `<option value="${Y.escapeHTML(c.key)}">${Y.escapeHTML(Y.columnTitle(c))}</option>`).join('');
  $('x-col').innerHTML = options;
  $('y-col').innerHTML = options;
  $('color-col').innerHTML = `<option value="">Single colour</option>${options}`;

  $('presets').innerHTML = presets.map(p =>
    `<button type="button" class="preset" data-id="${p.id}" aria-pressed="false">${Y.escapeHTML(p.label)}</button>`).join('');

  const filters = Y.recall(Y.KEYS.filters, {});
  const search = Y.recall(Y.KEYS.search, '');
  const nFiltered = Y.filterRows(rows, columns, filters, search).length;
  const hasFilters = Object.keys(filters).length > 0 || search.trim() !== '';
  $('sample-filtered-note').textContent = hasFilters ? `${nFiltered} planets` : 'no filters set';
  $('sample-selected-note').textContent = `${rows.filter(r => selected.has(r.id)).length} planets`;
  $('sample-all-note').textContent = `${rows.length} planets`;

  function syncControls() {
    document.querySelectorAll('input[name="sample"]').forEach(i => { i.checked = i.value === state.sample; });
    $('x-col').value = state.x;
    $('y-col').value = state.y;
    $('color-col').value = state.color;
    $('log-x').checked = state.logx;
    $('log-y').checked = state.logy;
    $('show-errors').checked = state.errors;
    $('highlight').checked = state.highlight;
    $('highlight').disabled = state.sample === 'selected';
    $('show-own').checked = state.own;
    document.querySelectorAll('.preset').forEach(b => {
      const p = presets.find(q => q.id === b.dataset.id);
      b.setAttribute('aria-pressed', p.x === state.x && p.y === state.y);
    });
  }

  $('controls').addEventListener('change', e => {
    const t = e.target;
    if (t.closest('#own-box') && t.id !== 'show-own') return;   // the entry form redraws on save
    if (t.id === 'show-own') state.own = t.checked;
    if (t.name === 'sample') state.sample = t.value;
    if (t.id === 'x-col') { state.x = t.value; state.logx = !!colBy[t.value].log; }
    if (t.id === 'y-col') { state.y = t.value; state.logy = !!colBy[t.value].log; }
    if (t.id === 'color-col') state.color = t.value;
    if (t.id === 'log-x') state.logx = t.checked;
    if (t.id === 'log-y') state.logy = t.checked;
    if (t.id === 'show-errors') state.errors = t.checked;
    if (t.id === 'highlight') state.highlight = t.checked;
    draw();
  });

  $('presets').addEventListener('click', e => {
    const b = e.target.closest('.preset');
    if (!b) return;
    const p = presets.find(q => q.id === b.dataset.id);
    Object.assign(state, { x: p.x, y: p.y, logx: !!colBy[p.x].log, logy: !!colBy[p.y].log });
    draw();
  });

  $('swap-axes').addEventListener('click', () => {
    [state.x, state.y, state.logx, state.logy] = [state.y, state.x, state.logy, state.logx];
    draw();
  });

  /* ---------- the user's own planets ----------
     Stored as [{ name, vals: { columnKey: { v, ep, em, lim } } }]. ep/em are the +/- errors (positive). */
  const esc = Y.escapeHTML;
  const isEntry = d => d && typeof d.v === 'number' && Number.isFinite(d.v);
  let own = Y.recall(Y.KEYS.own, [])
    .filter(p => p && typeof p.name === 'string' && p.name.trim() && p.vals && typeof p.vals === 'object')
    .map(p => ({ name: p.name.trim(), vals: Object.fromEntries(Object.entries(p.vals).filter(([k, d]) => colBy[k] && isEntry(d))) }));
  let draft = {}, editing = null;

  // Entering a radius or mass in one unit also places the planet on plots that use the other unit
  const LINKED = [['pl_rade', 'pl_radj', 11.2089], ['pl_bmasse', 'pl_bmassj', 317.828]];

  const optionFor = c => `<option value="${esc(c.key)}">${esc(Y.columnTitle(c))}</option>`;
  const mainCols = numCols.filter(c => !c.auto), extraCols = numCols.filter(c => c.auto);
  $('own-param').innerHTML = mainCols.map(optionFor).join('') +
    (extraCols.length ? `<optgroup label="Other catalogue columns">${extraCols.map(optionFor).join('')}</optgroup>` : '');

  function ownRow(p) {
    const v = {}, e = {}, lim = {}, from = {};
    columns.forEach(c => { v[c.key] = null; });
    Object.entries(p.vals).forEach(([k, d]) => {
      v[k] = d.v; e[k] = [d.ep ?? null, d.em ?? null];
      if (d.lim === 1 || d.lim === -1) lim[k] = d.lim;
    });
    const fill = (to, src, f) => {
      if (!colBy[to] || v[to] !== null || v[src] === null) return;
      v[to] = v[src] * f;
      e[to] = e[src].map(x => x === null ? null : x * f);
      if (lim[src]) lim[to] = lim[src];
      from[to] = src;
    };
    LINKED.forEach(([earth, jup, f]) => { fill(earth, jup, f); fill(jup, earth, 1 / f); });
    v[C.idColumn] = p.name;
    return { id: p.name, v, e, lim, from, link: {}, own: true };
  }

  function describe(d, c) {
    const pre = d.lim === 1 ? '< ' : d.lim === -1 ? '> ' : '';
    let err = '';
    if (!d.lim && (d.ep !== null || d.em !== null)) {
      err = d.ep === d.em ? ` ± ${Y.formatNumber(d.ep)}`
        : ` +${d.ep === null ? '?' : Y.formatNumber(d.ep)} / −${d.em === null ? '?' : Y.formatNumber(d.em)}`;
    }
    return pre + Y.formatNumber(d.v, c) + err + (c.unit ? ' ' + c.unit : '');
  }

  function ownMsg(text, isError) {
    $('own-msg').textContent = text;
    $('own-msg').classList.toggle('is-error', !!isError);
    return false;
  }

  // '' -> null, bad input -> NaN. Accepts typographic minus signs and a leading +.
  function readNum(id) {
    const s = $(id).value.trim().replace(/[−–]/g, '-').replace(/^\+/, '');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function loadEntry(key) {
    const d = draft[key];
    $('own-param').value = key;
    $('own-val').value = d ? d.v : '';
    $('own-errp').value = d && d.ep !== null ? d.ep : '';
    $('own-errm').value = d && d.em !== null && d.em !== d.ep ? d.em : '';
    $('own-lim').value = d ? String(d.lim || 0) : '0';
  }

  function renderDraft() {
    const key = $('own-param').value;
    $('own-draft').innerHTML = Object.entries(draft).map(([k, d]) => `
      <li${k === key ? ' class="is-editing"' : ''}><span class="grow">${esc(colBy[k].label)}: <span class="val">${esc(describe(d, colBy[k]))}</span></span>
        <button type="button" class="link" data-edit="${esc(k)}">Edit</button>
        <button type="button" class="link" data-drop="${esc(k)}" aria-label="Remove ${esc(colBy[k].label)}">Remove</button></li>`).join('');
    $('own-add-param').textContent = draft[key] ? 'Update this value' : 'Add this value';
    $('own-save').textContent = editing !== null ? 'Save changes' : 'Add planet to plots';
  }

  function addParam() {
    const key = $('own-param').value, c = colBy[key];
    const v = readNum('own-val'), ep = readNum('own-errp'), em = readNum('own-errm');
    if (v === null || Number.isNaN(v)) return ownMsg(`Enter a number for ${c.label.toLowerCase()}.`, true);
    if (Number.isNaN(ep) || Number.isNaN(em)) return ownMsg('Errors must be numbers, or left blank.', true);
    const up = ep !== null ? Math.abs(ep) : em !== null ? Math.abs(em) : null;
    const lo = em !== null ? Math.abs(em) : up;
    draft[key] = { v, ep: up, em: lo, lim: +$('own-lim').value || 0 };
    // Move on to the next parameter that has no value yet
    const next = numCols.find(q => !(q.key in draft) && numCols.indexOf(q) > numCols.indexOf(c)) || c;
    loadEntry(next.key);
    renderDraft();
    ownMsg('');
    $('own-param').focus();
    return true;
  }

  function resetOwnForm() {
    draft = {}; editing = null;
    $('own-name').value = '';
    loadEntry(numCols[0].key);
    renderDraft();
    ownMsg('');
  }

  function saveOwn() {
    const name = $('own-name').value.trim();
    if (!name) { $('own-name').focus(); return ownMsg('Give your planet a name first.', true); }
    if ($('own-val').value.trim() !== '' && !addParam()) return false;  // a value typed but not yet added
    if (!Object.keys(draft).length) return ownMsg('Add at least one value, e.g. its radius and its host star’s age.', true);
    const clash = own.findIndex(p => p.name === name);
    if (clash !== -1 && name !== editing) return ownMsg(`You already have a planet called ${name}. Edit it from the list below, or pick another name.`, true);
    const entry = { name, vals: draft };
    const at = editing !== null ? own.findIndex(p => p.name === editing) : -1;
    if (at !== -1) own[at] = entry; else own.push(entry);
    Y.store(Y.KEYS.own, own);
    state.own = true;
    resetOwnForm();
    renderSaved();
    ownMsg(`${name} is on the plot. Click its star for details.`);
    draw();
    return true;
  }

  function editOwn(name) {
    const p = own.find(q => q.name === name);
    if (!p) return;
    editing = name;
    draft = JSON.parse(JSON.stringify(p.vals));
    $('own-name').value = name;
    loadEntry(Object.keys(draft)[0] || numCols[0].key);
    renderDraft();
    ownMsg(`Editing ${name}. Change its values, then save.`);
    $('own-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('own-name').focus({ preventScroll: true });
  }

  function removeOwn(name) {
    own = own.filter(p => p.name !== name);
    Y.store(Y.KEYS.own, own);
    if (editing === name) resetOwnForm();
    if ($('planet-card').dataset.own === name) $('planet-card').hidden = true;
    renderSaved();
    draw();
  }

  function renderSaved() {
    $('own-saved-wrap').hidden = own.length === 0;
    $('own-saved').innerHTML = own.map(p => {
      const n = Object.keys(p.vals).length;
      return `<li><span class="own-star" aria-hidden="true">★</span><span class="grow"><b>${esc(p.name)}</b> <small class="unit">${n} value${n === 1 ? '' : 's'}</small></span>
        <button type="button" class="link" data-edit-planet="${esc(p.name)}">Edit</button>
        <button type="button" class="link" data-remove-planet="${esc(p.name)}" aria-label="Remove ${esc(p.name)}">Remove</button></li>`;
    }).join('');
  }

  $('own-param').addEventListener('change', () => { loadEntry($('own-param').value); renderDraft(); });
  $('own-add-param').addEventListener('click', addParam);
  $('own-save').addEventListener('click', saveOwn);
  $('own-clear').addEventListener('click', resetOwnForm);
  ['own-val', 'own-errp', 'own-errm'].forEach(id => $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addParam(); }
  }));
  $('own-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('own-val').focus(); } });
  $('own-draft').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.edit) { loadEntry(b.dataset.edit); renderDraft(); $('own-val').focus(); }
    if (b.dataset.drop) { delete draft[b.dataset.drop]; loadEntry($('own-param').value); renderDraft(); }
  });
  $('own-saved').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.editPlanet) editOwn(b.dataset.editPlanet);
    if (b.dataset.removePlanet) removeOwn(b.dataset.removePlanet);
  });

  resetOwnForm();
  renderSaved();

  /* ---------- sample + plotting ---------- */
  function sampleRows() {
    if (state.sample === 'filtered') return Y.filterRows(rows, columns, filters, search);
    if (state.sample === 'selected') return rows.filter(r => selected.has(r.id));
    return rows;
  }

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let plotted = [];

  function errorBars(pts, col) {
    if (!state.errors || col.err.length !== 2) return undefined;
    const up = pts.map(r => (r.e[col.key] && !r.lim[col.key]) ? r.e[col.key][0] : null);
    const lo = pts.map(r => (r.e[col.key] && !r.lim[col.key]) ? r.e[col.key][1] : null);
    if (!up.some(v => v !== null) && !lo.some(v => v !== null)) return undefined;
    return { type: 'data', symmetric: false, array: up, arrayminus: lo, color: css('--muted'), thickness: 1, width: 0 };
  }

  // Upper/lower limits are drawn as triangles pointing in the allowed direction
  function symbolFor(r, xc, yc) {
    const ly = r.lim[yc.key], lx = r.lim[xc.key];
    if (ly === 1) return 'triangle-down';
    if (ly === -1) return 'triangle-up';
    if (lx === 1) return 'triangle-left';
    if (lx === -1) return 'triangle-right';
    return 'circle';
  }

  function draw() {
    try {
      return drawPlot();
    } catch (err) {
      console.error(err);
      $('plot-status').innerHTML = `<span class="error">This plot could not be drawn: ${Y.escapeHTML(err.message)}</span>`;
      return Promise.resolve();
    }
  }

  function drawPlot() {
    syncControls();
    Y.store(Y.KEYS.plot, state);

    const xc = colBy[state.x], yc = colBy[state.y], cc = state.color ? colBy[state.color] : null;
    const sample = sampleRows();
    const ok = (v, log) => v !== null && (!log || v > 0);
    plotted = sample.filter(r => ok(r.v[xc.key], state.logx) && ok(r.v[yc.key], state.logy));
    const dropped = sample.length - plotted.length;

    const ink = css('--ink'), muted = css('--muted'), rule = css('--rule'), accent = css('--accent'), mark = css('--mark'), surface = css('--surface');
    const fmt = (r, c) => r.v[c.key] === null ? '–' : Y.formatValue(r, c);

    const traceFor = (pts, extra) => ({
      type: 'scatter', mode: 'markers',
      x: pts.map(r => r.v[xc.key]), y: pts.map(r => r.v[yc.key]),
      customdata: pts.map(r => [r.id, fmt(r, xc), fmt(r, yc), cc ? fmt(r, cc) : '']),
      hovertemplate: `<b>%{customdata[0]}</b><br>${Y.escapeHTML(xc.label)}: %{customdata[1]}<br>${Y.escapeHTML(yc.label)}: %{customdata[2]}` +
        (cc ? `<br>${Y.escapeHTML(cc.label)}: %{customdata[3]}` : '') + '<extra></extra>',
      error_x: errorBars(pts, xc), error_y: errorBars(pts, yc),
      ...extra
    });

    const traces = [];
    const marker = { size: 9, line: { width: 1, color: surface } };
    const sym = pts => pts.map(r => symbolFor(r, xc, yc));
    if (cc) {
      const withC = plotted.filter(r => r.v[cc.key] !== null && (!cc.log || r.v[cc.key] > 0));
      const without = plotted.filter(r => !withC.includes(r));
      const cvals = withC.map(r => cc.log ? Math.log10(r.v[cc.key]) : r.v[cc.key]);
      traces.push(traceFor(withC, {
        name: Y.columnTitle(cc), showlegend: false,
        marker: { ...marker, symbol: sym(withC), color: cvals, colorscale: 'Viridis',
          colorbar: { title: { text: (cc.log ? 'log₁₀ ' : '') + Y.columnTitle(cc), side: 'right' }, outlinewidth: 0, thickness: 12, tickfont: { color: muted } } }
      }));
      if (without.length) traces.push(traceFor(without, { name: `No ${cc.label.toLowerCase()} value`, marker: { ...marker, symbol: sym(without), color: muted, opacity: 0.6 } }));
    } else {
      traces.push(traceFor(plotted, { name: 'Planets', showlegend: false, marker: { ...marker, symbol: sym(plotted), color: accent } }));
    }

    const nLim = plotted.filter(r => symbolFor(r, xc, yc) !== 'circle').length;
    if (nLim) traces.push({ type: 'scatter', mode: 'markers', x: [null], y: [null], hoverinfo: 'skip',
      name: `Limit (${nLim})`, marker: { size: 9, symbol: 'triangle-down', color: muted } });

    if (state.highlight && state.sample !== 'selected') {
      const sel = plotted.filter(r => selected.has(r.id));
      if (sel.length) traces.push(traceFor(sel, {
        name: 'Your selection', error_x: undefined, error_y: undefined,
        marker: { size: 17, symbol: 'circle-open', line: { width: 2.5, color: mark } }
      }));
    }

    let ownShown = [], ownMissing = [];
    if (state.own && own.length) {
      const ownRows = own.map(ownRow);
      ownShown = ownRows.filter(r => ok(r.v[xc.key], state.logx) && ok(r.v[yc.key], state.logy));
      ownMissing = ownRows.filter(r => !ownShown.includes(r));
      const ownColor = css('--own');
      const ownErr = col => {
        if (!state.errors) return undefined;
        const up = ownShown.map(r => r.lim[col.key] ? null : (r.e[col.key] || [])[0] ?? null);
        const lo = ownShown.map(r => r.lim[col.key] ? null : (r.e[col.key] || [])[1] ?? null);
        if (!up.some(v => v !== null) && !lo.some(v => v !== null)) return undefined;
        return { type: 'data', symmetric: false, array: up, arrayminus: lo, color: ownColor, thickness: 1.5, width: 4 };
      };
      if (ownShown.length) traces.push({
        type: 'scatter', mode: 'markers+text', name: 'Your planets', showlegend: false, cliponaxis: false,
        x: ownShown.map(r => r.v[xc.key]), y: ownShown.map(r => r.v[yc.key]),
        text: ownShown.map(r => r.id), textposition: 'top center', textfont: { color: ownColor, size: 12 },
        customdata: ownShown.map(r => [r.id, fmt(r, xc), fmt(r, yc), '', 'own']),
        hovertemplate: `<b>%{customdata[0]}</b> (your planet)<br>${esc(xc.label)}: %{customdata[1]}<br>${esc(yc.label)}: %{customdata[2]}<extra></extra>`,
        error_x: ownErr(xc), error_y: ownErr(yc),
        marker: { size: 17, color: ownColor, line: { width: 1, color: surface },
          symbol: ownShown.map(r => { const s = symbolFor(r, xc, yc); return s === 'circle' ? 'star' : s; }) }
      });
      // Legend entry always shows a star, even if the planet itself is drawn as a limit triangle
      if (ownShown.length) traces.push({ type: 'scatter', mode: 'markers', x: [null], y: [null], hoverinfo: 'skip',
        name: 'Your planets', marker: { size: 13, symbol: 'star', color: ownColor } });
    }

    const axis = (col, log) => ({
      title: { text: Y.columnTitle(col), font: { size: 14, color: ink } },
      type: log ? 'log' : 'linear',
      gridcolor: rule, zerolinecolor: rule, linecolor: muted, tickcolor: muted, ticks: 'outside',
      tickfont: { color: muted }, mirror: true, showline: true, exponentformat: 'power'
    });

    const layout = {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: surface,
      font: { family: css('--font-ui'), color: ink, size: 13 },
      margin: { l: 70, r: 20, t: 20, b: 60 },
      xaxis: axis(xc, state.logx), yaxis: axis(yc, state.logy),
      legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { color: muted } },
      hoverlabel: { bgcolor: surface, bordercolor: rule, font: { color: ink, family: css('--font-ui') } },
      showlegend: true
    };

    const done = Plotly.react('plot', traces, layout, {
      responsive: true, displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
      toImageButtonOptions: { format: 'png', scale: 3, filename: `youngcat_${yc.key}_vs_${xc.key}` }
    });

    const plural = n => `${n} planet${n === 1 ? '' : 's'}`;
    let msg = `Showing ${plural(plotted.length)}.`;
    if (dropped) msg += ` ${plural(dropped)} left out for missing ${state.logx || state.logy ? 'or non-positive ' : ''}values.`;
    if (!sample.length) msg = state.sample === 'selected'
      ? 'Your selection is empty. Tick planets in the catalogue to build one.'
      : 'No planets match your catalogue filters. Adjust them in the catalogue.';
    if (ownShown.length) msg += ` Plus ${ownShown.length === 1 ? ownShown[0].id : ownShown.length + ' of your planets'}.`;
    if (ownMissing.length) {
      const why = r => [[xc, state.logx], [yc, state.logy]].filter(([c, log]) => !ok(r.v[c.key], log)).map(([c]) => c.label.toLowerCase()).join(' or ');
      msg += ` Not shown: ${ownMissing.map(r => `${r.id} (no ${why(r)} value)`).join(', ')}.`;
    }
    $('plot-status').textContent = msg;
    $('download-plotted').disabled = plotted.length === 0;

    Y.renderAgeRuler($('age-ruler'), rows, { active: new Set(sample.map(r => r.id)), selected });
    return done;
  }

  /* ---------- click a point to see its details ---------- */
  function showPlanet(id) {
    const r = rows.find(q => q.id === id);
    if (!r) return;
    const isSel = selected.has(id);
    $('planet-card').hidden = false;
    $('planet-card').classList.remove('is-own');
    delete $('planet-card').dataset.own;
    $('planet-card').innerHTML = `
      <h3>${Y.escapeHTML(r.id)}</h3>
      <dl>${columns.filter(c => r.v[c.key] !== null && c.key !== C.idColumn).map(c =>
        `<dt>${Y.escapeHTML(Y.columnTitle(c).replace(/ \[.*\]$/, ''))}</dt><dd>${c.type === 'ref' && r.link[c.key]
          ? `<a href="${Y.escapeHTML(r.link[c.key])}" target="_blank" rel="noopener">${Y.escapeHTML(r.v[c.key])}</a>`
          : Y.escapeHTML(Y.formatValue(r, c))}</dd>`).join('')}</dl>
      <button type="button" class="btn" id="toggle-planet">${isSel ? 'Remove from selection' : 'Add to selection'}</button>`;
    $('toggle-planet').addEventListener('click', () => {
      selected.has(id) ? selected.delete(id) : selected.add(id);
      Y.store(Y.KEYS.selection, [...selected]);
      $('sample-selected-note').textContent = `${rows.filter(q => selected.has(q.id)).length} planets`;
      showPlanet(id);
      draw();
    });
  }

  function showOwn(name) {
    const p = own.find(q => q.name === name);
    if (!p) return;
    const r = ownRow(p), card = $('planet-card');
    card.hidden = false;
    card.classList.add('is-own');
    card.dataset.own = name;
    const keys = numCols.filter(c => r.v[c.key] !== null).map(c => c.key);
    card.innerHTML = `
      <h3><span class="own-star" aria-hidden="true">★</span> ${esc(name)}</h3>
      <p class="note">Your planet, stored in this browser only.</p>
      <dl>${keys.map(k => {
        const c = colBy[k];
        const d = p.vals[k] || { v: r.v[k], ep: r.e[k][0], em: r.e[k][1], lim: r.lim[k] || 0 };
        const note = r.from[k] ? ` <span class="note">(from ${esc(colBy[r.from[k]].unit || colBy[r.from[k]].label)})</span>` : '';
        return `<dt>${esc(Y.columnTitle(c))}</dt><dd>${esc(describe(d, c))}${note}</dd>`;
      }).join('')}</dl>
      <div class="card-actions">
        <button type="button" class="btn" id="edit-own">Edit</button>
        <button type="button" class="btn" id="remove-own">Remove</button>
      </div>`;
    $('edit-own').addEventListener('click', () => editOwn(name));
    $('remove-own').addEventListener('click', () => removeOwn(name));
  }

  $('download-plotted').addEventListener('click', () =>
    Y.downloadCSV(plotted, fields, `youngcat_${state.y}_vs_${state.x}.csv`));

  syncControls();
  $('status').hidden = true;
  $('plots').hidden = false;
  draw().then(() => {
    $('plot').on('plotly_click', ev => {
      const p = ev.points[0];
      if (!p) return;
      p.customdata[4] === 'own' ? showOwn(p.customdata[0]) : showPlanet(p.customdata[0]);
    });
  });
  window.addEventListener('yc-theme', () => draw());
  window.addEventListener('resize', Y.debounce(() => Y.renderAgeRuler($('age-ruler'), rows, { active: new Set(sampleRows().map(r => r.id)), selected }), 150));
})();
