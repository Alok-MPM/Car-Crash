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
  grass:    { color: [0.17, 0.3, 0.1] },
  grassDry: { color: [0.3, 0.33, 0.13] },
  soil:     { color: [0.27, 0.18, 0.1] },
  plough:   { color: [0.21, 0.13, 0.07] },
  wheat:    { color: [0.62, 0.5, 0.17] },
  paddy:    { color: [0.22, 0.42, 0.12] },
  mustard:  { color: [0.75, 0.62, 0.08] },
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
