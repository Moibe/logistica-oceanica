<script lang="ts">
  import { Canvas } from '@threlte/core';
  import ShipScene from '$lib/scene/ShipScene.svelte';

  type Preset = 'quarter' | 'bow' | 'deck' | 'far';

  const PRESETS: { id: Preset; label: string }[] = [
    { id: 'quarter', label: 'Aleta' },
    { id: 'bow', label: 'Proa' },
    { id: 'deck', label: 'Cubierta' },
    { id: 'far', label: 'Lejos' },
  ];

  let cameraPreset = $state<Preset>('quarter');
</script>

<svelte:head>
  <title>Vista de barco</title>
</svelte:head>

<div class="host">
  <Canvas>
    <ShipScene {cameraPreset} />
  </Canvas>
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
</style>
