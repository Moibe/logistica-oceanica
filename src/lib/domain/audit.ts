import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { distanceKm, type LonLat } from './geo';
import { PORTS } from './ports';
import { ROUTES, type Route } from './routes';

/**
 * The route auditor. It exists because of a bug that was invisible: the first
 * set of waypoints sent ships through northern Sumatra, Honshu, Borneo,
 * Madagascar, Oman and the Peruvian Andes — all eight lanes crossed land, and
 * not one of them looked wrong at world zoom. A lane that clips a peninsula is
 * indistinguishable from one that rounds it until you test every point.
 *
 * The invariant: every sampled point of every route falls outside the 50m
 * coastline, except inside a canal or close to a port. Nothing here knows about
 * rendering; the page just prints what this returns.
 */

/** Berths sit in basins that a generalised coastline swallows whole. */
export const PORT_GRACE_KM = 120;

/**
 * Places a lane is *supposed* to be dry, plus the two stretches of the Suez
 * approach that are genuinely water but too narrow for the 50m coastline to
 * resolve.
 */
export const CANALS: { name: string; at: LonLat; km: number }[] = [
  { name: 'Canal de Suez', at: [32.4, 30.8], km: 90 },
  { name: 'Golfo de Suez (norte)', at: [32.9, 29.4], km: 90 },
  { name: 'Golfo de Suez (sur)', at: [33.5, 28.2], km: 90 },
  { name: 'Canal de Panamá', at: [-79.65, 9.05], km: 90 },
];

type IndexedPolygon = {
  rings: Position[][];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type LandIndex = {
  polygons: IndexedPolygon[];
  /** Landmasses in the index — handy for reporting which resolution was loaded. */
  count: number;
};

/**
 * Flatten the land into rings, each with a bounding box. The box is the whole
 * trick: without it the check is O(points × every coastline vertex on Earth)
 * and simply never finishes. With it, all but a handful of landmasses are
 * rejected on four comparisons.
 */
export function indexLand(land: FeatureCollection<Polygon | MultiPolygon>): LandIndex {
  const polygons: IndexedPolygon[] = [];

  const add = (rings: Position[][]) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    // Only the outer ring bounds the polygon; holes are inside it by definition.
    for (const [x, y] of rings[0]) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    polygons.push({ rings, x0, y0, x1, y1 });
  };

  for (const f of land.features) {
    const g = f.geometry;
    if (g.type === 'Polygon') add(g.coordinates);
    else for (const poly of g.coordinates) add(poly);
  }

  return { polygons, count: polygons.length };
}

/**
 * Ray casting in plain lon/lat. Natural Earth's rings are already split at the
 * antimeridian, so a horizontal ray never has to wrap — which is the one thing
 * that would break this.
 */
function inRing(ring: Position[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function isOnLand(index: LandIndex, [lon, lat]: LonLat): boolean {
  for (const poly of index.polygons) {
    if (lon < poly.x0 || lon > poly.x1 || lat < poly.y0 || lat > poly.y1) continue;
    // Even-odd across every ring of the polygon, so holes (inland seas) count
    // as water rather than land.
    let inside = false;
    for (const ring of poly.rings) if (inRing(ring, lon, lat)) inside = !inside;
    if (inside) return true;
  }
  return false;
}

function isExempt(p: LonLat): boolean {
  if (PORTS.some((q) => distanceKm(p, q.at) < PORT_GRACE_KM)) return true;
  return CANALS.some((c) => distanceKm(p, c.at) < c.km);
}

export type RouteFinding = {
  route: Route;
  lengthNm: number;
  /**
   * How much longer the lane is than the straight great circle between its two
   * ports. Informative, not a verdict: any route that has to round a continent
   * is legitimately far longer than the direct line.
   */
  detourPct: number;
  /** Sampled points that landed on land and are not exempt. */
  dry: LonLat[];
};

export function auditRoutes(index: LandIndex): RouteFinding[] {
  return ROUTES.map((route) => {
    const dry = route.points.filter((p) => !isExempt(p) && isOnLand(index, p));
    const from = PORTS.find((p) => p.id === route.from)!.at;
    const to = PORTS.find((p) => p.id === route.to)!.at;
    const straight = distanceKm(from, to);
    return {
      route,
      lengthNm: Math.round(route.lengthKm / 1.852),
      detourPct: Math.round(((route.lengthKm - straight) / straight) * 100),
      dry,
    };
  });
}

/** `[-79.6, 8.2]` → `8.20° N  79.60° W`, which is what you paste back into a waypoint. */
export function formatCoord([lon, lat]: LonLat): string {
  const ns = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}`;
  const ew = `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
  return `${ns}  ${ew}`;
}
