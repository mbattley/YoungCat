# YoungCat

A static website for a catalogue of young exoplanets. It runs entirely in the browser,
so it can be hosted for free on GitHub Pages with no server or build step.

- `index.html` is the catalogue: search, sort (shift-click for multi-column sorts), filter each
  column, tick planets to build a selection, and download either the filtered rows or the selection as CSV.
- `plots.html` plots any two numeric columns, with quick buttons for mass–radius, radius–age and
  mass–age. It can plot the whole catalogue, the rows matching the catalogue filters, or just the
  user's selection, and can colour points by a third parameter.

Filters and selections are kept in the visitor's browser, so they carry over between the two pages.

## Files

```
index.html              catalogue page
plots.html              plotting page
data/young_planets.csv  the catalogue (demo values for now; replace with yours)
assets/js/config.js     column names, labels, units, error columns, plot presets
assets/js/data.js       shared loading, filtering and formatting
assets/js/catalogue.js  table behaviour
assets/js/plots.js      plot behaviour (Plotly)
assets/css/style.css    styling, light and dark themes
```

## Updating the catalogue

1. Replace `data/young_planets.csv` with your file. Lines starting with `#` are ignored, so a
   NASA Exoplanet Archive export can be dropped in directly.
2. If your column names differ from the demo, edit `columns` in `assets/js/config.js`.
   Any column you don't list still loads and can be switched on from the Columns menu
   and chosen on the plots page.
3. Commit and push. The site updates within a minute or two.

## Publishing on GitHub Pages

1. Create a repository, e.g. `github.com/mbattley/youngcat`, and push these files to the `main` branch.
2. In the repository: Settings, then Pages. Under "Build and deployment" choose
   "Deploy from a branch", branch `main`, folder `/ (root)`, and save.
3. The site appears at `https://mbattley.github.io/youngcat/`.

## Running it locally

Browsers block loading the CSV from a page opened straight from disk, so serve the folder:

```
cd youngcat
python -m http.server 8000
```

then open http://localhost:8000.
