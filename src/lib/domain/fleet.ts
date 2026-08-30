import { bearing, type LonLat } from './geo';
import { pointAt, route, type Route, type RouteId } from './routes';

export type ShipClass = 'ulcv' | 'neopanamax' | 'feeder' | 'tanker' | 'bulker';

export type ShipClassStats = {
  label: string;
  /** Service speed in knots. */
  speed: number;
  /**
   * Nominal capacity, in `unit`. Box boats are measured in containers and the
   * bulk hulls in tonnes — there is no such thing as a TEU-equivalent for a
   * bulk carrier, so the two are never mixed.
   */
  capacity: number;
  /**
   * What `capacity` and `Ship.load` are counted in. Container ships carry TEU
   * (twenty-foot equivalent units); a tanker or a bulk carrier carries tonnes
   * of deadweight, and labelling those as TEU is simply wrong.
   */
  unit: 'TEU' | 't';
  /** Length overall in metres — the 3D scene scales the hull from this. */
  loa: number;
};

export const SHIP_CLASS_STATS: Record<ShipClass, ShipClassStats> = {
  ulcv: { label: 'Ultra Large', speed: 21, capacity: 24000, unit: 'TEU', loa: 400 },
  // 366 m is not a round number: it is the length limit of the locks the 2016
  // Panama expansion opened, which is what defines the class.
  neopanamax: { label: 'Neopanamax', speed: 22, capacity: 14000, unit: 'TEU', loa: 366 },
  feeder: { label: 'Feeder', speed: 18, capacity: 2500, unit: 'TEU', loa: 180 },
  tanker: { label: 'Petrolero', speed: 15, capacity: 320000, unit: 't', loa: 333 },
  bulker: { label: 'Granelero', speed: 14, capacity: 180000, unit: 't', loa: 292 },
};

export type Ship = {
  id: string;
  name: string;
  shipClass: ShipClass;
  routeId: RouteId;
  /** Normalised position along the route, 0 = `route.from`, 1 = `route.to`. */
  progress: number;
  /** +1 sailing toward `to`, -1 on the return leg. Ships bounce at each end. */
  direction: 1 | -1;
  /**
   * Cargo aboard, in the class's `unit`. Set once at creation and never
   * touched: with no port calls there is nothing to load or discharge against,
   * so today it is a constant the HUD prints as an absolute figure.
   */
  load: number;
};

const KM_PER_NAUTICAL_MILE = 1.852;

export function createShip(init: {
  id: string;
  name: string;
  shipClass: ShipClass;
  routeId: RouteId;
  progress?: number;
  direction?: 1 | -1;
  load?: number;
}): Ship {
  const stats = SHIP_CLASS_STATS[init.shipClass];
  return {
    id: init.id,
    name: init.name,
    shipClass: init.shipClass,
    routeId: init.routeId,
    progress: init.progress ?? 0,
    direction: init.direction ?? 1,
    load: init.load ?? Math.round(stats.capacity * 0.78),
  };
}

/** Service speed in km/h — what the simulation clock actually integrates. */
export function speedKmh(ship: Ship): number {
  return SHIP_CLASS_STATS[ship.shipClass].speed * KM_PER_NAUTICAL_MILE;
}

/**
 * Advance a ship by `hours` of simulated time, bouncing at either end of its
 * lane. Mutates in place: the fleet lives in a deep `$state` array, so the
 * mutation is what propagates into every view.
 */
export function advance(ship: Ship, hours: number): void {
  const r = route(ship.routeId);
  const step = (speedKmh(ship) * hours) / r.lengthKm;
  let next = ship.progress + step * ship.direction;
  while (next > 1 || next < 0) {
    if (next > 1) {
      next = 2 - next;
      ship.direction = -1;
    } else {
      next = -next;
      ship.direction = 1;
    }
  }
  ship.progress = next;
}

export function position(ship: Ship): LonLat {
  return pointAt(route(ship.routeId), ship.progress);
}

/** Compass heading in degrees, sampled just ahead of the ship along its lane. */
export function heading(ship: Ship): number {
  const r = route(ship.routeId);
  const eps = 0.0015;
  const behind = pointAt(r, Math.max(0, Math.min(1, ship.progress - eps * ship.direction)));
  const ahead = pointAt(r, Math.max(0, Math.min(1, ship.progress + eps * ship.direction)));
  return bearing(behind, ahead);
}

/** The wake: the last `km` of lane behind the ship, as a normalised span. */
export function wakeSpan(ship: Ship, km: number): [from: number, to: number] {
  const r: Route = route(ship.routeId);
  const tail = ship.progress - (km / r.lengthKm) * ship.direction;
  return [Math.max(0, Math.min(1, tail)), ship.progress];
}

export const INITIAL_FLEET: Ship[] = [
  createShip({ id: 'evergreen', name: 'Ever Meridian', shipClass: 'ulcv', routeId: 'asia-europe', progress: 0.18 }),
  createShip({ id: 'polaris', name: 'MSC Polaris', shipClass: 'ulcv', routeId: 'asia-europe', progress: 0.72, direction: -1 }),
  createShip({ id: 'kuroshio', name: 'Kuroshio Star', shipClass: 'neopanamax', routeId: 'transpacific', progress: 0.44 }),
  createShip({ id: 'sierra', name: 'Sierra Madre', shipClass: 'neopanamax', routeId: 'panama', progress: 0.61 }),
  createShip({ id: 'austral', name: 'Austral Dawn', shipClass: 'bulker', routeId: 'cape', progress: 0.33 }),
  createShip({ id: 'hansa', name: 'Hansa Nord', shipClass: 'feeder', routeId: 'atlantic', progress: 0.5, direction: -1 }),
  createShip({ id: 'coral', name: 'Coral Trader', shipClass: 'feeder', routeId: 'oceania', progress: 0.25 }),
  createShip({ id: 'pegasus', name: 'Gulf Pegasus', shipClass: 'tanker', routeId: 'gulf-india', progress: 0.66 }),
  createShip({ id: 'condor', name: 'Andes Condor', shipClass: 'bulker', routeId: 'west-coast', progress: 0.12 }),
];
