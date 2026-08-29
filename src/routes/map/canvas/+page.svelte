<script lang="ts">
  import CanvasMap from '$lib/map/CanvasMap.svelte';
  import Hud from '$lib/ui/Hud.svelte';
</script>

<svelte:head>
  <title>Mapa global · Canvas 2D</title>
</svelte:head>

<CanvasMap />
<Hud note="Rueda para zoom, arrastra para desplazar. Elige un barco y pulsa Seguir para fijar la cámara." />
