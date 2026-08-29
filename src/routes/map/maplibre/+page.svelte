<script lang="ts">
  import MapLibreMap from '$lib/map/MapLibreMap.svelte';
  import Hud from '$lib/ui/Hud.svelte';
</script>

<svelte:head>
  <title>Mapa global · MapLibre GL</title>
</svelte:head>

<MapLibreMap />
<Hud note="Capas GL sobre datos locales. Mercator o globo, sin tiles externos." />
