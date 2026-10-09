/*
  YoungCat configuration — the only file you should need to edit when your CSV changes.

  columns: the order here is the order shown in the table.
    key       CSV column name
    label     human-readable name
    unit      shown in headers and axis titles
    type      'number', 'string', or 'ref' (an HTML <a href> link, shown as a clickable reference)
    err       [upperErrColumn, lowerErrColumn] (NASA archive style: err2 is negative)
    errScale  multiply the error columns by this (e.g. Gyr errors on a Myr value)
    lim       limit-flag column: 1 = upper limit, -1 = lower limit (shown as < or >, and as triangles on plots)
    map       relabel raw values, e.g. { '1': 'Yes', '0': 'No' }
    log       default to a log axis when plotted
    integer   format without decimals
    visible   false = hidden in the table by default (users can switch it on from the Columns menu)

  Any CSV column not listed here, not used as an error/limit column and not excluded below is still
  loaded: it appears in the column picker and plot menus, with its type guessed from the data.
*/
window.YC_CONFIG = {
  siteName: 'YoungCat',

  // Used on the About page. Leave contactEmail empty to send people to GitHub issues instead.
  contactEmail: 'matbatt@gmail.com',
  repoUrl: 'https://github.com/mbattley/YoungCat',
  csvPath: 'data/young_planets.csv',
  idColumn: 'pl_name',
  ageColumn: 'st_age_Myr',   // drives the age ruler in the header
  ageUnit: 'Myr',

  // Rows with no value in these columns are skipped (e.g. section-divider rows).
  requiredColumns: ['hostname'],

  // Columns never shown. Duplicate headers (renamed name_1, name_2…) are dropped automatically.
  excludeColumns: ['default_flag', 'st_age', /lim$/],

  defaultSort: [{ key: 'st_age_Myr', dir: 'asc' }],

  columns: [
    // Shown by default
    { key: 'pl_name',         label: 'Planet',           type: 'string' },
    { key: 'hostname',        label: 'Host star',        type: 'string' },
    { key: 'st_age_Myr',      label: 'Age',              unit: 'Myr', type: 'number', err: ['st_ageerr1', 'st_ageerr2'], errScale: 1000, log: true },
    { key: 'Environment',     label: 'Environment',      type: 'string' },
    { key: 'Known_cluster',   label: 'Cluster / group',  type: 'string' },
    { key: 'pl_orbper',       label: 'Orbital period',   unit: 'd',   type: 'number', err: ['pl_orbpererr1', 'pl_orbpererr2'], lim: 'pl_orbperlim', log: true },
    { key: 'pl_rade',         label: 'Radius',           unit: 'R⊕',  type: 'number', err: ['pl_radeerr1', 'pl_radeerr2'], lim: 'pl_radjlim', log: true },
    { key: 'pl_bmasse',       label: 'Mass',             unit: 'M⊕',  type: 'number', err: ['pl_bmasseerr1', 'pl_bmasseerr2'], lim: 'pl_bmassjlim', log: true },
    { key: 'pl_bmassprov',    label: 'Mass type',        type: 'string' },
    { key: 'pl_eqt',          label: 'Equilibrium temp', unit: 'K',   type: 'number', err: ['pl_eqterr1', 'pl_eqterr2'], lim: 'pl_eqtlim' },
    { key: 'st_teff',         label: 'Stellar Teff',     unit: 'K',   type: 'number', err: ['st_tefferr1', 'st_tefferr2'], lim: 'st_tefflim' },
    { key: 'st_mass',         label: 'Stellar mass',     unit: 'M☉',  type: 'number', err: ['st_masserr1', 'st_masserr2'], lim: 'st_masslim' },
    { key: 'discoverymethod', label: 'Discovery method', type: 'string' },
    { key: 'disc_year',       label: 'Year',             type: 'number', integer: true },
    { key: 'pl_refname',      label: 'Reference',        type: 'ref' },

    // Available from the Columns menu
    { key: 'Luke_Kepler_flag', label: 'Kepler sample',   type: 'string', map: { '1': 'Yes', '0': 'No' }, visible: false },
    { key: 'st_age_upper',    label: 'Age upper bound',  unit: 'Gyr', type: 'number', visible: false },
    { key: 'pl_orbsmax',      label: 'Semi-major axis',  unit: 'au',  type: 'number', err: ['pl_orbsmaxerr1', 'pl_orbsmaxerr2'], lim: 'pl_orbsmaxlim', log: true, visible: false },
    { key: 'pl_orbeccen',     label: 'Eccentricity',     type: 'number', err: ['pl_orbeccenerr1', 'pl_orbeccenerr2'], lim: 'pl_orbeccenlim', visible: false },
    { key: 'pl_radj',         label: 'Radius',           unit: 'RJ',  type: 'number', err: ['pl_radjerr1', 'pl_radjerr2'], lim: 'pl_radjlim', log: true, visible: false },
    { key: 'pl_bmassj',       label: 'Mass',             unit: 'MJ',  type: 'number', err: ['pl_bmassjerr1', 'pl_bmassjerr2'], lim: 'pl_bmassjlim', log: true, visible: false },
    { key: 'pl_insol',        label: 'Insolation',       unit: 'S⊕',  type: 'number', err: ['pl_insolerr1', 'pl_insolerr2'], lim: 'pl_insollim', log: true, visible: false },
    { key: 'pl_rad_percent',  label: 'Radius precision', unit: '%',   type: 'number', visible: false },
    { key: 'pl_mass_percent', label: 'Mass precision',   unit: '%',   type: 'number', visible: false },
    { key: 'ttv_flag',        label: 'TTVs',             type: 'string', map: { '1': 'Yes', '0': 'No' }, visible: false },
    { key: 'pl_controv_flag', label: 'Controversial',    type: 'string', map: { '1': 'Yes', '0': 'No' }, visible: false },
    { key: 'st_spectype',     label: 'Spectral type',    type: 'string', visible: false },
    { key: 'st_rad',          label: 'Stellar radius',   unit: 'R☉',  type: 'number', err: ['st_raderr1', 'st_raderr2'], lim: 'st_radlim', visible: false },
    { key: 'st_met',          label: 'Metallicity',      unit: 'dex', type: 'number', err: ['st_meterr1', 'st_meterr2'], lim: 'st_metlim', visible: false },
    { key: 'st_logg',         label: 'log g',            unit: 'cgs', type: 'number', err: ['st_loggerr1', 'st_loggerr2'], lim: 'st_logglim', visible: false },
    { key: 'sy_dist',         label: 'Distance',         unit: 'pc',  type: 'number', err: ['sy_disterr1', 'sy_disterr2'], log: true, visible: false },
    { key: 'sy_vmag',         label: 'V mag',            type: 'number', err: ['sy_vmagerr1', 'sy_vmagerr2'], visible: false },
    { key: 'sy_kmag',         label: 'K mag',            type: 'number', err: ['sy_kmagerr1', 'sy_kmagerr2'], visible: false },
    { key: 'sy_gaiamag',      label: 'Gaia G mag',       type: 'number', err: ['sy_gaiamagerr1', 'sy_gaiamagerr2'], visible: false },
    { key: 'ra',              label: 'RA',               unit: 'deg', type: 'number', visible: false },
    { key: 'dec',             label: 'Dec',              unit: 'deg', type: 'number', visible: false },
    { key: 'sy_snum',         label: 'Stars in system',  type: 'number', integer: true, visible: false },
    { key: 'sy_pnum',         label: 'Planets in system', type: 'number', integer: true, visible: false },
    { key: 'disc_facility',   label: 'Discovery facility', type: 'string', visible: false },
    { key: 'st_refname',      label: 'Stellar reference', type: 'ref', visible: false },
    { key: 'sy_refname',      label: 'System reference', type: 'ref', visible: false }
  ],

  plotPresets: [
    { id: 'mass-radius',   label: 'Mass vs radius',   x: 'pl_bmasse',  y: 'pl_rade' },
    { id: 'radius-age',    label: 'Radius vs age',    x: 'st_age_Myr', y: 'pl_rade' },
    { id: 'mass-age',      label: 'Mass vs age',      x: 'st_age_Myr', y: 'pl_bmasse' },
    { id: 'radius-period', label: 'Radius vs period', x: 'pl_orbper',  y: 'pl_rade' }
  ]
};
