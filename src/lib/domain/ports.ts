import type { LonLat } from './geo';

export type PortId = string;

export type Port = {
  id: PortId;
  name: string;
  country: string;
  at: LonLat;
  /** Rough annual throughput in millions of TEU — drives the dot size on the map. */
  teu: number;
  /**
   * Bunker fuel price, in USD per tonne. A snapshot, not a feed: real bunker
   * prices move with the oil market day to day, sometimes 20-30% apart
   * between two ports on the same afternoon. What's preserved here is the
   * real *hierarchy* — Singapore is the world's largest bunkering port and
   * prices accordingly, Fujairah and Rotterdam are the other two major
   * refuelling hubs on these lanes, and small or refining-poor ports (Sídney,
   * Valparaíso, Durban) sit noticeably higher because fuel has to be trucked
   * or barged in rather than supplied by a competitive local market.
   */
  fuelPrice: number;
  /**
   * 'full' does cargo and (usually cheap) bunkering both — nearly every port
   * in the real world, since fuel supply just follows traffic volume.
   * 'bunker' is the real exception: a port whose business is overwhelmingly
   * fuel, not cargo. Fujairah is the textbook case — one of the world's
   * three biggest bunkering ports by volume specifically because it sits
   * just outside the Strait of Hormuz, letting a ship top up without
   * actually sailing into the Gulf. Its container/general-cargo throughput
   * is a rounding error next to that.
   */
  kind: 'full' | 'bunker';
};

/**
 * The container ports the game runs on. Coordinates are the actual terminal
 * basins (not the city centre) so a ship parked at a port sits on water, which
 * matters once the camera can zoom in far enough to tell.
 */
export const PORTS: Port[] = [
  { id: 'shanghai',   name: 'Shanghai',      country: 'CN', at: [121.80, 31.20], teu: 49.3, fuelPrice: 615, kind: 'full' },
  { id: 'singapore',  name: 'Singapur',      country: 'SG', at: [103.75,  1.26], teu: 39.0, fuelPrice: 585, kind: 'full' },
  { id: 'busan',      name: 'Busan',         country: 'KR', at: [129.08, 35.08], teu: 22.7, fuelPrice: 610, kind: 'full' },
  { id: 'rotterdam',  name: 'Rotterdam',     country: 'NL', at: [  4.05, 51.95], teu: 13.4, fuelPrice: 600, kind: 'full' },
  { id: 'hamburg',    name: 'Hamburgo',      country: 'DE', at: [  9.93, 53.53], teu:  8.3, fuelPrice: 625, kind: 'full' },
  { id: 'losangeles', name: 'Los Ángeles',   country: 'US', at: [-118.26, 33.73], teu: 9.9, fuelPrice: 645, kind: 'full' },
  { id: 'newyork',    name: 'Nueva York',    country: 'US', at: [-74.10, 40.65], teu:  9.5, fuelPrice: 635, kind: 'full' },
  { id: 'santos',     name: 'Santos',        country: 'BR', at: [-46.32, -24.00], teu: 4.8, fuelPrice: 685, kind: 'full' },
  { id: 'valparaiso', name: 'Valparaíso',    country: 'CL', at: [-71.63, -33.03], teu: 1.0, fuelPrice: 705, kind: 'full' },
  { id: 'durban',     name: 'Durban',        country: 'ZA', at: [ 31.04, -29.87], teu: 2.6, fuelPrice: 695, kind: 'full' },
  { id: 'jebelali',   name: 'Jebel Ali',     country: 'AE', at: [ 55.06, 25.01], teu: 14.0, fuelPrice: 590, kind: 'full' },
  { id: 'mumbai',     name: 'Nhava Sheva',   country: 'IN', at: [ 72.95, 18.95], teu:  6.4, fuelPrice: 660, kind: 'full' },
  { id: 'sydney',     name: 'Sídney',        country: 'AU', at: [151.19, -33.86], teu: 2.6, fuelPrice: 720, kind: 'full' },
  { id: 'manzanillo', name: 'Manzanillo',    country: 'MX', at: [-104.32, 19.05], teu: 3.7, fuelPrice: 670, kind: 'full' },
  // Real bunkering port, not a cargo one — see the `kind` doc above. Coordinates
  // sit just off the harbour, in the anchorage where most of its bunkering
  // actually happens (ship-to-ship, not alongside a quay).
  { id: 'fujairah',   name: 'Fujairah',      country: 'AE', at: [ 56.34, 25.12], teu: 0.3, fuelPrice: 578, kind: 'bunker' },
];

const BY_ID = new Map(PORTS.map((p) => [p.id, p]));

export function port(id: PortId): Port {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Puerto desconocido: ${id}`);
  return p;
}
