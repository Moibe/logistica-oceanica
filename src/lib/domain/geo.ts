// Spherical geometry shared by all three map renderers. Everything here is
// pure math on [lon, lat] degree pairs — no rendering concepts leak in, so the
// canvas projection, the Three.js globe and MapLibre all consume the exact
// same numbers and show the exact same fleet in the exact same place.

export type LonLat = [lon: number, lat: number];

export const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

/** Unit vector on the sphere for a [lon, lat] pair. */
function toCartesian([lon, lat]: LonLat): [number, number, number] {
  const p = lat * DEG;
  const l = lon * DEG;
  const c = Math.cos(p);
  return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)];
}

function toLonLat([x, y, z]: [number, number, number]): LonLat {
  return [Math.atan2(y, x) / DEG, Math.atan2(z, Math.hypot(x, y)) / DEG];
}

/** Great-circle distance in km. */
export function distanceKm(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Point at fraction `t` along the great circle from `a` to `b` (slerp on the
 * unit sphere). Falls back to a plain lerp when the two points are nearly
 * coincident, where the sine denominator collapses.
 */
export function interpolate(a: LonLat, b: LonLat, t: number): LonLat {
  const [ax, ay, az] = toCartesian(a);
  const [bx, by, bz] = toCartesian(b);
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  const omega = Math.acos(dot);
  const sin = Math.sin(omega);
  if (sin < 1e-9) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const ka = Math.sin((1 - t) * omega) / sin;
  const kb = Math.sin(t * omega) / sin;
  return toLonLat([ax * ka + bx * kb, ay * ka + by * kb, az * ka + bz * kb]);
}

/** Initial bearing in degrees (0 = north, clockwise) from `a` toward `b`. */
export function bearing(a: LonLat, b: LonLat): number {
  const p1 = a[1] * DEG;
  const p2 = b[1] * DEG;
  const dl = (b[0] - a[0]) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/**
 * Place a [lon, lat] on a sphere of the given radius in THREE's coordinate
 * frame (+Y up, +Z toward the camera at lon 0). Used by the 3D globe; kept
 * here so the globe can't drift out of sync with the 2D projections.
 */
export function toVector3(
  [lon, lat]: LonLat,
  radius = 1
): [number, number, number] {
  const p = lat * DEG;
  const l = lon * DEG;
  const c = Math.cos(p);
  return [radius * c * Math.sin(l), radius * Math.sin(p), radius * c * Math.cos(l)];
}
