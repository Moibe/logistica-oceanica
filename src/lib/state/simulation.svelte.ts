import { browser } from '$app/environment';
import { advance, INITIAL_FLEET, type Ship } from '$lib/domain/fleet';

/**
 * Simulated hours per real second at 1x, i.e. one simulated day every eight
 * seconds. Tuned against the fleet rather than picked: the shortest lane in the
 * game is nine days and the longest twenty-eight, so at 1x a voyage runs from
 * about a minute to nearly four — long enough to watch a decision play out.
 * At 12 h/s (the first guess) the whole Asia–Europe run took 42 seconds and a
 * simulated year went by in twelve minutes, which left nowhere to stand.
 * 16x still skips a fortnight in about ten seconds when you want to fast-forward.
 */
const BASE_HOURS_PER_SECOND = 3;

export const SPEED_STEPS = [0, 0.25, 1, 4, 16] as const;

/**
 * The single clock every view shares. Mount the canvas map, the globe and the
 * MapLibre view side by side and they all read the same fleet at the same
 * simulated instant — the renderers own no state of their own beyond camera.
 *
 * The rAF loop is reference-counted: each mounted view calls `attach()` in an
 * `$effect` and the loop stops when the last one unmounts, so an idle tab isn't
 * burning frames integrating ship positions nobody is looking at.
 */
class Simulation {
  /** Deep `$state`: `advance()` mutates ships in place and the views follow. */
  ships = $state<Ship[]>(INITIAL_FLEET);
  /** Simulated hours since the scenario started. */
  hours = $state(0);
  /** Index into `SPEED_STEPS`. Index 0 is pause. */
  speedIndex = $state(2);
  selectedId = $state<string | null>(null);

  #frame = 0;
  #lastMs = 0;
  #viewers = 0;

  get multiplier(): number {
    return SPEED_STEPS[this.speedIndex];
  }

  get running(): boolean {
    return this.multiplier > 0;
  }

  get selected(): Ship | null {
    return this.ships.find((s) => s.id === this.selectedId) ?? null;
  }

  /** Simulated calendar day, 1-based — what the HUD prints. */
  get day(): number {
    return Math.floor(this.hours / 24) + 1;
  }

  get clock(): string {
    const h = Math.floor(this.hours % 24);
    const m = Math.floor((this.hours % 1) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  select(id: string | null) {
    this.selectedId = this.selectedId === id ? null : id;
  }

  cycleSpeed() {
    this.speedIndex = (this.speedIndex + 1) % SPEED_STEPS.length;
  }

  togglePause() {
    // Remember nothing: pausing then resuming lands back on 1x, which is what
    // you want after scrubbing at 16x and losing track of where you were.
    this.speedIndex = this.speedIndex === 0 ? 2 : 0;
  }

  /**
   * Register a viewer. Returns the teardown, so the idiomatic call site is
   * `$effect(() => sim.attach())`.
   */
  attach(): () => void {
    if (!browser) return () => {};
    this.#viewers++;
    if (this.#viewers === 1) this.#start();
    return () => {
      this.#viewers--;
      if (this.#viewers === 0) this.#stop();
    };
  }

  #start() {
    this.#lastMs = performance.now();
    const tick = (now: number) => {
      // Clamp the delta: a backgrounded tab hands back a multi-second frame and
      // every ship would teleport a third of the way across the Pacific.
      const dt = Math.min(0.1, (now - this.#lastMs) / 1000);
      this.#lastMs = now;
      const hours = dt * BASE_HOURS_PER_SECOND * this.multiplier;
      if (hours > 0) {
        this.hours += hours;
        for (const ship of this.ships) advance(ship, hours);
      }
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  #stop() {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }
}

export const sim = new Simulation();
