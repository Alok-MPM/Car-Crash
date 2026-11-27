// GEO: the shape of the Earth and the map projection used by the elevation tiles.
//   WGS-84 ellipsoid, geodesic distance (Vincenty), local frames (east / up / south metres round a point), and web-Mercator tile coordinates (the grid the height tiles live on).
export const D2R = Math.PI / 180;
export const A = 6378137, F = 1 / 298.257223563, B = A * (1 - F), E2 = F * (2 - F);

// ---- web-Mercator tile coordinates (fractional): x east 0..2^z, y south 0..2^z
export function toTile(lat, lon, z) {
  const n = 2 ** z, s = Math.sin(clampLat(lat) * D2R);
  return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}
export function fromTile(x, y, z) {
  const n = 2 ** z;
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / D2R, x / n * 360 - 180];
}
const clampLat = (l) => (l > 85.05112878 ? 85.05112878 : l < -85.05112878 ? -85.05112878 : l);
// ground metres per pixel of a 256 px tile at zoom z (sphere-based; the exact per-axis values are worked out in Terrain.setFrame)
export function mPerPixel(lat, z) { return 2 * Math.PI * A * Math.cos(lat * D2R) / (256 * 2 ** z); }

// ---- Earth-centred coordinates
export function toECEF(lat, lon, h = 0) {
  const sl = Math.sin(lat * D2R), cl = Math.cos(lat * D2R), N = A / Math.sqrt(1 - E2 * sl * sl);
  return [(N + h) * cl * Math.cos(lon * D2R), (N + h) * cl * Math.sin(lon * D2R), (N * (1 - E2) + h) * sl];
}

// ---- Vincenty inverse: geodesic distance in metres between two lat / lon points (also the initial bearing, degrees clockwise from north)
export function geoDist(lat1, lon1, lat2, lon2, withBearing) {
  const L = (lon2 - lon1) * D2R, U1 = Math.atan((1 - F) * Math.tan(lat1 * D2R)), U2 = Math.atan((1 - F) * Math.tan(lat2 * D2R));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, lamP, it = 0, sinSig, cosSig, sig, sinAlp, cos2Alp, cos2SigM;
  do {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    sinSig = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl);
    if (sinSig === 0) return withBearing ? { d: 0, brg: 0 } : 0;
    cosSig = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(sinSig, cosSig);
    sinAlp = cU1 * cU2 * sl / sinSig; cos2Alp = 1 - sinAlp * sinAlp;
    cos2SigM = cos2Alp !== 0 ? cosSig - 2 * sU1 * sU2 / cos2Alp : 0;
    const C = F / 16 * cos2Alp * (4 + F * (4 - 3 * cos2Alp));
    lamP = lam; lam = L + (1 - C) * F * sinAlp * (sig + C * sinSig * (cos2SigM + C * cosSig * (-1 + 2 * cos2SigM * cos2SigM)));
  } while (Math.abs(lam - lamP) > 1e-12 && ++it < 200);
  const u2 = cos2Alp * (A * A - B * B) / (B * B), K1 = (Math.sqrt(1 + u2) - 1) / (Math.sqrt(1 + u2) + 1);
  const A1 = (1 + K1 * K1 / 4) / (1 - K1), B1 = K1 * (1 - 3 * K1 * K1 / 8);
  const dSig = B1 * sinSig * (cos2SigM + B1 / 4 * (cosSig * (-1 + 2 * cos2SigM * cos2SigM) - B1 / 6 * cos2SigM * (-3 + 4 * sinSig * sinSig) * (-3 + 4 * cos2SigM * cos2SigM)));
  const d = B * A1 * (sig - dSig);
  if (!withBearing) return d;
  const brg = Math.atan2(cU2 * Math.sin(lam), cU1 * sU2 - sU1 * cU2 * Math.cos(lam)) / D2R;
  return { d, brg: (brg + 360) % 360 };
}

// ---- a local frame round (lat0, lon0): x east, y up (E0 m above sea level is y = 0), z south, in true ground metres.
//   East / north metres per degree come from the ellipsoid's curvature at lat0; they are exact to well under a metre over the ~12 km a frame is used for.
export class Frame {
  constructor(lat0, lon0, E0 = 0) {
    this.lat0 = lat0; this.lon0 = lon0; this.E0 = E0;
    const s = Math.sin(lat0 * D2R), den = Math.sqrt(1 - E2 * s * s), N = A / den, M = A * (1 - E2) / (den * den * den);
    this.mPerDegLat = M * D2R; this.mPerDegLon = N * Math.cos(lat0 * D2R) * D2R;
  }
  toLocal(lat, lon) { return [(lon - this.lon0) * this.mPerDegLon, -(lat - this.lat0) * this.mPerDegLat]; }
  toGeo(x, z) { return [this.lat0 - z / this.mPerDegLat, this.lon0 + x / this.mPerDegLon]; }
}
