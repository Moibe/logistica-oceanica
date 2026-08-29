<script lang="ts">
  import { SHIP_CLASS_STATS, position, heading, speedKmh } from '$lib/domain/fleet';
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

  const detail = $derived.by(() => {
    if (!selected) return null;
    const r = route(selected.routeId);
    const [lon, lat] = position(selected);
    const remainingKm = r.lengthKm * (selected.direction === 1 ? 1 - selected.progress : selected.progress);
    return {
      route: r,
      lon,
      lat,
      stats: SHIP_CLASS_STATS[selected.shipClass],
      heading: heading(selected),
      etaHours: remainingKm / speedKmh(selected),
      destination: port(selected.direction === 1 ? r.to : r.from),
      remainingKm,
    };
  });

  function coord(value: number, positive: string, negative: string): string {
    const hemisphere = value >= 0 ? positive : negative;
    return `${Math.abs(value).toFixed(2)}° ${hemisphere}`;
  }

  function eta(hours: number): string {
    const d = Math.floor(hours / 24);
    const h = Math.round(hours % 24);
    return d > 0 ? `${d}d ${h}h` : `${h}h`;
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
          <span class="swatch" style:background={r.color} style:box-shadow="0 0 8px {r.color}"
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
    <dl>
      <div><dt>Rumbo</dt><dd class="mono">{detail.heading.toFixed(0)}°</dd></div>
      <div><dt>Velocidad</dt><dd class="mono">{detail.stats.speed} kn</dd></div>
      <div><dt>Posición</dt><dd class="mono">{coord(detail.lat, 'N', 'S')} {coord(detail.lon, 'E', 'W')}</dd></div>
      <div><dt>Destino</dt><dd>{detail.destination.name}</dd></div>
      <div><dt>Restante</dt><dd class="mono">{Math.round(detail.remainingKm).toLocaleString('es-MX')} km</dd></div>
      <div><dt>ETA</dt><dd class="mono">{eta(detail.etaHours)}</dd></div>
      <div><dt>Carga</dt><dd class="mono">{selected.load.toLocaleString('es-MX')} TEU</dd></div>
    </dl>
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
    width: 258px;
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

  .detail p {
    margin: 0.15rem 0 0.7rem;
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
