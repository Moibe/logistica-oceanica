import { distanceKm, interpolate, type LonLat } from './geo';
import { port, type PortId } from './ports';

/**
 * Open-water waypoints. A great circle between two ports happily cuts straight
 * through Asia, so every real lane is expressed as a chain of chokepoints and
 * mid-ocean marks; the legs between consecutive marks are short enough that the
 * great circle stays wet.
 */
const SEA = {
  malacca: [100.4, 3.0],
  southChina: [113.5, 11.0],
  eastChina: [123.0, 28.5],
  luzon: [126.0, 20.0],
  pacificNW: [160.0, 41.0],
  pacificMid: [-175.0, 40.0],
  pacificE: [-140.0, 36.0],
  pacificTrop: [-140.0, 12.0],
  indianMid: [68.0, -2.0],
  indianNW: [60.0, 12.0],
  arabianSea: [58.0, 22.0],
  babElMandeb: [43.4, 12.6],
  redSea: [37.5, 22.0],
  suez: [32.55, 30.2],
  medEast: [30.0, 33.5],
  medMid: [15.0, 35.5],
  gibraltar: [-5.6, 35.95],
  iberia: [-10.0, 40.0],
  biscay: [-10.0, 46.5],
  ushant: [-6.0, 49.0],
  channel: [1.6, 50.8],
  northSea: [3.6, 53.2],
  azores: [-35.0, 40.0],
  atlanticNW: [-65.0, 40.5],
  florida: [-79.5, 26.0],
  caribbean: [-77.0, 13.0],
  panamaE: [-79.3, 9.2],
  panamaW: [-79.6, 8.6],
  chiapas: [-95.0, 14.0],
  humboldt: [-78.0, -12.0],
  brazilS: [-45.0, -30.0],
  atlanticS: [-15.0, -30.0],
  goodHope: [19.0, -35.5],
  agulhas: [32.0, -33.5],
  mozambique: [42.0, -22.0],
  ceylon: [82.0, 4.0],
  arafura: [135.0, -10.5],
  coralSea: [154.0, -25.0],
  tasman: [152.5, -34.5],
} satisfies Record<string, LonLat>;

type Mark = PortId | keyof typeof SEA;

function markAt(m: Mark): LonLat {
  return m in SEA ? (SEA as Record<string, LonLat>)[m] : port(m as PortId).at;
}

export type RouteId = string;

type RouteSpec = {
  id: RouteId;
  name: string;
  from: PortId;
  to: PortId;
  /** Chokepoints and mid-ocean marks between the two ports, in order. */
  via: Mark[];
  /** Line colour on every renderer. Kept on the route so the three views match. */
  color: string;
};

const SPECS: RouteSpec[] = [
  {
    id: 'asia-europe',
    name: 'Asia – Europa (Suez)',
    from: 'shanghai',
    to: 'rotterdam',
    color: '#4cc9ff',
    via: [
      'eastChina', 'southChina', 'singapore', 'malacca', 'ceylon', 'indianNW',
      'babElMandeb', 'redSea', 'suez', 'medEast', 'medMid', 'gibraltar',
      'iberia', 'biscay', 'ushant', 'channel', 'northSea',
    ],
  },
  {
    id: 'transpacific',
    name: 'Transpacífico',
    from: 'busan',
    to: 'losangeles',
    color: '#ffd166',
    via: ['eastChina', 'pacificNW', 'pacificMid', 'pacificE'],
  },
  {
    id: 'panama',
    name: 'Panamá – Costa Este',
    from: 'shanghai',
    to: 'newyork',
    color: '#a78bfa',
    via: [
      'eastChina', 'luzon', 'pacificTrop', 'chiapas', 'panamaW', 'panamaE',
      'caribbean', 'florida', 'atlanticNW',
    ],
  },
  {
    id: 'cape',
    name: 'Cabo de Buena Esperanza',
    from: 'singapore',
    to: 'santos',
    color: '#4ade80',
    via: [
      'malacca', 'ceylon', 'indianMid', 'mozambique', 'agulhas', 'goodHope',
      'atlanticS', 'brazilS',
    ],
  },
  {
    id: 'atlantic',
    name: 'Atlántico Norte',
    from: 'newyork',
    to: 'hamburg',
    color: '#f472b6',
    via: ['atlanticNW', 'azores', 'iberia', 'biscay', 'ushant', 'channel', 'northSea'],
  },
  {
    id: 'oceania',
    name: 'Sudeste Asiático – Oceanía',
    from: 'singapore',
    to: 'sydney',
    color: '#fb923c',
    via: ['malacca', 'arafura', 'coralSea', 'tasman'],
  },
  {
    id: 'gulf-india',
    name: 'Golfo – Índico',
    from: 'jebelali',
    to: 'durban',
    color: '#22d3ee',
    via: ['arabianSea', 'indianNW', 'indianMid', 'mozambique'],
  },
  {
    id: 'west-coast',
    name: 'Pacífico Americano',
    from: 'valparaiso',
    to: 'losangeles',
    color: '#e879f9',
    via: ['humboldt', 'panamaW', 'chiapas', 'manzanillo'],
  },
];

export type Route = {
  id: RouteId;
  name: string;
  from: PortId;
  to: PortId;
  color: string;
  /** Densely sampled great-circle polyline, ready to project or to lift onto a sphere. */
  points: LonLat[];
  /** Cumulative km at each point; the last entry is the total length. */
  cumulative: number[];
  lengthKm: number;
};

/** One sample every ~120 km, so even a hard zoom shows a curve and not a chord. */
const SAMPLE_KM = 120;

function buildRoute(spec: RouteSpec): Route {
  const marks: LonLat[] = [port(spec.from).at, ...spec.via.map(markAt), port(spec.to).at];

  const points: LonLat[] = [marks[0]];
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i];
    const b = marks[i + 1];
    const steps = Math.max(1, Math.ceil(distanceKm(a, b) / SAMPLE_KM));
    // Start at 1: point 0 of this leg is the last point of the previous one.
    for (let s = 1; s <= steps; s++) points.push(interpolate(a, b, s / steps));
  }

  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + distanceKm(points[i - 1], points[i]));
  }

  return {
    id: spec.id,
    name: spec.name,
    from: spec.from,
    to: spec.to,
    color: spec.color,
    points,
    cumulative,
    lengthKm: cumulative[cumulative.length - 1],
  };
}

export const ROUTES: Route[] = SPECS.map(buildRoute);

const BY_ID = new Map(ROUTES.map((r) => [r.id, r]));

export function route(id: RouteId): Route {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`Ruta desconocida: ${id}`);
  return r;
}

/**
 * Position at `t` (0..1) along a route, interpolating *by distance* rather than
 * by index — legs are sampled at a fixed km step, so index-lerp would make a
 * ship speed up through the short legs around chokepoints.
 */
export function pointAt(r: Route, t: number): LonLat {
  const target = Math.max(0, Math.min(1, t)) * r.lengthKm;
  // Binary search the segment containing `target`.
  let lo = 0;
  let hi = r.cumulative.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (r.cumulative[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = r.cumulative[hi] - r.cumulative[lo];
  const f = span > 0 ? (target - r.cumulative[lo]) / span : 0;
  return interpolate(r.points[lo], r.points[hi], f);
}

/**
 * The slice of the polyline covering [from, to] in normalised progress, with
 * both ends landing exactly on the interpolated position. This is what draws a
 * wake: the renderers ask for the last stretch behind a ship and stroke it with
 * a fading gradient.
 */
export function slice(r: Route, from: number, to: number): LonLat[] {
  const a = Math.max(0, Math.min(1, Math.min(from, to)));
  const b = Math.max(0, Math.min(1, Math.max(from, to)));
  const kmA = a * r.lengthKm;
  const kmB = b * r.lengthKm;
  const out: LonLat[] = [pointAt(r, a)];
  for (let i = 0; i < r.points.length; i++) {
    if (r.cumulative[i] > kmA && r.cumulative[i] < kmB) out.push(r.points[i]);
  }
  out.push(pointAt(r, b));
  return out;
}
