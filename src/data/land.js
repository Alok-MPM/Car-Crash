// LAND CATALOG - one table family for roads, ground cover, trees and parking. The city generator only READS these rows;
// change a row here (width, colour, lines) and every road / field / tree in the game follows.
// widths in metres, colours are linear-ish display colours (r,g,b 0..1)

export const ROADS = {
  highway:    { name: 'Highway',      w: 26, lanes: 3, median: 2.2, shoulder: 2.0, color: [0.075, 0.075, 0.08], edge: 'solid', centre: 'median', dash: 'white', speed: 120, curb: false },
  expressway: { name: 'Expressway',   w: 18, lanes: 2, median: 1.0, shoulder: 1.5, color: [0.08, 0.08, 0.085],  edge: 'solid', centre: 'double', dash: 'white', speed: 100, curb: false },
  city:       { name: 'City road',    w: 12, lanes: 1, median: 0,   shoulder: 0,   color: [0.1, 0.1, 0.105],    edge: 'solid', centre: 'dash',   dash: 'white', speed: 50,  curb: true, footpath: 2.2 },
  bazaar:     { name: 'Bazaar road',  w: 11, lanes: 1, median: 0,   shoulder: 0,   color: [0.12, 0.115, 0.11],  edge: 'none',  centre: 'none',   dash: null,    speed: 30,  curb: true, footpath: 2.0 },
  gali:       { name: 'Gali (lane)',  w: 5,  lanes: 1, median: 0,   shoulder: 0,   color: [0.2, 0.19, 0.17],    edge: 'none',  centre: 'none',   dash: null,    speed: 15,  curb: false },
  village:    { name: 'Village road', w: 6,  lanes: 1, median: 0,   shoulder: 0.6, color: [0.2, 0.19, 0.17],    edge: 'none',  centre: 'none',   dash: null,    speed: 30,  curb: false },
  offroad:    { name: 'Dirt track',   w: 4,  lanes: 1, median: 0,   shoulder: 0,   color: [0.28, 0.2, 0.12],    edge: 'none',  centre: 'none',   dash: null,    speed: 20,  curb: false },
};

export const GROUND = {
  grass:    { color: [0.11, 0.23, 0.065] },
  grassDry: { color: [0.2, 0.2, 0.085] },
  soil:     { color: [0.19, 0.115, 0.065] },
  plough:   { color: [0.15, 0.09, 0.05] },
  wheat:    { color: [0.44, 0.35, 0.1] },
  paddy:    { color: [0.13, 0.29, 0.07] },
  mustard:  { color: [0.55, 0.42, 0.04] },
  embank:   { color: [0.2, 0.135, 0.08] },
  water:    { color: [0.1, 0.22, 0.3] },
  chowk:    { color: [0.5, 0.43, 0.34] },
  paver:    { color: [0.36, 0.34, 0.31] },
  footpath: { color: [0.42, 0.4, 0.37] },
  curb:     { color: [0.55, 0.54, 0.5] },
  white:    { color: [0.82, 0.82, 0.8] },
  yellow:   { color: [0.85, 0.6, 0.05] },
};

export const CROPS = ['wheat', 'paddy', 'mustard', 'plough'];

export const TREES = {
  neem:    { kind: 'broad',  h: [5, 8],   crown: [2.2, 3.4], trunk: 0.22, leaf: [[0.13, 0.28, 0.08], [0.16, 0.32, 0.1]] },
  mango:   { kind: 'broad',  h: [6, 9],   crown: [2.8, 3.8], trunk: 0.28, leaf: [[0.1, 0.24, 0.07], [0.12, 0.27, 0.08]] },
  ashoka:  { kind: 'conifer', h: [6, 10], crown: [1.2, 1.8], trunk: 0.18, leaf: [[0.1, 0.26, 0.09], [0.12, 0.3, 0.1]] },
  babool:  { kind: 'broad',  h: [3.5, 5], crown: [1.6, 2.4], trunk: 0.15, leaf: [[0.3, 0.34, 0.12], [0.26, 0.3, 0.1]] },
};
export const TREE_SETS = { street: ['neem', 'ashoka', 'neem'], park: ['mango', 'neem', 'ashoka'], farm: ['mango', 'babool', 'neem'], village: ['neem', 'mango', 'neem', 'ashoka'], forest: ['neem', 'mango', 'ashoka', 'babool'] };

// parking pad beside a house: bays, paver colour
export const PARKING = { bayW: 2.7, bayD: 5.2, apron: 1.0 };


// ROAD STRUCTURE - every road is a stack of real layers (top-down). Thickness in metres, after IRC 37 flexible-pavement practice
// (BC 40 mm, DBM 50-100 mm, WMM 150-250 mm, GSB 150-300 mm, compacted subgrade). The surface that you see is the top layer; when something digs
// into the road (blast, crash, pothole) the engine reveals the layers below it in order, using the colours here.
export const LAYERS = {
  bc:       { name: 'Bituminous concrete (wearing course)', color: [0.05, 0.05, 0.055], rough: 0.85 },
  dbm:      { name: 'Dense bituminous macadam (binder)',    color: [0.075, 0.07, 0.07], rough: 0.9 },
  wmm:      { name: 'Wet-mix macadam (base, crushed stone)', color: [0.36, 0.35, 0.33],  rough: 1 },
  gsb:      { name: 'Granular sub-base (gravel, murrum)',   color: [0.4, 0.31, 0.2],    rough: 1 },
  subgrade: { name: 'Compacted subgrade soil',              color: [0.22, 0.14, 0.08],  rough: 1 },
  tar:      { name: 'Tar surface dressing',                 color: [0.11, 0.105, 0.1],  rough: 0.95 },
  moorum:   { name: 'Moorum / WBM base',                    color: [0.42, 0.3, 0.19],   rough: 1 },
  gravel:   { name: 'Gravel wearing layer',                 color: [0.4, 0.34, 0.26],   rough: 1 },
  concrete: { name: 'Cement concrete (PQC)',                color: [0.5, 0.49, 0.46],   rough: 0.85 },
};
export const ROAD_LAYERS = {
  highway:    [['bc', 0.04], ['dbm', 0.1], ['wmm', 0.25], ['gsb', 0.3], ['subgrade', 0.5]],
  expressway: [['bc', 0.04], ['dbm', 0.09], ['wmm', 0.25], ['gsb', 0.25], ['subgrade', 0.5]],
  city:       [['bc', 0.04], ['dbm', 0.07], ['wmm', 0.2], ['gsb', 0.2], ['subgrade', 0.4]],
  bazaar:     [['concrete', 0.2], ['gsb', 0.2], ['subgrade', 0.4]],
  gali:       [['concrete', 0.15], ['moorum', 0.15], ['subgrade', 0.3]],
  village:    [['tar', 0.025], ['moorum', 0.15], ['subgrade', 0.3]],
  offroad:    [['gravel', 0.1], ['moorum', 0.15], ['subgrade', 0.3]],
};
// asphalt shade per road type (kind-4 shader multiplies its procedural tarmac by this)
export const ASPHALT_TINT = { highway: 0.8, expressway: 0.85, city: 1.0, bazaar: 1.25, gali: 1.5, village: 1.45 };
// roadside furniture by type
export const FURNITURE = {
  highway:    { barrier: true, lights: 'median', lightEvery: 42, sign: 380, medianKerb: true, shrubs: true },
  expressway: { barrier: true, lights: 'median', lightEvery: 48, sign: 420, medianKerb: true, shrubs: true },
  city:       { lights: 'side', lightEvery: 34, kerb: true },
  bazaar:     { lights: 'side', lightEvery: 28, kerb: true },
};
