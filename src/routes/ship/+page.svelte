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
</script>

<svelte:head>
  <title>{ship ? `${ship.name} · Vista de barco` : 'Vista de barco'}</title>
</svelte:head>

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

{#if ship && stats}
  <div class="identity panel">
    <span class="label">{stats.label} · {stats.loa} m</span>
    <span class="name">{ship.name}</span>
  </div>
{:else}
  <p class="note panel">Elige un barco en el mapa para verlo aquí.</p>
{/if}

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
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.6rem 0.85rem;
  }

  .identity .name {
    font-size: 0.92rem;
  }

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
</style>
