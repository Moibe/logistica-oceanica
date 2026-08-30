<script lang="ts">
  import {
    SHIP_CLASS_STATS,
    position,
    heading,
    speedKmh,
    etaHours,
    fuelFraction,
    fuelBurnPerDay,
    clampSpeedFactor,
    MIN_SPEED_FACTOR,
    MAX_SPEED_FACTOR,
  } from '$lib/domain/fleet';
  import { port } from '$lib/domain/ports';
  import { route } from '$lib/domain/routes';
  import { sim, SPEED_STEPS } from '$lib/state/simulation.svelte';

  /**
   * The shared console: fleet roster on the left, clock and speed at the
   * bottom. Every map view mounts this unchanged, so the controls live in the
   * same place whichever renderer you are looking at.
   */
  let { note = '' }: { note?: string } = $props();

  const selected = $derived(sim.selected);

  const KM_PER_NM = 1.852;

  const detail = $derived.by(() => {
    if (!selected) return null;
    const r = route(selected.routeId);
    const [lon, lat] = position(selected);
    const stats = SHIP_CLASS_STATS[selected.shipClass];
    const remainingKm =
      r.lengthKm * (selected.direction === 1 ? 1 - selected.progress : selected.progress);
    const fraction = fuelFraction(selected);
    return {
      route: r,
      lon,
      lat,
      stats,
      heading: heading(selected),
      currentKn: Math.round(speedKmh(selected) / KM_PER_NM),
      minKn: Math.round(stats.speed * MIN_SPEED_FACTOR),
      maxKn: Math.round(stats.speed * MAX_SPEED_FACTOR),
      etaHours: etaHours(selected),
      destination: port(selected.direction === 1 ? r.to : r.from),
      remainingKm,
      fuelFraction: fraction,
      fuelTonnes: Math.round(selected.fuel),
      fuelCapacity: stats.fuelCapacity,
      burnPerDay: Math.round(fuelBurnPerDay(selected)),
      fuelColor: fraction > 0.5 ? '#4ade80' : fraction > 0.2 ? '#fbbf24' : '#f87171',
    };
  });

  function coord(value: number, positive: string, negative: string): string {
    const hemisphere = value >= 0 ? positive : negative;
    return `${Math.abs(value).toFixed(2)}° ${hemisphere}`;
  }

  function eta(hours: number | null): string {
    if (hours === null) return '—';
    const d = Math.floor(hours / 24);
    const h = Math.round(hours % 24);
    return d > 0 ? `${d}d ${h}h` : `${h}h`;
  }

  function onSpeedInput(event: Event) {
    if (!selected) return;
    const kn = Number((event.currentTarget as HTMLInputElement).value);
    const designKn = SHIP_CLASS_STATS[selected.shipClass].speed;
    selected.speedFactor = clampSpeedFactor(kn / designKn);
  }
</script>

<aside class="fleet panel">
  <header>
    <span class="label">Flota</span>
    <span class="label mono">{sim.ships.length}</span>
  </header>
  <ul>
    {#each sim.ships as ship (ship.id)}
      {@const r = route(ship.routeId)}
      <li>
        <button
          class="row"
          class:is-selected={sim.selectedId === ship.id}
          onclick={() => sim.select(ship.id)}
        >
          <span
            class="swatch"
            class:is-docked={ship.status === 'docked'}
            class:is-adrift={ship.status === 'adrift'}
            style:background={r.color}
            style:box-shadow="0 0 8px {r.color}"
          ></span>
          <span class="names">
            <span class="ship">{ship.name}</span>
            <span class="lane">{r.name}</span>
          </span>
          <span class="pct mono">{Math.round(ship.progress * 100)}%</span>
        </button>
      </li>
    {/each}
  </ul>
</aside>

{#if selected && detail}
  <section class="detail panel">
    <header>
      <span class="ship">{selected.name}</span>
      <button class="close" onclick={() => sim.select(null)} aria-label="Cerrar">×</button>
    </header>
    <p class="label">{detail.stats.label} · {detail.stats.loa} m</p>

    {#if selected.status === 'docked'}
      <p class="status is-docked">
        En puerto · sale en {eta(selected.dockHoursRemaining)}
      </p>
    {:else if selected.status === 'adrift'}
      <p class="status is-adrift">A la deriva · sin combustible</p>
    {/if}

    <dl>
      <div><dt>Rumbo</dt><dd class="mono">{detail.heading.toFixed(0)}°</dd></div>
      <div><dt>Posición</dt><dd class="mono">{coord(detail.lat, 'N', 'S')} {coord(detail.lon, 'E', 'W')}</dd></div>
      <div><dt>Destino</dt><dd>{detail.destination.name}</dd></div>
      <div><dt>Restante</dt><dd class="mono">{Math.round(detail.remainingKm).toLocaleString('es-MX')} km</dd></div>
      <div><dt>ETA</dt><dd class="mono">{eta(detail.etaHours)}</dd></div>
      <div>
        <dt>Carga</dt>
        <dd class="mono">{selected.load.toLocaleString('es-MX')} {detail.stats.unit}</dd>
      </div>
    </dl>

    <div class="fuel">
      <div class="fuel-head">
        <span class="label">Combustible</span>
        <span class="mono">
          {detail.fuelTonnes.toLocaleString('es-MX')} / {detail.fuelCapacity.toLocaleString('es-MX')} t
        </span>
      </div>
      <div class="fuel-track">
        <div
          class="fuel-fill"
          style:width="{detail.fuelFraction * 100}%"
          style:background={detail.fuelColor}
        ></div>
      </div>
    </div>

    <div class="speed">
      <div class="speed-head">
        <label for="speed-slider" class="label">Velocidad de crucero</label>
        <span class="mono">{detail.currentKn} kn</span>
      </div>
      <input
        id="speed-slider"
        type="range"
        min={detail.minKn}
        max={detail.maxKn}
        step="1"
        value={detail.currentKn}
        disabled={selected.status === 'adrift'}
        oninput={onSpeedInput}
      />
      <p class="burn label">
        {detail.burnPerDay.toLocaleString('es-MX')} t/día
        {#if selected.status === 'docked'}· al zarpar{/if}
      </p>
    </div>
  </section>
{/if}

<footer class="clock panel">
  <div class="time">
    <span class="label">Día</span>
    <span class="mono big">{sim.day}</span>
    <span class="mono big dimmed">{sim.clock}</span>
  </div>
  <div class="speeds">
    {#each SPEED_STEPS as step, i (step)}
      <button
        class="ctl"
        class:is-active={sim.speedIndex === i}
        onclick={() => (sim.speedIndex = i)}
      >
        {step === 0 ? '❚❚' : `${step}×`}
      </button>
    {/each}
  </div>
</footer>

{#if note}
  <p class="note panel">{note}</p>
{/if}

<style>
  .fleet {
    position: fixed;
    top: 6.2rem;
    left: 1rem;
    z-index: 30;
    width: 232px;
    max-height: calc(100vh - 12rem);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .fleet header {
    display: flex;
    justify-content: space-between;
    padding: 0.7rem 0.85rem 0.55rem;
    border-bottom: 1px solid var(--line);
  }

  ul {
    margin: 0;
    padding: 0.35rem;
    list-style: none;
    overflow-y: auto;
  }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.42rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 9px;
    background: none;
    cursor: pointer;
    text-align: left;
  }

  .row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .row.is-selected {
    background: var(--accent-soft);
    border-color: rgba(76, 201, 255, 0.4);
  }

  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }

  /* Docked/adrift override the route-colour dot with a status colour, so the
     roster shows at a glance which ships aren't under way without opening
     each one's detail panel. */
  /* Neutral slate rather than a route-palette hue: the eight route colours
     already span most of the spectrum, and a docked ship's dot needs to read
     as "paused, not a colour" rather than risk being mistaken for one of
     them (an earlier sky-blue landed almost on top of the Golfo-Índico
     teal). */
  .swatch.is-docked {
    background: #cbd5e1 !important;
    box-shadow: 0 0 8px #cbd5e1 !important;
  }

  .swatch.is-adrift {
    background: #f87171 !important;
    box-shadow: 0 0 8px #f87171 !important;
  }

  .names {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .ship {
    font-size: 0.82rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lane {
    font-size: 0.6rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pct {
    font-size: 0.66rem;
    color: var(--muted);
  }

  .detail {
    position: fixed;
    top: 6.2rem;
    right: 1rem;
    z-index: 30;
    width: 266px;
    padding: 0.8rem 0.9rem 0.9rem;
  }

  .detail header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .detail .ship {
    font-size: 0.98rem;
    letter-spacing: 0.01em;
  }

  .close {
    border: none;
    background: none;
    font-size: 1.1rem;
    line-height: 1;
    color: var(--muted);
    cursor: pointer;
  }

  .close:hover {
    color: var(--ink);
  }

  .detail > p.label {
    margin: 0.15rem 0 0.55rem;
  }

  .status {
    margin: 0 0 0.7rem;
    padding: 0.3rem 0.55rem;
    border-radius: 8px;
    font-size: 0.72rem;
  }

  .status.is-docked {
    background: rgba(125, 211, 252, 0.12);
    color: #bce8fd;
  }

  .status.is-adrift {
    background: rgba(248, 113, 113, 0.14);
    color: #ffc1c1;
  }

  dl {
    margin: 0;
    display: grid;
    gap: 0.32rem;
  }

  dl > div {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.76rem;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    text-align: right;
  }

  .fuel {
    margin-top: 0.75rem;
    padding-top: 0.65rem;
    border-top: 1px solid var(--line);
  }

  .fuel-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 0.74rem;
    margin-bottom: 0.32rem;
  }

  .fuel-track {
    height: 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }

  .fuel-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 200ms ease;
  }

  .speed {
    margin-top: 0.7rem;
    padding-top: 0.65rem;
    border-top: 1px solid var(--line);
  }

  .speed-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 0.74rem;
    margin-bottom: 0.3rem;
  }

  .speed input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }

  .speed input[type='range']:disabled {
    opacity: 0.4;
  }

  .burn {
    margin: 0.35rem 0 0;
  }

  .clock {
    position: fixed;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.55rem 0.8rem;
  }

  .time {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
  }

  .big {
    font-size: 1.05rem;
  }

  .dimmed {
    color: var(--muted);
  }

  .speeds {
    display: flex;
    gap: 0.28rem;
  }

  .speeds .ctl {
    padding: 0.3rem 0.55rem;
    font-size: 0.72rem;
    min-width: 2.4rem;
    justify-content: center;
  }

  /* Its own pill rather than a column inside the clock: as part of the clock it
     stretched the panel and knocked it off centre. */
  .note {
    position: fixed;
    left: 1rem;
    bottom: 1rem;
    z-index: 30;
    max-width: 34ch;
    margin: 0;
    padding: 0.5rem 0.75rem;
    font-size: 0.7rem;
    line-height: 1.45;
    color: var(--muted);
  }

  @media (max-width: 900px) {
    .fleet,
    .detail {
      display: none;
    }
  }
</style>
