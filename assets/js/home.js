(async function () {
  const C = window.YC_CONFIG, Y = window.YC;
  Y.initTheme();

  // Contact links: email if set in config.js, otherwise GitHub issues
  const contact = C.contactEmail
    ? `mailto:${C.contactEmail}?subject=${encodeURIComponent('YoungCat / KYTTEN')}`
    : `${C.repoUrl}/issues`;
  document.querySelectorAll('[data-contact]').forEach(a => {
    a.href = contact;
    if (!C.contactEmail) { a.target = '_blank'; a.rel = 'noopener'; }
  });

  let data;
  try {
    data = await Y.loadCatalogue();
  } catch (err) {
    console.error(err);
    return;   // the page still reads fine without the ruler
  }
  const { rows } = data;
  const planets = new Set(rows.map(r => r.raw[C.idColumn])).size;
  const hosts = new Set(rows.map(r => r.v.hostname).filter(Boolean)).size;

  const draw = () => Y.renderAgeRuler(document.getElementById('age-ruler'), rows);
  draw();
  document.getElementById('ruler-caption').textContent =
    `Each mark is one of the ${planets} planets in the catalogue, around ${hosts} host stars, placed by the age of its host star.`;
  window.addEventListener('resize', Y.debounce(draw, 150));
})();
