<script lang="ts">
  import { Canvas } from '@threlte/core';
  import ShipScene from '$lib/scene/ShipScene.svelte';
  import { SHIP_CLASS_STATS } from '$lib/domain/fleet';
  import { sim } from '$lib/state/simulation.svelte';

  type Preset = 'quarter' | 'bow' | 'deck' | 'far';

  const PRESETS: { id: Preset; label: string }[] = [
    { id: 'quarter', label: 'Aleta' },
    { id: 'bow', label: 'Proa' },
    { id: 'deck', label: 'Cubierta' },
    { id: 'far', label: 'Lejos' },
  ];

  let cameraPreset = $state<Preset>('quarter');

  // ContainerShip's reference hull is a 400 m ULCV (see its own scale note),
  // so a smaller class comes out proportionally smaller here instead of every
  // ship always rendering as the same boat. No selection falls back to that
  // same reference size, which is what this scene always looked like before
  // it was wired to the fleet.
  const ship = $derived(sim.selected);
  const stats = $derived(ship ? SHIP_CLASS_STATS[ship.shipClass] : null);

  /**
   * Step to the previous/next ship in fleet order, wrapping at either end, so
   * the whole fleet is browsable from here without ever going back to a map.
   * With nothing selected, `next` starts at the first ship and `prev` at the
   * last — whichever direction you press, you land somewhere sensible rather
   * than needing a first press just to establish a starting point.
   */
  function cycle(offset: 1 | -1) {
    const ships = sim.ships;
    if (ships.length === 0) return;
    if (!ship) {
      sim.select(ships[offset === 1 ? 0 : ships.length - 1].id);
      return;
    }
    const currentIndex = ships.findIndex((s) => s.id === ship.id);
    const nextIndex = (currentIndex + offset + ships.length) % ships.length;
    sim.select(ships[nextIndex].id);
  }

  function onKeydown(event: KeyboardEvent) {
    // Ignore when the focus is on an actual control (e.g. a button just
    // clicked) so the arrow keys don't double up with their own activation,
    // and skip modified combinations that usually mean something else
    // (browser back/forward on Alt+Arrow, etc).
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'ArrowLeft') cycle(-1);
    else if (event.key === 'ArrowRight') cycle(1);
  }
</script>

<svelte:head>
  <title>{ship ? `${ship.name} · Vista de barco` : 'Vista de barco'}</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="host">
  <Canvas>
    <!-- Keyed by ship id: ContainerShip reads its size/class/name props once
         at mount for performance (see its own note), so switching the
         selected ship without leaving this page needs a fresh instance, not
         just new prop values on the old one, or the hull never changes. -->
    {#key ship?.id}
      <ShipScene {cameraPreset} shipClass={ship?.shipClass ?? 'ulcv'} name={ship?.name ?? ''} />
    {/key}
  </Canvas>
</div>

<div class="identity panel">
  <button class="nav-btn" onclick={() => cycle(-1)} aria-label="Barco anterior">‹</button>
  <div class="identity-text">
    {#if ship && stats}
      <span class="label">{stats.label} · {stats.loa} m</span>
      <span class="name">{ship.name}</span>
    {:else}
      <span class="label">Sin selección</span>
      <span class="name">Elige un barco</span>
    {/if}
  </div>
  <button class="nav-btn" onclick={() => cycle(1)} aria-label="Barco siguiente">›</button>
</div>

<div class="tools panel">
  <span class="label">Cámara</span>
  {#each PRESETS as p (p.id)}
    <button
      class="ctl"
      class:is-active={cameraPreset === p.id}
      onclick={() => (cameraPreset = p.id)}
    >
      {p.label}
    </button>
  {/each}
</div>

<style>
  .host {
    position: fixed;
    inset: 0;
  }

  .tools {
    position: fixed;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.6rem;
  }

  .tools .ctl {
    padding: 0.32rem 0.7rem;
    font-size: 0.74rem;
  }

  .identity {
    position: fixed;
    top: 6.2rem;
    left: 1rem;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.6rem;
  }

  .identity-text {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 9rem;
  }

  .identity .name {
    font-size: 0.92rem;
  }

  .nav-btn {
    flex: none;
    width: 1.7rem;
    height: 1.7rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    color: inherit;
    font-size: 1.05rem;
    line-height: 1;
    cursor: pointer;
    transition:
      background 140ms ease,
      border-color 140ms ease;
  }

  .nav-btn:hover {
    background: var(--accent-soft);
    border-color: rgba(76, 201, 255, 0.42);
  }

  .nav-btn:active {
    transform: translateY(1px);
  }
</style>
