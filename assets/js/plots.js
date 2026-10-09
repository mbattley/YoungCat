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
    color: '', errors: true, highlight: true
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
    document.querySelectorAll('.preset').forEach(b => {
      const p = presets.find(q => q.id === b.dataset.id);
      b.setAttribute('aria-pressed', p.x === state.x && p.y === state.y);
    });
  }

  $('controls').addEventListener('change', e => {
    const t = e.target;
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

  $('download-plotted').addEventListener('click', () =>
    Y.downloadCSV(plotted, fields, `youngcat_${state.y}_vs_${state.x}.csv`));

  syncControls();
  $('status').hidden = true;
  $('plots').hidden = false;
  draw().then(() => {
    $('plot').on('plotly_click', ev => { const p = ev.points[0]; if (p) showPlanet(p.customdata[0]); });
  });
  window.addEventListener('yc-theme', () => draw());
  window.addEventListener('resize', Y.debounce(() => Y.renderAgeRuler($('age-ruler'), rows, { active: new Set(sampleRows().map(r => r.id)), selected }), 150));
})();
