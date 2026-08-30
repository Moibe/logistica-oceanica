import { bearing, type LonLat } from './geo';
import { pointAt, route, type Route, type RouteId } from './routes';

export type ShipClass = 'ulcv' | 'neopanamax' | 'feeder' | 'tanker' | 'bulker';

export type ShipClassStats = {
  label: string;
  /** Design (service) speed in knots — the 100% mark on the speed slider. */
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
  /** Bunker tank size in tonnes of fuel oil. See the derivation note below. */
  fuelCapacity: number;
  /** Burn rate in tonnes/day AT DESIGN SPEED. Actual burn scales with the cube
   *  of the speed factor — see `fuelBurnPerDay`. */
  fuelBurnRate: number;
  /** Hours spent alongside once a voyage ends, before the return leg starts. */
  dockHours: number;
};

/**
 * Speed slider bounds, as a factor of design speed. 0.6 is a realistic slow-
 * steaming floor (real operators have gone lower under fuel-price pressure,
 * but a hull stops answering the helm well below this); 1.15 is "flank speed"
 * — pushing past the service rating for a burst, at a real cost in fuel.
 */
export const MIN_SPEED_FACTOR = 0.6;
export const MAX_SPEED_FACTOR = 1.15;

/**
 * `fuelCapacity` is not a guess: it is `worstCaseVoyageDays × fuelBurnRate ×
 * 1.5`, where `worstCaseVoyageDays` is how long the class's longest assigned
 * route takes at design speed (from the route calibration — panama for
 * neopanamax and cape for bulker are harder than the other lane each class
 * also sails). The 1.5× margin means a ship always completes its hardest
 * route at design speed with fuel to spare.
 *
 * That margin is deliberately thin against `MAX_SPEED_FACTOR`: burn scales
 * with speed cubed, so 1.15× speed costs 1.15³ ≈ 1.52× the fuel — almost
 * exactly cancelling the 1.5× margin. Push a ship to flank speed for its
 * entire hardest voyage and it runs dry a hair short of port. That is the one
 * way today to actually see a ship go adrift; every other combination of
 * speed and route leaves slack.
 */
export const SHIP_CLASS_STATS: Record<ShipClass, ShipClassStats> = {
  ulcv: {
    label: 'Ultra Large',
    speed: 21,
    capacity: 24000,
    unit: 'TEU',
    loa: 400,
    fuelBurnRate: 220,
    fuelCapacity: 7100, // 21.6 d (asia-europe) × 220 t/d × 1.5
    dockHours: 30,
  },
  // 366 m is not a round number: it is the length limit of the locks the 2016
  // Panama expansion opened, which is what defines the class.
  neopanamax: {
    label: 'Neopanamax',
    speed: 22,
    capacity: 14000,
    unit: 'TEU',
    loa: 366,
    fuelBurnRate: 180,
    fuelCapacity: 6000, // 22.3 d (panama, its harder lane) × 180 t/d × 1.5
    dockHours: 24,
  },
  feeder: {
    label: 'Feeder',
    speed: 18,
    capacity: 2500,
    unit: 'TEU',
    loa: 180,
    fuelBurnRate: 35,
    fuelCapacity: 520, // 10.0 d (oceania, its harder lane) × 35 t/d × 1.5
    dockHours: 12,
  },
  tanker: {
    label: 'Petrolero',
    speed: 15,
    capacity: 320000,
    unit: 't',
    loa: 333,
    fuelBurnRate: 90,
    fuelCapacity: 1540, // 11.4 d (gulf-india) × 90 t/d × 1.5
    dockHours: 16,
  },
  bulker: {
    label: 'Granelero',
    speed: 14,
    capacity: 180000,
    unit: 't',
    loa: 292,
    fuelBurnRate: 42,
    fuelCapacity: 1700, // 27.1 d (cape, its harder lane) × 42 t/d × 1.5
    dockHours: 28,
  },
};

export type ShipStatus = 'sailing' | 'docked' | 'adrift';

export type Ship = {
  id: string;
  name: string;
  shipClass: ShipClass;
  routeId: RouteId;
  /** Normalised position along the route, 0 = `route.from`, 1 = `route.to`. */
  progress: number;
  /**
   * +1 sailing toward `to`, -1 on the return leg. Flipped the instant a ship
   * arrives (so while docked it already points at the leg it's about to
   * sail), not on departure.
   */
  direction: 1 | -1;
  /**
   * Cargo aboard, in the class's `unit`. Set once at creation and never
   * touched: with no cargo-handling model this is a constant the HUD prints
   * as an absolute figure, unrelated to the fuel/dock cycle below.
   */
  load: number;
  status: ShipStatus;
  /** Current bunkers, in tonnes. Depleted while `sailing`, refilled while `docked`. */
  fuel: number;
  /** Cruise speed as a factor of the class's design speed, clamped to
   *  [MIN_SPEED_FACTOR, MAX_SPEED_FACTOR]. Player-adjustable per ship. */
  speedFactor: number;
  /** Hours left in the current port call. Only meaningful while `docked`. */
  dockHoursRemaining: number;
  /** Fuel level at the moment this dock call started — the low end of the
   *  refuel interpolation in `advance`. Only meaningful while `docked`. */
  fuelAtDock: number;
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
  fuel?: number;
  speedFactor?: number;
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
    status: 'sailing',
    fuel: init.fuel ?? stats.fuelCapacity,
    speedFactor: init.speedFactor ?? 1,
    dockHoursRemaining: 0,
    fuelAtDock: 0,
  };
}

export function clampSpeedFactor(factor: number): number {
  return Math.min(MAX_SPEED_FACTOR, Math.max(MIN_SPEED_FACTOR, factor));
}

/** Current cruise speed in km/h — design speed scaled by the player's setting. */
export function speedKmh(ship: Ship): number {
  return SHIP_CLASS_STATS[ship.shipClass].speed * ship.speedFactor * KM_PER_NAUTICAL_MILE;
}

/**
 * Propulsion burn in tonnes/day at the ship's current speed setting. Hull
 * resistance — and so the power needed to overcome it — grows with the cube
 * of speed, which is the real reason slow steaming saves so much fuel: 0.6×
 * speed burns 0.6³ ≈ 22% of the design-speed rate; 1.15× burns ≈ 152%.
 */
export function fuelBurnPerDay(ship: Ship): number {
  return SHIP_CLASS_STATS[ship.shipClass].fuelBurnRate * ship.speedFactor ** 3;
}

/** Fraction of the tank remaining, 0..1 — what the HUD gauge and map warnings key off. */
export function fuelFraction(ship: Ship): number {
  const capacity = SHIP_CLASS_STATS[ship.shipClass].fuelCapacity;
  return capacity > 0 ? Math.max(0, Math.min(1, ship.fuel / capacity)) : 0;
}

/**
 * Advance a ship by `hours` of simulated time. A single call can cross more
 * than one state transition — arriving at port, finishing a dock call, even
 * running out of fuel mid-leg — because at high time multipliers one frame's
 * `hours` can span several simulated hours. The loop below walks through
 * however many transitions that `hours` actually contains, each sub-step
 * landing exactly on whichever event (port, empty tank, or the end of the
 * requested time) comes first.
 *
 * Mutates in place: the fleet lives in a deep `$state` array, so the mutation
 * is what propagates into every view.
 */
export function advance(ship: Ship, hours: number): void {
  let remaining = hours;
  const stats = SHIP_CLASS_STATS[ship.shipClass];
  // A hard cap on sub-steps per call, not a tuned value: normal play never
  // gets near it (one arrival + one full dock cycle in a single frame would
  // already be unusual), it just stops a future bug in the transition logic
  // from hanging the render loop.
  let guard = 64;

  while (remaining > 1e-9 && guard-- > 0) {
    if (ship.status === 'adrift') {
      // No rescue mechanic yet: a ship that runs dry stays exactly where it
      // ran out until one exists. Time still passes around it.
      return;
    }

    if (ship.status === 'docked') {
      const step = Math.min(remaining, ship.dockHoursRemaining);
      ship.dockHoursRemaining -= step;
      const done = 1 - ship.dockHoursRemaining / stats.dockHours;
      ship.fuel = ship.fuelAtDock + (stats.fuelCapacity - ship.fuelAtDock) * done;
      remaining -= step;
      if (ship.dockHoursRemaining <= 1e-9) {
        ship.fuel = stats.fuelCapacity;
        ship.status = 'sailing';
      }
      continue;
    }

    // Sailing: find whichever comes first — running out of `hours`, reaching
    // the port at the end of this leg, or running out of fuel.
    const r = route(ship.routeId);
    const kmh = speedKmh(ship);
    const burnPerHour = fuelBurnPerDay(ship) / 24;
    const target = ship.direction === 1 ? 1 : 0;
    const progressToGo = Math.abs(target - ship.progress);
    const hoursToPort = kmh > 0 ? (progressToGo * r.lengthKm) / kmh : Infinity;
    const hoursOfFuel = burnPerHour > 0 ? ship.fuel / burnPerHour : Infinity;
    const step = Math.min(remaining, hoursToPort, hoursOfFuel);

    ship.progress += ((kmh * step) / r.lengthKm) * ship.direction;
    ship.fuel = Math.max(0, ship.fuel - burnPerHour * step);
    remaining -= step;

    if (step >= hoursOfFuel - 1e-9 && hoursOfFuel <= hoursToPort) {
      ship.status = 'adrift';
      continue;
    }
    if (step >= hoursToPort - 1e-9) {
      ship.progress = target;
      ship.direction = ship.direction === 1 ? -1 : 1;
      ship.status = 'docked';
      ship.dockHoursRemaining = stats.dockHours;
      ship.fuelAtDock = ship.fuel;
      continue;
    }
    // Otherwise `remaining` was the smallest of the three and the loop ends
    // naturally on the next `while` check.
  }
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

/**
 * Hours until arrival at the current destination, folding in any time still
 * left on a dock call. `null` for an adrift ship — with no rescue mechanic,
 * there is no arrival to estimate.
 */
export function etaHours(ship: Ship): number | null {
  if (ship.status === 'adrift') return null;
  const r = route(ship.routeId);
  const remainingKm = r.lengthKm * (ship.direction === 1 ? 1 - ship.progress : ship.progress);
  const kmh = speedKmh(ship);
  const transitHours = kmh > 0 ? remainingKm / kmh : Infinity;
  const dockHours = ship.status === 'docked' ? ship.dockHoursRemaining : 0;
  return dockHours + transitHours;
}

export const INITIAL_FLEET: Ship[] = [
  createShip({ id: 'evergreen', name: 'Ever Meridian', shipClass: 'ulcv', routeId: 'asia-europe', progress: 0.18 }),
  createShip({ id: 'polaris', name: 'MSC Polaris', shipClass: 'ulcv', routeId: 'asia-europe', progress: 0.72, direction: -1 }),
  createShip({ id: 'kuroshio', name: 'Kuroshio Star', shipClass: 'neopanamax', routeId: 'transpacific', progress: 0.44 }),
  createShip({ id: 'sierra', name: 'Sierra Madre', shipClass: 'neopanamax', routeId: 'panama', progress: 0.61 }),
  createShip({ id: 'austral', name: 'Austral Dawn', shipClass: 'bulker', routeId: 'cape', progress: 0.33 }),
  createShip({ id: 'hansa', name: 'Hansa Nord', shipClass: 'feeder', routeId: 'atlantic', progress: 0.5, direction: -1 }),
  // Parked just short of Sídney on purpose: within a few real seconds of load
  // this is the ship that demonstrates arrival, the dock call and the fuel
  // gauge climbing back to full, without waiting out a multi-minute voyage.
  createShip({ id: 'coral', name: 'Coral Trader', shipClass: 'feeder', routeId: 'oceania', progress: 0.97 }),
  createShip({ id: 'pegasus', name: 'Gulf Pegasus', shipClass: 'tanker', routeId: 'gulf-india', progress: 0.66 }),
  createShip({ id: 'condor', name: 'Andes Condor', shipClass: 'bulker', routeId: 'west-coast', progress: 0.12 }),
];
