import { distanceKm, interpolate, type LonLat } from './geo';
import { port, type PortId } from './ports';

/**
 * Open-water waypoints. A great circle between two ports happily cuts straight
 * through Asia, so every real lane is expressed as a chain of chokepoints and
 * mid-ocean marks; the legs between consecutive marks are short enough that the
 * great circle stays wet.
 *
 * These are not decorative. An earlier, sparser set looked plausible on the map
 * but drove ships through northern Sumatra, Honshu, Borneo, Madagascar, Oman
 * and the Peruvian Andes — every single lane crossed land somewhere.
 *
 * The invariant now holds and is worth keeping: **every sampled point of every
 * route must fall outside the 50m coastline**, except inside the Suez and
 * Panama canals and within ~120 km of a port (berths sit in basins a
 * generalised coastline swallows). Checking it means walking `ROUTES[].points`
 * through a point-in-polygon test against `static/data/land-50m.json` — cheap
 * to write, and the only way to know, because a lane that clips a peninsula
 * looks perfectly fine at world zoom.
 *
 * Grouped by region; names say where, not what.
 */
const SEA = {
  // --- East Asia -----------------------------------------------------------
  eastChinaSea: [123.5, 30.0],
  ryukyuGap: [128.0, 27.5],
  taiwanE: [123.5, 24.5],
  luzonStrait: [122.0, 20.5],
  southChinaSea: [113.5, 11.0],
  koreaStrait: [128.9, 34.3],
  kyushuW: [128.3, 32.0],
  osumi: [130.8, 30.5],
  japanS: [135.5, 31.5],
  bosoE: [141.8, 34.2],

  // --- North Pacific -------------------------------------------------------
  pacificNW: [158.0, 40.5],
  pacificDate: [178.0, 45.5],
  pacificNE: [-162.0, 46.0],
  pacificE: [-135.0, 40.0],
  socal: [-121.5, 34.5],

  // --- Tropical Pacific ----------------------------------------------------
  philippineSea: [134.0, 23.0],
  pacificTropW: [155.0, 19.0],
  pacificTropM: [-178.0, 15.0],
  pacificTropE: [-150.0, 12.0],
  pacificTropCA: [-118.0, 9.0],
  costaRicaOff: [-88.0, 7.0],
  azueroS: [-81.0, 6.8],
  panamaApproach: [-79.5, 7.4],

  // --- Panama and the Caribbean --------------------------------------------
  // The leg between these two is the canal itself: the only place in the game
  // where a lane crosses land on purpose.
  panamaBay: [-79.7, 8.2],
  colonOff: [-79.6, 9.9],
  caribbeanSW: [-81.5, 13.5],
  caribbeanW: [-84.0, 18.0],
  yucatan: [-85.6, 21.6],
  floridaStrait: [-82.5, 24.2],
  keysS: [-80.5, 24.3],
  miamiE: [-79.9, 26.0],
  floridaE: [-79.8, 27.5],
  hatterasOff: [-75.0, 34.0],
  nyApproach: [-73.6, 39.6],

  // --- North Atlantic ------------------------------------------------------
  nantucket: [-68.0, 40.8],
  atlanticNW: [-55.0, 43.5],
  atlanticMid: [-38.0, 47.5],
  atlanticNE: [-18.0, 49.5],
  approachesW: [-9.0, 48.8],

  // --- Western Europe ------------------------------------------------------
  ushant: [-6.2, 48.3],
  channelW: [-2.5, 49.8],
  dover: [1.7, 51.1],
  northSea: [4.2, 53.2],
  elbe: [8.1, 54.1],
  biscayW: [-9.5, 46.0],
  finisterre: [-9.9, 43.2],
  iberiaW: [-9.8, 38.5],
  gibraltar: [-5.7, 35.95],
  capeStVincent: [-9.3, 36.7],

  // --- Mediterranean, Suez, Red Sea ----------------------------------------
  sicilyCh: [11.9, 37.4],
  algeriaOff: [7.5, 38.0],
  medW: [3.0, 38.0],
  alboran: [-2.5, 36.2],
  medC: [17.0, 34.5],
  medE: [30.0, 33.0],
  portSaid: [32.3, 31.5],
  suezCanal: [32.5, 30.3],
  suezGulf: [33.4, 28.0],
  redSeaN: [36.5, 24.0],
  redSeaS: [40.0, 16.5],
  babElMandeb: [43.4, 12.6],
  gulfOfAden: [48.0, 12.3],
  socotraN: [53.0, 14.5],

  // --- Arabian Sea and the Gulf --------------------------------------------
  hormuz: [56.6, 26.9],
  gulfOfOman: [58.8, 24.0],
  rasAlHadd: [60.2, 22.4],
  omanE: [59.5, 19.0],
  arabianSeaC: [56.0, 14.0],
  arabianSeaSW: [58.0, 13.0],
  somaliaE: [51.0, 7.0],
  kenyaOff: [46.0, -2.0],
  tanzaniaOff: [42.5, -11.0],

  // --- Indian Ocean and southern Africa ------------------------------------
  ceylonS: [80.5, 4.5],
  indianNE: [90.0, 0.0],
  indianC: [72.0, -12.0],
  indianSW: [62.0, -18.0],
  madagascarS: [47.0, -29.5],
  agulhas: [28.0, -36.0],
  goodHope: [18.0, -35.5],
  mozambiqueCh: [40.0, -20.0],
  mozambiqueS: [35.5, -27.0],

  // --- Malacca and the Indonesian archipelago ------------------------------
  singaporeStr: [104.2, 1.1],
  malaccaMid: [100.3, 3.4],
  malaccaN: [98.8, 5.2],
  malaccaNW: [95.5, 6.3],
  karimata: [108.5, -3.0],
  javaSea: [113.0, -5.5],
  lombok: [115.6, -8.8],
  sumbaS: [120.0, -11.5],
  timorS: [126.0, -12.0],
  arafura: [133.0, -10.5],
  torres: [142.5, -9.8],
  coralSea: [148.0, -16.0],
  tasmanN: [154.5, -25.0],
  tasman: [153.5, -32.0],

  // --- South Atlantic ------------------------------------------------------
  atlanticSE: [5.0, -32.0],
  atlanticS: [-15.0, -28.0],
  brazilS: [-38.0, -25.0],

  // --- Pacific coast of the Americas ---------------------------------------
  chileOff: [-73.0, -30.0],
  chileN: [-72.0, -23.0],
  peruS: [-73.5, -18.0],
  peruC: [-78.0, -14.0],
  peruN: [-81.0, -8.0],
  sechura: [-81.8, -5.5],
  ecuadorOff: [-82.0, -3.0],
  colombiaOff: [-80.5, 3.0],
  costaRicaW: [-85.0, 8.0],
  guatemalaOff: [-92.0, 13.0],
  oaxacaOff: [-100.5, 16.5],
  guerreroOff: [-102.0, 17.4],
  colimaOff: [-104.0, 18.6],
  bajaS: [-107.0, 18.5],
  bajaC: [-113.0, 23.0],
  bajaW: [-118.5, 28.5],
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
  /** Fuel-only stops along this lane — see `BunkerStop`. Most routes have none. */
  stops?: StopSpec[];
};

/**
 * A fuel-only stop is specified one of two ways: `bunker` points at a real
 * `Port` (Fujairah) and pulls its name/price/position from there, so the two
 * never drift apart; `anchorage` is inline because there's no port behind it
 * to look up — a ship-to-ship bunkering area has no city, no country, nothing
 * but a spot on the chart.
 */
type StopSpec =
  | { kind: 'bunker'; portId: PortId }
  | { kind: 'anchorage'; id: string; name: string; fuelPrice: number; at: LonLat };

const SPECS: RouteSpec[] = [
  {
    id: 'asia-europe',
    name: 'Asia – Europa (Suez)',
    from: 'shanghai',
    to: 'rotterdam',
    color: '#4cc9ff',
    via: [
      'eastChinaSea', 'taiwanE', 'luzonStrait', 'southChinaSea', 'singaporeStr',
      'singapore', 'malaccaMid', 'malaccaN', 'malaccaNW', 'ceylonS', 'arabianSeaSW',
      'socotraN', 'gulfOfAden', 'babElMandeb', 'redSeaS', 'redSeaN', 'suezGulf',
      'suezCanal', 'portSaid', 'medE', 'medC', 'sicilyCh', 'algeriaOff', 'medW',
      'alboran', 'gibraltar', 'capeStVincent', 'iberiaW',
      'finisterre', 'biscayW', 'ushant', 'channelW', 'dover', 'northSea',
    ],
    // Algeciras Bay, right at the strait this lane already threads through, is
    // one of the busiest ship-to-ship bunkering anchorages in the world — no
    // detour needed, the ship is passing directly over it either way.
    stops: [
      { kind: 'anchorage', id: 'gibraltar-anchorage', name: 'Fondeadero de Gibraltar', fuelPrice: 592, at: [-5.35, 36.13] },
    ],
  },
  {
    id: 'transpacific',
    name: 'Transpacífico',
    from: 'busan',
    to: 'losangeles',
    color: '#ffd166',
    // Arcs north almost to the Aleutians, which is what a great circle across
    // this ocean actually does — the old flat run along 40°N was 20% too long.
    via: [
      'koreaStrait', 'kyushuW', 'osumi', 'japanS', 'bosoE', 'pacificNW',
      'pacificDate', 'pacificNE', 'pacificE', 'socal',
    ],
  },
  {
    id: 'panama',
    name: 'Panamá – Costa Este',
    from: 'shanghai',
    to: 'newyork',
    color: '#a78bfa',
    via: [
      'eastChinaSea', 'ryukyuGap', 'philippineSea', 'pacificTropW', 'pacificTropM',
      'pacificTropE', 'pacificTropCA', 'costaRicaOff', 'azueroS', 'panamaApproach',
      'panamaBay', 'colonOff',
      'caribbeanSW', 'caribbeanW', 'yucatan', 'floridaStrait', 'keysS', 'miamiE',
      'floridaE',
      'hatterasOff', 'nyApproach',
    ],
  },
  {
    id: 'cape',
    name: 'Cabo de Buena Esperanza',
    from: 'singapore',
    to: 'santos',
    color: '#4ade80',
    // South of Madagascar, not up the Mozambique Channel: that is both the real
    // routing for this trade and the only way the leg stays off the island.
    via: [
      'malaccaMid', 'malaccaN', 'malaccaNW', 'indianNE', 'indianC', 'indianSW',
      'madagascarS',
      'agulhas', 'goodHope', 'atlanticSE', 'atlanticS', 'brazilS',
    ],
  },
  {
    id: 'atlantic',
    name: 'Atlántico Norte',
    from: 'newyork',
    to: 'hamburg',
    color: '#f472b6',
    via: [
      'nyApproach', 'nantucket', 'atlanticNW', 'atlanticMid', 'atlanticNE',
      'approachesW', 'ushant', 'channelW', 'dover', 'northSea', 'elbe',
    ],
  },
  {
    id: 'oceania',
    name: 'Sudeste Asiático – Oceanía',
    from: 'singapore',
    to: 'sydney',
    color: '#fb923c',
    via: [
      'singaporeStr', 'karimata', 'javaSea', 'lombok', 'sumbaS', 'timorS',
      'arafura', 'torres', 'coralSea', 'tasmanN', 'tasman',
    ],
  },
  {
    id: 'gulf-india',
    name: 'Golfo – Índico',
    from: 'jebelali',
    to: 'durban',
    color: '#22d3ee',
    // Routed straight through Fujairah rather than the old approximate
    // mid-Gulf mark: real traffic leaving the Gulf for Hormuz hugs this coast,
    // and it's also this lane's bunker stop, so the geometry should agree with
    // the price it charges.
    via: [
      'fujairah', 'hormuz', 'gulfOfOman', 'rasAlHadd', 'omanE', 'arabianSeaC', 'somaliaE',
      'kenyaOff', 'tanzaniaOff', 'mozambiqueCh', 'mozambiqueS',
    ],
    stops: [{ kind: 'bunker', portId: 'fujairah' }],
  },
  {
    id: 'west-coast',
    name: 'Pacífico Americano',
    from: 'valparaiso',
    to: 'losangeles',
    color: '#e879f9',
    // Hugs the coast the whole way, Manzanillo included. It no longer detours
    // into the Bay of Panama, which added a thousand miles for nothing.
    via: [
      'chileOff', 'chileN', 'peruS', 'peruC', 'peruN', 'sechura', 'ecuadorOff',
      'colombiaOff', 'costaRicaW', 'guatemalaOff', 'oaxacaOff', 'guerreroOff',
      'colimaOff', 'manzanillo', 'bajaS', 'bajaC', 'bajaW',
    ],
  },
];

/**
 * A fuel-only stop, resolved onto a specific route's geometry. `kind: 'bunker'`
 * is a real named port whose business is overwhelmingly fuel (Fujairah);
 * `kind: 'anchorage'` is open water with no port identity at all — a
 * ship-to-ship bunkering area, nothing more. Either way `atProgress` is where
 * along *this* route's polyline it sits, so a ship can stop there without any
 * detour: it's a point already on the path it sails.
 */
export type BunkerStop = {
  id: string;
  name: string;
  kind: 'bunker' | 'anchorage';
  fuelPrice: number;
  at: LonLat;
  atProgress: number;
};

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
  /** Fuel-only stops along this lane. Empty for most routes. */
  stops: BunkerStop[];
};

/** One sample every ~120 km, so even a hard zoom shows a curve and not a chord. */
const SAMPLE_KM = 120;

/**
 * Progress (0..1) of whichever sampled point lands closest to `target`. Exact
 * for a stop built from a via-point that's already in `points` (Fujairah);
 * approximate — to within about half a sample spacing, ~60 km — for one that
 * isn't (the Gibraltar anchorage), which is a fair description of "somewhere
 * in this bay" anyway.
 */
function nearestProgress(points: LonLat[], cumulative: number[], lengthKm: number, target: LonLat): number {
  let bestI = 0;
  let bestKm = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = distanceKm(points[i], target);
    if (d < bestKm) {
      bestKm = d;
      bestI = i;
    }
  }
  return lengthKm > 0 ? cumulative[bestI] / lengthKm : 0;
}

function buildStop(spec: StopSpec, points: LonLat[], cumulative: number[], lengthKm: number): BunkerStop {
  const at = spec.kind === 'bunker' ? port(spec.portId).at : spec.at;
  return {
    id: spec.kind === 'bunker' ? spec.portId : spec.id,
    name: spec.kind === 'bunker' ? port(spec.portId).name : spec.name,
    kind: spec.kind,
    fuelPrice: spec.kind === 'bunker' ? port(spec.portId).fuelPrice : spec.fuelPrice,
    at,
    atProgress: nearestProgress(points, cumulative, lengthKm, at),
  };
}

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
  const lengthKm = cumulative[cumulative.length - 1];

  return {
    id: spec.id,
    name: spec.name,
    from: spec.from,
    to: spec.to,
    color: spec.color,
    points,
    cumulative,
    lengthKm,
    stops: (spec.stops ?? []).map((s) => buildStop(s, points, cumulative, lengthKm)),
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
